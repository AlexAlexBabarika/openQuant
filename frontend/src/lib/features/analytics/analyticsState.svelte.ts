import { untrack } from 'svelte';
import { safeLocalStorageGet, safeLocalStorageSet } from '$lib/core/storage';
import { METRICS, type MetricId } from './metrics';
import {
  fetchCorrelation,
  fetchHurst,
  fetchKurtosis,
  fetchMaxDrawdown,
  fetchReturnDistribution,
  fetchSharpe,
  fetchSkewness,
  fetchSortino,
  fetchStdev,
  fetchVaR,
  fetchVariance,
  fetchVolatilityClustering,
  type CorrelationResponse,
  type MaxDrawdownResponse,
  type ReturnDistributionResponse,
  type ScalarMetricResponse,
  type VaRResponse,
  type VolatilityClusteringResponse,
} from './analyticsApi';

const BENCHMARKS_STORAGE_KEY = 'openquant:analytics:correlationBenchmarks';

export function loadCorrelationBenchmarksFromStorage(): string[] | null {
  const raw = safeLocalStorageGet<unknown>(BENCHMARKS_STORAGE_KEY);
  if (!Array.isArray(raw)) return null;
  return raw.filter((s): s is string => typeof s === 'string');
}

export function persistCorrelationBenchmarks(list: readonly string[]): void {
  safeLocalStorageSet(BENCHMARKS_STORAGE_KEY, [...list]);
}

export type AnalyticsResult =
  | { kind: 'scalar'; data: ScalarMetricResponse }
  | { kind: 'var'; data: VaRResponse }
  | { kind: 'max_drawdown'; data: MaxDrawdownResponse }
  | { kind: 'correlation'; data: CorrelationResponse }
  | { kind: 'volatility_clustering'; data: VolatilityClusteringResponse }
  | { kind: 'return_distribution'; data: ReturnDistributionResponse };

type Fetcher = (symbol: string) => Promise<AnalyticsResult>;

const DEFAULT_BENCHMARKS = ['SPY', 'QQQ'];

function emptyBoolMap(): Record<MetricId, boolean> {
  const out = {} as Record<MetricId, boolean>;
  for (const m of METRICS) out[m.id] = false;
  return out;
}

function emptyResultMap(): Record<MetricId, AnalyticsResult | null> {
  const out = {} as Record<MetricId, AnalyticsResult | null>;
  for (const m of METRICS) out[m.id] = null;
  return out;
}

function emptyErrorMap(): Record<MetricId, string | null> {
  const out = {} as Record<MetricId, string | null>;
  for (const m of METRICS) out[m.id] = null;
  return out;
}

function normalizeSymbols(list: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const sym = raw.trim().toUpperCase();
    if (!sym || seen.has(sym)) continue;
    seen.add(sym);
    out.push(sym);
  }
  return out;
}

export class AnalyticsState {
  enabled = $state<Record<MetricId, boolean>>(emptyBoolMap());
  results = $state<Record<MetricId, AnalyticsResult | null>>(emptyResultMap());
  loading = $state<Record<MetricId, boolean>>(emptyBoolMap());
  errors = $state<Record<MetricId, string | null>>(emptyErrorMap());
  symbol = $state<string | null>(null);
  correlationBenchmarks = $state<string[]>(
    loadCorrelationBenchmarksFromStorage() ?? [...DEFAULT_BENCHMARKS],
  );

  /** Override the per-metric fetchers (used by tests). */
  fetchers: Record<MetricId, Fetcher>;

  // Monotonic per-metric request token. Increments on every #fetchOne call;
  // out-of-order resolutions are dropped by comparing tokens after await.
  #reqIds: Record<MetricId, number>;
  #flights = new Map<MetricId, { key: string; promise: Promise<void> }>();

  enabledIds = $derived<MetricId[]>(
    METRICS.map(m => m.id).filter(id => this.enabled[id]),
  );

  constructor() {
    this.#reqIds = {} as Record<MetricId, number>;
    for (const m of METRICS) this.#reqIds[m.id] = 0;
    this.fetchers = {
      sharpe: async s => ({ kind: 'scalar', data: await fetchSharpe(s) }),
      sortino: async s => ({ kind: 'scalar', data: await fetchSortino(s) }),
      max_drawdown: async s => ({
        kind: 'max_drawdown',
        data: await fetchMaxDrawdown(s),
      }),
      var: async s => ({ kind: 'var', data: await fetchVaR(s) }),
      variance: async s => ({ kind: 'scalar', data: await fetchVariance(s) }),
      stdev: async s => ({ kind: 'scalar', data: await fetchStdev(s) }),
      skewness: async s => ({ kind: 'scalar', data: await fetchSkewness(s) }),
      kurtosis: async s => ({ kind: 'scalar', data: await fetchKurtosis(s) }),
      correlation: async s => {
        const benchmarks = this.correlationBenchmarks;
        if (benchmarks.length === 0) {
          return {
            kind: 'correlation',
            data: { symbol: s, metric: 'correlation', rows: [] },
          };
        }
        return {
          kind: 'correlation',
          data: await fetchCorrelation(s, benchmarks),
        };
      },
      volatility_clustering: async s => ({
        kind: 'volatility_clustering',
        data: await fetchVolatilityClustering(s),
      }),
      hurst: async s => ({ kind: 'scalar', data: await fetchHurst(s) }),
      return_distribution: async s => ({
        kind: 'return_distribution',
        data: await fetchReturnDistribution(s),
      }),
    };
  }

  toggle(id: MetricId): void {
    const next = !this.enabled[id];
    this.enabled[id] = next;
    if (!next) this.#cancel(id);
    if (next && this.symbol && this.results[id] === null) {
      void this.#fetchOne(id, this.symbol);
    }
  }

  /**
   * Set the active symbol. If it changed, drop cached results/errors and
   * re-fetch every currently-enabled metric. If the symbol is unchanged, only
   * fills in metrics that have no cached result yet.
   */
  refresh(symbol: string): Promise<void> {
    return untrack(async () => {
      const trimmed = symbol.trim();
      if (!trimmed) return;
      if (trimmed !== this.symbol) {
        for (const m of METRICS) this.#cancel(m.id);
        this.symbol = trimmed;
        this.results = emptyResultMap();
        this.errors = emptyErrorMap();
      }
      const targets = this.enabledIds.filter(id => this.results[id] === null);
      await Promise.all(targets.map(id => this.#fetchOne(id, trimmed)));
    });
  }

  /** Drop cached results for the current symbol and re-fetch enabled metrics. */
  invalidate(): void {
    for (const m of METRICS) this.#cancel(m.id);
    this.results = emptyResultMap();
    this.errors = emptyErrorMap();
    if (!this.symbol) return;
    for (const id of this.enabledIds) {
      void this.#fetchOne(id, this.symbol);
    }
  }

  /** Replace the correlation benchmark list. Re-fetch if list changed. */
  setCorrelationBenchmarks(list: readonly string[]): void {
    const next = normalizeSymbols(list);
    const cur = this.correlationBenchmarks;
    if (next.length === cur.length && next.every((s, i) => s === cur[i])) {
      return;
    }
    this.correlationBenchmarks = next;
    this.#cancel('correlation');
    persistCorrelationBenchmarks(next);
    this.errors.correlation = null;
    // Keep the previous result around so the chip editor stays visible while
    // the new fetch is in flight. The card filters rows by the current
    // benchmarks list, so stale entries disappear immediately and new ones
    // render as pending until the response lands.
    if (next.length === 0) {
      this.results.correlation = this.symbol
        ? {
            kind: 'correlation',
            data: {
              symbol: this.symbol,
              metric: 'correlation',
              rows: [],
            },
          }
        : null;
      return;
    }
    if (this.enabled.correlation && this.symbol) {
      void this.#fetchOne('correlation', this.symbol);
    }
  }

  addBenchmark(symbol: string): void {
    this.setCorrelationBenchmarks([...this.correlationBenchmarks, symbol]);
  }

  removeBenchmark(symbol: string): void {
    const target = symbol.trim().toUpperCase();
    this.setCorrelationBenchmarks(
      this.correlationBenchmarks.filter(s => s !== target),
    );
  }

  #cancel(id: MetricId): void {
    this.#reqIds[id]++;
    this.#flights.delete(id);
    this.loading[id] = false;
  }

  #fetchOne(id: MetricId, symbol: string): Promise<void> {
    const key = JSON.stringify([
      symbol,
      id,
      id === 'correlation' ? this.correlationBenchmarks : null,
    ]);
    const flight = this.#flights.get(id);
    if (flight?.key === key) return flight.promise;
    const token = ++this.#reqIds[id];
    this.loading[id] = true;
    this.errors[id] = null;
    const promise = (async () => {
      try {
        const result = await this.fetchers[id](symbol);
        if (this.symbol !== symbol || this.#reqIds[id] !== token) return;
        this.results[id] = result;
      } catch (err) {
        if (this.symbol !== symbol || this.#reqIds[id] !== token) return;
        this.errors[id] = err instanceof Error ? err.message : 'Fetch failed';
      } finally {
        if (this.#reqIds[id] === token) {
          this.loading[id] = false;
        }
      }
    })().finally(() => {
      if (this.#reqIds[id] === token) this.#flights.delete(id);
    });
    this.#flights.set(id, { key, promise });
    return promise;
  }
}

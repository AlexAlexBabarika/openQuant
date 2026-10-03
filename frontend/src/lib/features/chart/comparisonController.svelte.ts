import { onDestroy, untrack } from 'svelte';
import type { OHLCVCandle } from '$lib/core/types';
import { fetchMarketOHLCV } from '$lib/features/market/marketData';
import {
  subscribeMarketStream,
  type StreamStatus,
} from '$lib/features/market/streaming';
import {
  providerSupportsWs,
  type MarketDataProviderValue,
} from '$lib/features/market/marketDataProviders';
import type { SymbolProviders } from '$lib/features/market/symbols';
import { COMPARISON_PALETTE, nextUnusedColor } from './comparisonPalette';
import {
  createComparison,
  deleteComparison,
  listComparisons,
  updateComparison,
  type ComparisonRecord,
  type ComparisonSeriesType,
} from './comparisonsApi';

export const MAX_COMPARISONS = 4;

export type ComparisonStatus = 'loading' | 'ready' | 'error' | 'no-overlap';

export interface Comparison {
  id: string;
  mainSymbol: string;
  symbol: string;
  provider: MarketDataProviderValue;
  color: string;
  seriesType: ComparisonSeriesType;
  candles: OHLCVCandle[];
  status: ComparisonStatus;
  errorMessage?: string;
  position: number;
}

export interface ComparisonControllerOptions {
  userId: () => string | null;
  /** Reactive accessor for the main chart symbol (use `() => chart.loadedSymbol`). */
  mainSymbol: () => string;
  /** Reactive accessor for the main chart period. */
  period: () => string;
  /** Reactive accessor for the main chart interval. */
  interval: () => string;
  /** Reactive accessor for the main chart provider. */
  mainProvider: () => MarketDataProviderValue;
  /** Optional toast / error reporter for user-visible failures. */
  onError?: (message: string) => void;
}

/**
 * Resolve a provider for a comparison symbol given the main chart's current
 * provider and the symbol's provider availability map.
 *
 * Priority: reuse main provider if supported → first listed supported provider
 * (binance > yfinance > twelvedata) → null when nothing supports it.
 */
export function resolveComparisonProvider(
  mainProvider: MarketDataProviderValue,
  providers: SymbolProviders | null,
): MarketDataProviderValue | null {
  if (!providers) {
    // Unknown symbol; if the main provider isn't csv, optimistically reuse it.
    return mainProvider !== 'csv' ? mainProvider : null;
  }
  if (
    mainProvider !== 'csv' &&
    providers[mainProvider as keyof SymbolProviders]
  ) {
    return mainProvider;
  }
  const order: (keyof SymbolProviders)[] = [
    'binance',
    'yfinance',
    'twelvedata',
  ];
  const next = order.find(p => providers[p]);
  return next ?? null;
}

function recordToComparison(r: ComparisonRecord): Comparison {
  return {
    id: r.id,
    mainSymbol: r.main_symbol,
    symbol: r.comparison_symbol,
    provider: r.provider,
    color: r.color,
    seriesType: r.series_type,
    candles: [],
    status: 'loading',
    position: r.position,
  };
}

export class ComparisonController {
  comparisons = $state.raw<Comparison[]>([]);

  /** True while a load(mainSymbol) call is in flight. */
  isLoading = $state(false);

  #unsubsById = new Map<string, () => void>();
  #lastLoadedMain: string | null = null;
  #userId: () => string | null;
  #onError?: (message: string) => void;

  constructor(opts: ComparisonControllerOptions) {
    this.#onError = opts.onError;
    this.#userId = opts.userId;

    // Load comparisons whenever the main symbol changes.
    $effect(() => {
      const sym = opts.mainSymbol();
      const userId = opts.userId();
      untrack(() => {
        void this.load(userId ? sym : '');
      });
    });

    // Refetch all comparison candles on period / interval / mainProvider change.
    $effect(() => {
      opts.period();
      opts.interval();
      opts.mainProvider();
      // Skip first run: load() already fetches candles. Track via a flag on
      // this.#lastLoadedMain — empty = no load has happened yet.
      if (this.#lastLoadedMain === null || this.#lastLoadedMain === '') return;
      untrack(() => {
        void this.#refetchAll();
      });
    });

    onDestroy(() => this.#clearAll());
  }

  /** Apply server state for a main symbol: replace local comparisons + start streams. */
  load = async (mainSymbol: string): Promise<void> => {
    const userId = this.#userId();
    const target = userId ? mainSymbol.trim() : '';
    this.#lastLoadedMain = target;
    if (!target) {
      this.#clearAll();
      this.isLoading = false;
      return;
    }
    this.isLoading = true;
    try {
      const records = await listComparisons(target);
      if (this.#lastLoadedMain !== target || this.#userId() !== userId) return;
      // Drop any existing subscriptions for the previous main symbol.
      this.#clearAll();
      const next = records.map(recordToComparison);
      this.comparisons = next;
      await Promise.all(next.map(c => this.#fetchAndStream(c)));
    } catch (e) {
      if (this.#lastLoadedMain === target && this.#userId() === userId) {
        this.#onError?.(
          e instanceof Error ? e.message : 'Failed to load comparisons',
        );
      }
    } finally {
      if (this.#lastLoadedMain === target && this.#userId() === userId) {
        this.isLoading = false;
      }
    }
  };

  /** Returns the symbols currently in the dialog's "existing" set: main + comparisons. */
  activeSymbolsFor(mainSymbol: string): string[] {
    return [
      mainSymbol,
      ...this.comparisons
        .filter(c => c.mainSymbol === mainSymbol)
        .map(c => c.symbol),
    ];
  }

  add = async (
    mainSymbol: string,
    symbol: string,
    providers: SymbolProviders | null,
    mainProvider: MarketDataProviderValue,
  ): Promise<void> => {
    if (this.comparisons.length >= MAX_COMPARISONS) {
      this.#onError?.(`Maximum ${MAX_COMPARISONS} comparisons.`);
      return;
    }
    if (mainSymbol.trim().toUpperCase() === symbol.trim().toUpperCase()) {
      this.#onError?.('Comparison symbol must differ from the main symbol.');
      return;
    }
    if (
      this.comparisons.some(
        c => c.symbol.toUpperCase() === symbol.trim().toUpperCase(),
      )
    ) {
      this.#onError?.('Already comparing that symbol.');
      return;
    }
    const provider = resolveComparisonProvider(mainProvider, providers);
    if (!provider) {
      this.#onError?.(
        'No supported data provider for that symbol — cannot compare.',
      );
      return;
    }
    const usedColors = this.comparisons.map(c => c.color);
    const color = nextUnusedColor(usedColors);

    try {
      const record = await createComparison({
        main_symbol: mainSymbol,
        comparison_symbol: symbol,
        provider,
        color,
        series_type: 'line',
      });
      const comp = recordToComparison(record);
      this.comparisons = [...this.comparisons, comp];
      await this.#fetchAndStream(comp);
    } catch (e) {
      this.#onError?.(
        e instanceof Error ? e.message : 'Failed to add comparison',
      );
    }
  };

  remove = async (id: string): Promise<void> => {
    const comp = this.comparisons.find(c => c.id === id);
    if (!comp) return;
    this.#stopStream(id);
    // Optimistic local remove.
    this.comparisons = this.comparisons.filter(c => c.id !== id);
    try {
      await deleteComparison(id);
    } catch (e) {
      // Revert on failure.
      this.comparisons = [...this.comparisons, comp];
      this.#onError?.(
        e instanceof Error ? e.message : 'Failed to remove comparison',
      );
    }
  };

  setColor = async (id: string, color: string): Promise<void> => {
    const prev = this.comparisons.find(c => c.id === id);
    if (!prev || prev.color === color) return;
    this.#patchLocal(id, { color });
    try {
      await updateComparison(id, { color });
    } catch (e) {
      this.#patchLocal(id, { color: prev.color });
      this.#onError?.(
        e instanceof Error ? e.message : 'Failed to update colour',
      );
    }
  };

  setSeriesType = async (
    id: string,
    seriesType: ComparisonSeriesType,
  ): Promise<void> => {
    const prev = this.comparisons.find(c => c.id === id);
    if (!prev || prev.seriesType === seriesType) return;
    this.#patchLocal(id, { seriesType });
    try {
      await updateComparison(id, { series_type: seriesType });
    } catch (e) {
      this.#patchLocal(id, { seriesType: prev.seriesType });
      this.#onError?.(
        e instanceof Error ? e.message : 'Failed to update series type',
      );
    }
  };

  // --- internals ---

  #patchLocal(id: string, patch: Partial<Comparison>) {
    this.comparisons = this.comparisons.map(c =>
      c.id === id ? { ...c, ...patch } : c,
    );
  }

  #stopStream(id: string) {
    const unsub = this.#unsubsById.get(id);
    if (unsub) {
      unsub();
      this.#unsubsById.delete(id);
    }
  }

  #clearAll() {
    for (const unsub of this.#unsubsById.values()) unsub();
    this.#unsubsById.clear();
    this.comparisons = [];
  }

  async #fetchAndStream(comp: Comparison): Promise<void> {
    if (comp.provider === 'csv') return;
    try {
      const data = await fetchMarketOHLCV(
        comp.symbol,
        comp.provider,
        // Period / interval are read off the most recent main-chart values via
        // the same accessors used in the constructor effect; we capture them
        // on each call so refetchAll picks up fresh values.
        this.#lastPeriod ?? '1mo',
        this.#lastInterval ?? '1d',
      );
      this.#patchLocal(comp.id, {
        candles: data.candles ?? [],
        status: 'ready',
        errorMessage: undefined,
      });
    } catch (e) {
      this.#patchLocal(comp.id, {
        status: 'error',
        errorMessage: e instanceof Error ? e.message : 'Failed to load',
      });
      return;
    }

    if (!providerSupportsWs(comp.provider)) return;
    const current = this.comparisons.find(c => c.id === comp.id);
    const historyEndIso = current?.candles.length
      ? current.candles[current.candles.length - 1].timestamp
      : undefined;

    const unsub = subscribeMarketStream({
      provider: comp.provider,
      symbol: comp.symbol,
      interval: this.#lastInterval ?? '1d',
      historyEndIso,
      onCandle: c => this.#applyLiveCandle(comp.id, c),
      onStatus: (s: StreamStatus) => {
        if (s === 'error') {
          this.#patchLocal(comp.id, {
            status: 'error',
            errorMessage: 'Stream error',
          });
        }
      },
    });
    this.#unsubsById.set(comp.id, unsub);
  }

  #applyLiveCandle(id: string, c: OHLCVCandle) {
    const idx = this.comparisons.findIndex(comp => comp.id === id);
    if (idx === -1) return;
    const comp = this.comparisons[idx];
    const candles = comp.candles.slice();
    const last = candles[candles.length - 1];
    if (last && last.timestamp === c.timestamp) {
      candles[candles.length - 1] = c;
    } else {
      candles.push(c);
    }
    const next = this.comparisons.slice();
    next[idx] = { ...comp, candles };
    this.comparisons = next;
  }

  // Period/interval cache — simplifies fetching candles without coupling the
  // controller to a concrete ChartController shape. Updated by the parent via
  // updateContext() each time the chart's period/interval/provider changes.
  #lastPeriod: string | null = null;
  #lastInterval: string | null = null;

  /** Called by the host once per render with current chart state. */
  updateContext(period: string, interval: string): void {
    this.#lastPeriod = period;
    this.#lastInterval = interval;
  }

  async #refetchAll(): Promise<void> {
    const items = this.comparisons.slice();
    // Tear down active streams; #fetchAndStream will re-establish them.
    for (const id of [...this.#unsubsById.keys()]) this.#stopStream(id);
    this.comparisons = items.map(c => ({
      ...c,
      status: 'loading' as ComparisonStatus,
    }));
    await Promise.all(items.map(c => this.#fetchAndStream(c)));
  }
}

export { COMPARISON_PALETTE };

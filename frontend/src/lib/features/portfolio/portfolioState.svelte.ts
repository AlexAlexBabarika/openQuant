/**
 * Portfolio backtest state: the universe symbol list built in the UI plus the
 * latest run of `POST /portfolio-backtests/run`. Runes-based, mirroring
 * `StrategyState`; the HTTP client is injectable so tests stub the network.
 */
import { runsClient, type RunsClient } from '$lib/features/runs/runsClient';
import {
  httpPortfolioClient,
  type IngestReport,
  type PortfolioClient,
  type PortfolioConstraintsBody,
  type PortfolioRunParams,
  type PortfolioRunResponse,
} from './portfolioClient';
import type { PortfolioResult } from './types';
import { mergeSymbols } from './universe';

export type PortfolioRunContext = Omit<
  PortfolioRunParams,
  'code' | 'symbols' | 'constraints'
>;

/**
 * Map a stored run blob (as returned by `GET /backtests/runs/{id}` →
 * `RunStore.read`) into the `PortfolioRunResponse` the portfolio dashboard
 * reads. The stored shape carries the same fields as a live portfolio run, with
 * the constraint log under `log`; there is no sandbox envelope, so status is
 * "ok" and the stdout/stderr/timing fields are empty.
 */
export function toPortfolioRunResponse(blob: unknown): PortfolioRunResponse {
  if (typeof blob !== 'object' || blob === null) {
    throw new Error('stored run is not an object');
  }
  const b = blob as Record<string, unknown>;
  for (const key of [
    'meta',
    'bars',
    'orders',
    'fills',
    'equity',
    'trades',
    'metrics',
  ] as const) {
    if (!(key in b)) throw new Error(`stored portfolio run missing "${key}"`);
  }
  if (!(b.bars && typeof b.bars === 'object' && !Array.isArray(b.bars))) {
    throw new Error('not a portfolio run (bars is not per-symbol)');
  }
  return {
    status: 'ok',
    meta: b.meta as PortfolioResult['meta'],
    symbols: (b.symbols as string[] | undefined) ?? [],
    bars: b.bars as PortfolioResult['bars'],
    orders: b.orders as PortfolioResult['orders'],
    fills: b.fills as PortfolioResult['fills'],
    equity: b.equity as PortfolioResult['equity'],
    trades: b.trades as PortfolioResult['trades'],
    constraint_events:
      (b.log as PortfolioResult['constraint_events'] | undefined) ?? [],
    metrics: b.metrics as PortfolioResult['metrics'],
    stdout: '',
    stderr: '',
    elapsed_ms: 0,
  };
}

export class PortfolioState {
  /** The universe, in insertion order (uppercase, unique, capped). */
  symbols = $state<string[]>([]);

  /** Optional hard constraints sent with the next run. */
  constraints = $state<PortfolioConstraintsBody | null>(null);

  isRunning = $state(false);
  runError = $state<string | null>(null);
  /** Last successful run's full blob (canonical result + sandbox envelope). */
  response = $state<PortfolioRunResponse | null>(null);

  isIngesting = $state(false);
  ingestError = $state<string | null>(null);
  /** Report from the last successful ingest of the current universe. */
  ingestReport = $state<IngestReport | null>(null);

  #client: PortfolioClient;
  #runs: RunsClient;
  #request = 0;

  constructor(
    client: PortfolioClient = httpPortfolioClient,
    runs: RunsClient = runsClient,
  ) {
    this.#client = client;
    this.#runs = runs;
  }

  /**
   * Load a stored portfolio run by id into `response` so its dashboard renders,
   * without re-running. Reuses `isRunning`/`runError` for UI feedback.
   */
  async loadStored(id: string): Promise<void> {
    const request = ++this.#request;
    this.isRunning = true;
    this.runError = null;
    try {
      const response = toPortfolioRunResponse(await this.#runs.getRun(id));
      if (request === this.#request) this.response = response;
    } catch (err) {
      if (request === this.#request)
        this.runError =
          err instanceof Error ? err.message : 'Failed to load run';
    } finally {
      if (request === this.#request) this.isRunning = false;
    }
  }

  /** Merge free-form pasted/typed ticker text into the universe. */
  add(text: string): void {
    this.symbols = mergeSymbols(this.symbols, text);
  }

  remove(symbol: string): void {
    this.symbols = this.symbols.filter(s => s !== symbol);
  }

  clear(): void {
    this.symbols = [];
  }

  /**
   * Run `code` against the current universe. A non-ok sandbox status is
   * surfaced as `runError` with the run's stderr; the previous successful
   * response is kept so its dashboard stays readable.
   */
  async run(
    code: string,
    ctx: PortfolioRunContext,
  ): Promise<PortfolioRunResponse | null> {
    const request = ++this.#request;
    if (this.symbols.length === 0) {
      this.isRunning = false;
      this.runError = 'Add at least one symbol to the universe';
      return null;
    }
    this.isRunning = true;
    this.runError = null;
    try {
      const res = await this.#client.run({
        code,
        symbols: [...this.symbols],
        ...ctx,
        ...(this.constraints ? { constraints: this.constraints } : {}),
      });
      if (request !== this.#request) return null;
      if (res.status !== 'ok') {
        this.runError = res.stderr.trim() || `Backtest ${res.status}`;
        return null;
      }
      this.response = res;
      return res;
    } catch (err) {
      if (request === this.#request)
        this.runError =
          err instanceof Error ? err.message : 'Portfolio backtest failed';
      return null;
    } finally {
      if (request === this.#request) this.isRunning = false;
    }
  }

  /**
   * Populate the datastore for the current universe so a subsequent run finds
   * bars. Failures surface as `ingestError`; success exposes the report.
   */
  async ingest(interval = '1d'): Promise<void> {
    if (this.symbols.length === 0) {
      this.ingestError = 'Add at least one symbol to the universe';
      return;
    }
    this.isIngesting = true;
    this.ingestError = null;
    try {
      this.ingestReport = await this.#client.ingest(
        [...this.symbols],
        interval,
      );
    } catch (err) {
      this.ingestError = err instanceof Error ? err.message : 'Ingest failed';
    } finally {
      this.isIngesting = false;
    }
  }
}

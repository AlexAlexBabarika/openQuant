/**
 * Strategy editor state: the live strategy source (`draftCode`) that feeds both
 * the single-run backtest path and the sweep panel, plus saved-strategy CRUD.
 * The draft and saved-strategy machinery is `SavedScriptDraft`; the HTTP client is
 * injectable so tests stub the network, mirroring `SweepState`.
 */
import { BacktestState } from '$lib/features/backtest/backtestState.svelte';
import type { DataQualityReport } from '$lib/features/runs/dataQuality';
import { SavedScriptDraft } from '$lib/features/scripts/savedScriptDraft.svelte';
import {
  httpStrategyClient,
  type BacktestRunParams,
  type StrategyClient,
  type StrategyInfo,
} from './strategies';

export const SEED_CODE = `params = {
    "fast": Int(5, 50, step=5),
    "slow": Int(20, 200, step=10),
}

def sma(ctx, n):
    m = len(ctx.bars)
    if m < n:
        return None
    return sum(ctx.bars[i].close for i in range(m - n, m)) / n

def on_bar(ctx):
    fast = sma(ctx, ctx.params["fast"])
    slow = sma(ctx, ctx.params["slow"])
    if fast is None or slow is None:
        return
    if fast > slow and ctx.position.quantity == 0:
        ctx.buy(10)
    elif fast < slow and ctx.position.quantity > 0:
        ctx.sell(ctx.position.quantity)
`;

export type RunContext = Omit<BacktestRunParams, 'code'>;

export class StrategyState extends SavedScriptDraft<StrategyInfo> {
  /** Result of the latest `runBacktest()`, rendered by `BacktestPanel`. */
  backtest = $state<BacktestState | null>(null);
  isRunning = $state(false);
  runError = $state<string | null>(null);
  dataQuality = $state<DataQualityReport | null>(null);

  #client: StrategyClient;

  constructor(client: StrategyClient = httpStrategyClient) {
    super({
      store: client,
      untitled: 'Untitled strategy',
      starterCode: SEED_CODE,
      loadFailed: 'Failed to load strategies',
    });
    this.#client = client;
  }

  override clearSaved(): void {
    super.clearSaved();
    this.backtest?.dispose();
    this.backtest = null;
    this.dataQuality = null;
    this.isRunning = false;
    this.runError = null;
  }

  /**
   * Run the current draft through `POST /backtests/run` into a fresh
   * `BacktestState` (so `BacktestPanel` renders a real run, not the fixture).
   * A non-ok sandbox status is surfaced as `runError` with the run's stderr.
   */
  async runBacktest(ctx: RunContext): Promise<BacktestState> {
    this.backtest?.dispose();
    const code = this.draftCode;
    const account = this.accountVersion;
    this.dataQuality = null;
    this.isRunning = true;
    this.runError = null;
    const bt = new BacktestState(async () => {
      const res = await this.#client.runBacktest({ code, ...ctx }, quality => {
        if (account === this.accountVersion && this.backtest === bt)
          this.dataQuality = quality;
      });
      if (account !== this.accountVersion)
        throw new Error('Account changed. Run again.');
      if (this.backtest === bt)
        this.dataQuality = res.meta.data_quality ?? this.dataQuality;
      if (res.status !== 'ok') {
        throw new Error(res.stderr.trim() || `Backtest ${res.status}`);
      }
      return res;
    });
    this.backtest = bt;
    try {
      await bt.load();
    } finally {
      if (this.backtest === bt) {
        this.isRunning = false;
        this.runError = bt.error;
      }
    }
    return bt;
  }
}

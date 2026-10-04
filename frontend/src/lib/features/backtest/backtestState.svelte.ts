/**
 * Dashboard state: the loaded `BacktestResult`, the active result tab, and the
 * marker↔row hover link shared between the chart (pane 2) and the trades table
 * (pane 3). Runes-based, mirroring `AnalyticsState`.
 *
 * The result is loaded through an injectable `loader` (defaulting to a
 * dynamically-imported sample fixture, so the ~0.5MB blob is code-split into a
 * lazy chunk fetched only when the dashboard opens). Tests pass their own
 * loader. When the backend read-API lands, the loader becomes an HTTP fetch and
 * nothing else here changes.
 */
import { loadResult } from './loadResult';
import type { BacktestResult } from './types';
import type { RunStatus } from '$lib/features/runs/runTypes';
import {
  tradeSelection,
  drawdownSelection,
  type ResultSelection,
} from './resultSelection';
import type { DrawdownEpisode } from './derive';

export type ResultTab = 'equity' | 'drawdown' | 'trades' | 'monthly' | 'stats';

export const RESULT_TABS: { id: ResultTab; label: string }[] = [
  { id: 'equity', label: 'Equity' },
  { id: 'drawdown', label: 'Drawdown' },
  { id: 'trades', label: 'Trades' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'stats', label: 'Stats' },
];

type Loader = () => Promise<unknown>;

const defaultLoader: Loader = () =>
  import('./fixtures/sample-run.json').then(m => m.default);

export class BacktestState {
  result = $state<BacktestResult | null>(null);
  loading = $state(false);
  error = $state<string | null>(null);
  activeTab = $state<ResultTab>('equity');
  status = $state<RunStatus | null>(null);

  /** Index into `result.trades` currently hovered (chart marker or table row),
   * or null. The chart highlights this marker; the table highlights this row. */
  hoveredTrade = $state<number | null>(null);
  selection = $state<ResultSelection | null>(null);

  selectTrade(index: number): void {
    this.selection = this.result ? tradeSelection(this.result, index) : null;
  }
  selectDrawdown(episode: DrawdownEpisode, index: number): void {
    this.selection = this.result
      ? drawdownSelection(this.result, episode, index)
      : null;
  }
  clearSelection(): void {
    this.selection = null;
  }

  #loader: Loader;

  constructor(loader: Loader = defaultLoader) {
    this.#loader = loader;
  }

  /** Load the result once. No-op if already loaded or in flight. */
  async load(): Promise<void> {
    if (this.result || this.loading) return;
    this.loading = true;
    this.error = null;
    try {
      const raw = await this.#loader();
      this.result = loadResult(raw);
      this.status =
        typeof raw === 'object' && raw !== null && 'status' in raw
          ? ((raw as { status: RunStatus }).status ?? null)
          : null;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load result';
    } finally {
      this.loading = false;
    }
  }

  setTab(tab: ResultTab): void {
    this.activeTab = tab;
  }

  hoverTrade(index: number | null): void {
    this.hoveredTrade = index;
  }
}

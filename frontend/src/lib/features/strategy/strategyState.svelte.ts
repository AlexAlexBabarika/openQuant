/**
 * Strategy editor state: the live strategy source (`draftCode`) that feeds both
 * the single-run backtest path and the sweep panel, plus saved-strategy CRUD.
 * Runes-based, mirroring `IndicatorState`; the HTTP client is injectable so
 * tests stub the network, mirroring `SweepState`.
 */
import { BacktestState } from '$lib/features/backtest/backtestState.svelte';
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

export class StrategyState {
  scripts = $state<StrategyInfo[]>([]);
  loading = $state(false);
  loadError = $state<string | null>(null);

  activeId = $state<string | null>(null);
  draftName = $state('Untitled strategy');
  draftCode = $state(SEED_CODE);
  dirty = $state(false);

  isSaving = $state(false);
  saveError = $state<string | null>(null);

  /** Result of the latest `runBacktest()`, rendered by `BacktestPanel`. */
  backtest = $state<BacktestState | null>(null);
  isRunning = $state(false);
  runError = $state<string | null>(null);

  #client: StrategyClient;
  #draftVersion = $state(0);
  #revision = 0;
  #listRequest = 0;
  #scriptsRevision = 0;
  #savingId: string | null = null;
  #deleting = new Set<string>();

  constructor(client: StrategyClient = httpStrategyClient) {
    this.#client = client;
  }

  get draftVersion(): number {
    return this.#draftVersion;
  }

  active = $derived.by(() =>
    this.activeId
      ? (this.scripts.find(s => s.id === this.activeId) ?? null)
      : null,
  );

  async load(): Promise<void> {
    const request = ++this.#listRequest;
    const revision = this.#scriptsRevision;
    this.loading = true;
    this.loadError = null;
    try {
      const scripts = await this.#client.list();
      if (request === this.#listRequest && revision === this.#scriptsRevision)
        this.scripts = scripts;
    } catch (err) {
      if (request === this.#listRequest && revision === this.#scriptsRevision)
        this.loadError =
          err instanceof Error ? err.message : 'Failed to load strategies';
    } finally {
      if (request === this.#listRequest) this.loading = false;
    }
  }

  newDraft(discard = () => confirm('Discard unsaved strategy changes?')): void {
    if (this.dirty && !discard()) return;
    this.#draftVersion++;
    this.activeId = null;
    this.draftName = 'Untitled strategy';
    this.draftCode = SEED_CODE;
    this.dirty = false;
    this.saveError = null;
  }

  select(
    id: string,
    discard = () => confirm('Discard unsaved strategy changes?'),
  ): void {
    if (id === this.activeId) return;
    const s = this.scripts.find(x => x.id === id);
    if (!s) return;
    if (this.dirty && !discard()) return;
    this.#draftVersion++;
    this.activeId = id;
    this.draftName = s.name;
    this.draftCode = s.code;
    this.dirty = false;
    this.saveError = null;
  }

  setName(name: string): void {
    if (this.draftName === name) return;
    this.draftName = name;
    this.#revision++;
    this.dirty = true;
  }

  setCode(code: string): void {
    if (this.draftCode === code) return;
    this.draftCode = code;
    this.#revision++;
    this.dirty = true;
  }

  async save(): Promise<StrategyInfo | null> {
    if (this.isSaving) return null;
    const id = this.activeId;
    if (id && this.#deleting.has(id)) {
      this.saveError = 'Wait for deletion to finish before saving';
      return null;
    }
    const name = this.draftName.trim();
    if (!name) {
      this.saveError = 'Name is required';
      return null;
    }
    this.isSaving = true;
    this.#savingId = id;
    this.saveError = null;
    const version = this.#draftVersion;
    const revision = this.#revision;
    const code = this.draftCode;
    try {
      let saved: StrategyInfo;
      if (id) {
        saved = await this.#client.update(id, {
          name,
          code,
        });
      } else {
        saved = await this.#client.create(name, code);
      }
      this.#scriptsRevision++;
      const idx = this.scripts.findIndex(s => s.id === saved.id);
      if (idx >= 0) this.scripts[idx] = saved;
      else this.scripts = [saved, ...this.scripts];
      if (version === this.#draftVersion) {
        this.activeId = saved.id;
        if (revision === this.#revision) {
          this.draftName = saved.name;
          this.dirty = false;
        }
      } else if (
        this.activeId === saved.id &&
        (this.draftCode !== saved.code || this.draftName !== saved.name)
      ) {
        this.dirty = true;
      }
      return saved;
    } catch (err) {
      if (version === this.#draftVersion)
        this.saveError = err instanceof Error ? err.message : 'Failed to save';
      return null;
    } finally {
      this.isSaving = false;
      this.#savingId = null;
    }
  }

  async remove(id: string): Promise<void> {
    if (this.isSaving && this.#savingId === id)
      throw new Error('Wait for the save to finish before deleting');
    if (this.#deleting.has(id)) return;
    this.#deleting.add(id);
    const version = this.#draftVersion;
    const revision = this.#revision;
    try {
      await this.#client.remove(id);
      this.#scriptsRevision++;
      this.scripts = this.scripts.filter(s => s.id !== id);
      if (this.activeId === id) {
        if (version === this.#draftVersion && revision === this.#revision)
          this.newDraft(() => true);
        else {
          this.#draftVersion++;
          this.activeId = null;
          this.dirty = true;
        }
      }
    } finally {
      this.#deleting.delete(id);
    }
  }

  /**
   * Run the current draft through `POST /backtests/run` into a fresh
   * `BacktestState` (so `BacktestPanel` renders a real run, not the fixture).
   * A non-ok sandbox status is surfaced as `runError` with the run's stderr.
   */
  async runBacktest(ctx: RunContext): Promise<BacktestState> {
    const code = this.draftCode;
    this.isRunning = true;
    this.runError = null;
    const bt = new BacktestState(async () => {
      const res = await this.#client.runBacktest({ code, ...ctx });
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

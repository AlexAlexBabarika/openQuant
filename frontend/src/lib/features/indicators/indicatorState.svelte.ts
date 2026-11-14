import {
  createScript,
  deleteScript,
  executeScript,
  listScripts,
  updateScript,
  type ExecuteParams,
  type RunResult,
  type ScriptInfo,
  type ScriptOutput,
} from './scripts';
import { SavedScriptDraft } from '$lib/features/scripts/savedScriptDraft.svelte';

const STARTER_CODE = `sma20 = price.rolling_mean(20)
sma50 = price.rolling_mean(50)
display.line(sma20, title="SMA 20", color="#7dd3fc")
display.line(sma50, title="SMA 50", color="#fbbf24")

`;

const DRAFT_KEY = '__draft__';

type RunnerEntry = {
  isRunning: boolean;
  lastResult: RunResult | null;
  runError: string | null;
  lastTickTs: number | null;
};

export type RunningScript = {
  scriptId: string;
  outputs: ScriptOutput[];
};

function emptyEntry(): RunnerEntry {
  return {
    isRunning: false,
    lastResult: null,
    runError: null,
    lastTickTs: null,
  };
}

export class IndicatorState extends SavedScriptDraft<ScriptInfo> {
  runners = $state<Record<string, RunnerEntry>>({});

  #aborts = new Map<string, AbortController>();

  constructor() {
    super({
      store: {
        list: () => listScripts(),
        create: (name, code) => createScript(name, code),
        update: (id, patch) => updateScript(id, patch),
        remove: id => deleteScript(id),
      },
      untitled: 'Untitled',
      starterCode: STARTER_CODE,
      loadFailed: 'Failed to load scripts',
    });
  }

  override clearSaved(): void {
    super.clearSaved();
    this.stopAll();
  }

  protected override draftReplaced(): void {
    this.stop(DRAFT_KEY);
  }

  protected override scriptRemoved(id: string): void {
    this.stop(id);
  }

  #activeKey = $derived(this.activeId ?? DRAFT_KEY);

  isRunning = $derived(this.runners[this.#activeKey]?.isRunning ?? false);
  lastResult = $derived<RunResult | null>(
    this.runners[this.#activeKey]?.lastResult ?? null,
  );
  runError = $derived<string | null>(
    this.runners[this.#activeKey]?.runError ?? null,
  );

  /** ID of the saved script the editor currently shows, if it has a runner. */
  runningId = $derived<string | null>(
    this.activeId && this.runners[this.activeId] ? this.activeId : null,
  );

  /** Saved-script runners only (excludes the draft sentinel). */
  runningIds = $derived(Object.keys(this.runners).filter(k => k !== DRAFT_KEY));

  /** Outputs to merge onto the chart, one entry per running saved script. */
  runningOutputs = $derived<RunningScript[]>(
    this.runningIds
      .map(id => {
        const entry = this.runners[id];
        if (!entry?.lastResult || entry.lastResult.status !== 'ok') return null;
        return { scriptId: id, outputs: entry.lastResult.outputs };
      })
      .filter((x): x is RunningScript => x !== null),
  );

  isRunningOk(id: string): boolean {
    const e = this.runners[id];
    if (!e) return false;
    return e.isRunning || e.lastResult?.status === 'ok';
  }

  async saveAndRun(
    ctx: Omit<ExecuteParams, 'code' | 'script_id'>,
  ): Promise<RunResult | null> {
    const saved = await this.save();
    return saved ? this.start(saved.id, ctx) : null;
  }

  /**
   * Run the active editor context. Saved id is used as the key when present
   * (so the run is auto-rerun-eligible); otherwise a one-shot draft entry is
   * recorded under DRAFT_KEY.
   */
  async run(
    ctx: Omit<ExecuteParams, 'code' | 'script_id'>,
  ): Promise<RunResult | null> {
    const key = this.activeId ?? DRAFT_KEY;
    return this.#runFor(key, ctx);
  }

  /**
   * Start (or re-run) a saved script by id, independent of the editor's
   * active script. Always uses the saved code on disk (ignores any dirty
   * draft for the same id).
   */
  async start(
    id: string,
    ctx: Omit<ExecuteParams, 'code' | 'script_id'>,
  ): Promise<RunResult | null> {
    if (id === DRAFT_KEY) return null;
    return this.#runFor(id, ctx, { forceSaved: true });
  }

  stop(id: string): void {
    this.#aborts.get(id)?.abort();
    this.#aborts.delete(id);
    delete this.runners[id];
  }

  stopAll(): void {
    for (const id of Object.keys(this.runners)) this.stop(id);
  }

  /**
   * Force-rerun every saved-script runner regardless of tick dedup. Used when
   * the underlying market data context changes (symbol/interval/period).
   */
  rerunAll(ctx: Omit<ExecuteParams, 'code' | 'script_id'>): void {
    for (const id of this.runningIds) {
      const entry = this.runners[id];
      if (!entry) continue;
      entry.lastTickTs = null;
      void this.#runFor(id, ctx);
    }
  }

  /**
   * Auto-rerun on each new live bar close. Re-runs every saved-script runner
   * that isn't already in flight, hasn't already processed this bar, and
   * whose previous run succeeded.
   */
  tickAll(ctx: Omit<ExecuteParams, 'code' | 'script_id'>, barTs: number): void {
    for (const id of this.runningIds) {
      const entry = this.runners[id];
      if (!entry || entry.isRunning) continue;
      if (entry.lastResult?.status !== 'ok') continue;
      if (entry.lastTickTs !== null && entry.lastTickTs >= barTs) continue;
      entry.lastTickTs = barTs;
      void this.#runFor(id, ctx);
    }
  }

  async #runFor(
    key: string,
    ctx: Omit<ExecuteParams, 'code' | 'script_id'>,
    opts: { forceSaved?: boolean } = {},
  ): Promise<RunResult | null> {
    if (this.isRemoving(key)) return null;
    this.#aborts.get(key)?.abort();
    const controller = new AbortController();
    this.#aborts.set(key, controller);

    const existing = this.runners[key] ?? emptyEntry();
    this.runners[key] = { ...existing, isRunning: true, runError: null };

    const isDraft = key === DRAFT_KEY;
    const params: ExecuteParams = { ...ctx };
    if (isDraft) {
      params.code = this.draftCode;
    } else if (!opts.forceSaved && key === this.activeId && this.dirty) {
      params.code = this.draftCode;
    } else {
      params.script_id = key;
    }

    try {
      const res = await executeScript(params, controller.signal);
      if (controller.signal.aborted || this.#aborts.get(key) !== controller)
        return null;
      const cur = this.runners[key];
      if (cur) {
        this.runners[key] = { ...cur, isRunning: false, lastResult: res };
      }
      return res;
    } catch (err) {
      if (controller.signal.aborted || this.#aborts.get(key) !== controller)
        return null;
      const cur = this.runners[key];
      if (cur) {
        this.runners[key] = {
          ...cur,
          isRunning: false,
          runError: err instanceof Error ? err.message : 'Run failed',
        };
      }
      return null;
    } finally {
      if (this.#aborts.get(key) === controller) this.#aborts.delete(key);
    }
  }
}

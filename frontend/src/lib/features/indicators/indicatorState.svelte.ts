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

export class IndicatorState {
  scripts = $state<ScriptInfo[]>([]);
  loading = $state(false);
  loadError = $state<string | null>(null);

  activeId = $state<string | null>(null);
  draftName = $state('Untitled');
  draftCode = $state(STARTER_CODE);
  dirty = $state(false);

  isSaving = $state(false);
  saveError = $state<string | null>(null);

  runners = $state<Record<string, RunnerEntry>>({});

  #aborts = new Map<string, AbortController>();
  #draftVersion = $state(0);
  #revision = 0;
  #listRequest = 0;
  #scriptsRevision = 0;
  #savingId: string | null = null;
  #deleting = new Set<string>();
  #accountVersion = 0;

  clearSaved(): void {
    this.#accountVersion++;
    this.#listRequest++;
    this.#scriptsRevision++;
    this.#draftVersion++;
    this.scripts = [];
    this.loading = false;
    this.loadError = null;
    this.saveError = null;
    if (this.activeId) this.dirty = true;
    this.activeId = null;
    this.stopAll();
  }

  get draftVersion(): number {
    return this.#draftVersion;
  }

  active = $derived.by(() =>
    this.activeId
      ? (this.scripts.find(s => s.id === this.activeId) ?? null)
      : null,
  );

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

  async refresh(): Promise<void> {
    const request = ++this.#listRequest;
    const revision = this.#scriptsRevision;
    this.loading = true;
    this.loadError = null;
    try {
      const scripts = await listScripts();
      if (request === this.#listRequest && revision === this.#scriptsRevision)
        this.scripts = scripts;
    } catch (err) {
      if (request === this.#listRequest && revision === this.#scriptsRevision)
        this.loadError =
          err instanceof Error ? err.message : 'Failed to load scripts';
    } finally {
      if (request === this.#listRequest) this.loading = false;
    }
  }

  newDraft(
    discard = () => confirm('Discard unsaved indicator changes?'),
  ): void {
    if (this.dirty && !discard()) return;
    this.#draftVersion++;
    this.stop(DRAFT_KEY);
    this.activeId = null;
    this.draftName = 'Untitled';
    this.draftCode = STARTER_CODE;
    this.dirty = false;
    this.saveError = null;
  }

  openScript(
    id: string,
    discard = () => confirm('Discard unsaved indicator changes?'),
  ): void {
    if (id === this.activeId) return;
    const s = this.scripts.find(x => x.id === id);
    if (!s) return;
    if (this.dirty && !discard()) return;
    this.#draftVersion++;
    this.stop(DRAFT_KEY);
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

  async save(): Promise<ScriptInfo | null> {
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
    const accountVersion = this.#accountVersion;
    try {
      let saved: ScriptInfo;
      if (id) {
        saved = await updateScript(id, {
          name,
          code,
        });
      } else {
        saved = await createScript(name, code);
      }
      if (accountVersion !== this.#accountVersion) return null;
      this.#scriptsRevision++;
      const idx = this.scripts.findIndex(s => s.id === saved.id);
      if (idx >= 0) this.scripts[idx] = saved;
      else this.scripts = [saved, ...this.scripts];
      if (version === this.#draftVersion) {
        if (!id) this.stop(DRAFT_KEY);
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

  async delete(id: string): Promise<void> {
    if (this.isSaving && this.#savingId === id)
      throw new Error('Wait for the save to finish before deleting');
    if (this.#deleting.has(id)) return;
    this.#deleting.add(id);
    const version = this.#draftVersion;
    const revision = this.#revision;
    const accountVersion = this.#accountVersion;
    try {
      await deleteScript(id);
      if (accountVersion !== this.#accountVersion) return;
      this.#scriptsRevision++;
      this.scripts = this.scripts.filter(s => s.id !== id);
      this.stop(id);
      if (this.activeId === id) {
        if (version === this.#draftVersion && revision === this.#revision)
          this.newDraft(() => true);
        else {
          this.#draftVersion++;
          this.stop(DRAFT_KEY);
          this.activeId = null;
          this.dirty = true;
        }
      }
    } finally {
      this.#deleting.delete(id);
    }
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
    if (this.#deleting.has(key)) return null;
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

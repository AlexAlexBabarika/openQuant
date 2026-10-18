import { apiJson } from '$lib/core/api';
import type { OptionsAnalysis, OptionsDraft } from './optionsTypes';
import { applyOptionsTemplate, createOptionsDraft } from './optionsTemplates';
import { matchTemplate, quotedSpot } from './optionsInputs';
import { fittedSpotGrid, needsRefit, sameGrid } from './optionsGrid';
import { exportOptionsPython, OPTIONS_SOURCE_LIMIT } from './optionsPython';
import { optionsErrors } from './optionsValidation';
import {
  decodeLegacyOptions,
  decodeOptionsStorage,
  encodeOptionsStorage,
  exportOptionsBundle,
  importOptionsBundle,
  optionsScope,
  validSaved,
  MAX_OPTIONS_DRAFTS,
  MAX_OPTIONS_REVISIONS,
  OPTIONS_AUTOSAVE_DELAY,
  type OptionsMode,
  type OptionsSavedDraft,
  type OptionsWorkingDraft,
  type OptionsRecovery,
  type OptionsDraftRevision,
} from './optionsPersistence';
import {
  comparisonSnapshot,
  optionsResultCsv,
  optionsResultReport,
  type OptionsComparisonSnapshot,
} from './optionsComparison';
export { optionsErrors } from './optionsValidation';
export type { OptionsMode, OptionsSavedDraft } from './optionsPersistence';
const REQUEST_TIMEOUT = 15000;
const HISTORY_LIMIT = 50;
type AnalysisResponse = OptionsAnalysis & { stdout?: string };
type Analyze = (path: string, init: RequestInit) => Promise<AnalysisResponse>;

export class OptionsState {
  draft = $state<OptionsDraft>(createOptionsDraft(new Date()));
  mode = $state<OptionsMode>('editor');
  source = $state(exportOptionsPython(createOptionsDraft(new Date())));
  documentKey = $state(0);
  result = $state<OptionsAnalysis | null>(null);
  submittedSource = $state<string | null>(null);
  stdout = $state<string | null>(null);
  loading = $state(false);
  error = $state<string | null>(null);
  notice = $state<string | null>(null);
  fieldErrors = $state<Record<string, string>>({});
  saved = $state<OptionsSavedDraft[]>([]);
  recovery = $state<OptionsRecovery | null>(null);
  comparisons = $state.raw<OptionsComparisonSnapshot[]>([]);
  storageError = $state<string | null>(null);
  scopeLabel = $state('Guest · this browser only');
  /** Frontend-only: refit the display grid to strikes, spot and breakevens on edits. */
  gridAuto = $state(true);
  /** Frontend-only: spot and underlying follow the workspace chart until a spot is typed. */
  spotLinked = $state(true);
  workspace = $state<{ symbol: string | null; spot: number | null }>({
    symbol: null,
    spot: null,
  });
  #past = $state.raw<OptionsDraft[]>([]);
  #future = $state.raw<OptionsDraft[]>([]);
  #submittedKey = $state('');
  #scope = '';
  #generation = 0;
  #controller: AbortController | null = null;
  #storage: Storage | null;
  #readFailed = false;
  #dirty = false;
  #autosave: ReturnType<typeof setTimeout> | null = null;
  #analyze: Analyze;
  #pinId = 0;

  constructor(
    storage?: Storage | null,
    analyze: Analyze = apiJson<AnalysisResponse>,
  ) {
    try {
      this.#storage =
        storage === undefined
          ? typeof localStorage === 'undefined'
            ? null
            : localStorage
          : storage;
    } catch {
      this.#storage = null;
    }
    this.#analyze = analyze;
  }
  get stale(): boolean {
    return this.result !== null && this.#submittedKey !== this.#inputKey();
  }
  get canUndo(): boolean {
    return this.#past.length > 0;
  }
  get canRedo(): boolean {
    return this.#future.length > 0;
  }
  #inputKey(): string {
    return this.mode === 'python'
      ? `python:${this.source}`
      : `editor:${JSON.stringify(this.draft)}`;
  }
  #working(): OptionsWorkingDraft {
    return {
      draft: structuredClone($state.snapshot(this.draft)),
      mode: this.mode,
      source: this.source,
    };
  }
  #stopAutosave(): void {
    if (this.#autosave !== null) clearTimeout(this.#autosave);
    this.#autosave = null;
  }
  setAccount(id: string | null): void {
    const scope = optionsScope(id);
    if (scope === this.#scope) return;
    this.flushRecovery();
    this.#stopAutosave();
    this.cancel(false);
    this.#scope = scope;
    this.#readFailed = false;
    this.#dirty = false;
    this.documentKey++;
    this.scopeLabel = id
      ? 'Account · this browser only'
      : 'Guest · this browser only';
    this.draft = createOptionsDraft(new Date());
    this.gridAuto = true;
    this.spotLinked = true;
    this.#followWorkspace();
    this.source = exportOptionsPython(this.draft);
    this.mode = 'editor';
    this.result = null;
    this.submittedSource = null;
    this.stdout = null;
    this.#submittedKey = '';
    this.#past = [];
    this.#future = [];
    this.comparisons = [];
    this.error = null;
    this.notice = null;
    this.fieldErrors = {};
    this.saved = [];
    this.recovery = null;
    this.storageError = null;
    try {
      if (!this.#storage)
        throw new Error(
          'Local options drafts could not be read: storage is unavailable. Existing data is unchanged; current edits remain in memory.',
        );
      const raw = this.#storage.getItem(`openquant.options.v2:${scope}`);
      if (raw !== null) {
        const data = decodeOptionsStorage(raw);
        this.saved = data.drafts;
        this.recovery = data.recovery;
      } else {
        const legacy = this.#storage.getItem(`openquant.options.v1:${scope}`);
        if (legacy !== null) this.saved = decodeLegacyOptions(legacy);
      }
      this.saved = this.saved.map(item => ({
        ...$state.snapshot(item),
        id: item.id ?? crypto.randomUUID(),
      }));
    } catch (e) {
      this.#readFailed = true;
      this.storageError =
        e instanceof Error
          ? e.message
          : 'Local options drafts could not be read. Existing data is unchanged.';
    }
  }
  editDraft(update: (draft: OptionsDraft) => void): void {
    const before = structuredClone($state.snapshot(this.draft));
    const next = structuredClone(before);
    update(next);
    if (this.gridAuto && needsRefit(before, next))
      next.spot_grid = fittedSpotGrid(next);
    this.changed();
    this.#past = [...this.#past, before].slice(-HISTORY_LIMIT);
    this.#future = [];
    this.draft = next;
    this.#scheduleRecovery();
  }
  syncWorkspace(symbol: string | null, spot: number | null): void {
    this.workspace = {
      symbol: symbol?.trim() || null,
      spot: spot !== null && Number.isFinite(spot) ? quotedSpot(spot) : null,
    };
    this.#followWorkspace();
  }
  /** Typing a spot stops following the workspace. */
  setSpot(spot: number): void {
    this.spotLinked = false;
    this.editDraft(d => {
      d.spot = spot;
    });
  }
  linkWorkspace(): void {
    this.spotLinked = true;
    this.#followWorkspace();
  }
  /** Not an undoable edit: the workspace moved, not the user. Untouched templates re-center on the new spot. */
  #followWorkspace(): void {
    const { symbol, spot } = this.workspace;
    if (
      !this.spotLinked ||
      spot === null ||
      !Number.isFinite(spot) ||
      spot <= 0 ||
      spot > 1000000 ||
      (spot === this.draft.spot &&
        (symbol === null || symbol === this.draft.strategy.underlying))
    )
      return;
    const before = structuredClone($state.snapshot(this.draft));
    const next = structuredClone(before);
    const template = matchTemplate(before);
    next.spot = spot;
    if (symbol) next.strategy.underlying = symbol.slice(0, 80);
    if (template) {
      applyOptionsTemplate(next, template);
      next.strategy.name = before.strategy.name;
    }
    if (this.gridAuto && needsRefit(before, next))
      next.spot_grid = fittedSpotGrid(next);
    this.draft = next;
    this.#scheduleRecovery();
  }
  setGrid(grid: number[]): void {
    this.gridAuto = false;
    this.editDraft(d => {
      d.spot_grid = grid;
    });
  }
  fitGrid(): void {
    this.gridAuto = true;
    this.editDraft(d => {
      d.spot_grid = fittedSpotGrid(d);
    });
  }
  undo(): boolean {
    const previous = this.#past[this.#past.length - 1];
    if (!previous) return false;
    this.changed();
    this.#future = [
      ...this.#future,
      structuredClone($state.snapshot(this.draft)),
    ].slice(-HISTORY_LIMIT);
    this.#past = this.#past.slice(0, -1);
    this.draft = structuredClone(previous);
    this.#scheduleRecovery();
    return true;
  }
  redo(): boolean {
    const next = this.#future[this.#future.length - 1];
    if (!next) return false;
    this.changed();
    this.#past = [
      ...this.#past,
      structuredClone($state.snapshot(this.draft)),
    ].slice(-HISTORY_LIMIT);
    this.#future = this.#future.slice(0, -1);
    this.draft = structuredClone(next);
    this.#scheduleRecovery();
    return true;
  }
  setSource(source: string): void {
    this.changed();
    this.source = source;
    this.#scheduleRecovery();
  }
  setMode(mode: OptionsMode): void {
    if (mode === this.mode) return;
    this.changed();
    this.mode = mode;
    this.#scheduleRecovery();
  }
  changed(): void {
    if (this.loading) this.cancel();
    this.error = null;
    this.fieldErrors = {};
  }
  exportPython(): boolean {
    this.fieldErrors = optionsErrors(this.draft);
    if (Object.keys(this.fieldErrors).length) {
      this.error = 'Complete the editor fields before replacing Python.';
      return false;
    }
    let source: string;
    try {
      source = exportOptionsPython(this.draft);
    } catch (error) {
      this.error =
        error instanceof Error
          ? error.message
          : 'Python export failed. Source is unchanged.';
      return false;
    }
    this.changed();
    this.source = source;
    this.mode = 'python';
    this.documentKey++;
    this.#submittedKey = '';
    this.#scheduleRecovery();
    this.notice =
      'Python replaced explicitly from the editor. Later editor changes do not overwrite it.';
    return true;
  }
  cancel(showNotice = true): void {
    this.#generation++;
    this.#controller?.abort();
    this.#controller = null;
    this.loading = false;
    if (showNotice)
      this.notice =
        'Analysis cancelled. Existing evidence, if any, is unchanged.';
  }
  dispose(): void {
    this.flushRecovery();
    this.#stopAutosave();
    this.cancel(false);
  }

  async run(): Promise<void> {
    if (this.loading) return;
    this.error = null;
    this.notice = null;
    this.fieldErrors = this.mode === 'editor' ? optionsErrors(this.draft) : {};
    if (Object.keys(this.fieldErrors).length) {
      this.error = 'Check the marked options inputs. No request was sent.';
      return;
    }
    if (
      this.mode === 'python' &&
      (!this.source.trim() || this.source.length > OPTIONS_SOURCE_LIMIT)
    ) {
      this.error = `Python needs 1–${OPTIONS_SOURCE_LIMIT.toLocaleString()} characters.`;
      return;
    }
    const key = this.#inputKey();
    const source = this.mode === 'python' ? this.source : null;
    const path = source === null ? '/options/analyze' : '/options/python';
    const body =
      source === null ? JSON.stringify(this.draft) : JSON.stringify({ source });
    const controller = new AbortController();
    const generation = ++this.#generation;
    this.#controller = controller;
    this.loading = true;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT);
    try {
      const result = await this.#analyze(path, {
        method: 'POST',
        body,
        signal: controller.signal,
      });
      if (
        generation !== this.#generation ||
        controller.signal.aborted ||
        key !== this.#inputKey()
      )
        return;
      this.result = result;
      this.submittedSource = source;
      this.stdout = result.stdout ?? null;
      this.#submittedKey = key;
    } catch (error) {
      if (generation !== this.#generation) return;
      this.error = timedOut
        ? 'Options analysis timed out. Inputs are unchanged; retry explicitly.'
        : error instanceof Error
          ? error.message
          : 'Options analysis failed. Inputs are unchanged; retry explicitly.';
    } finally {
      clearTimeout(timer);
      if (generation === this.#generation) {
        this.loading = false;
        this.#controller = null;
        if (timedOut && !this.error)
          this.error = 'Options analysis timed out. Retry explicitly.';
      }
    }
  }
  #scheduleRecovery(): void {
    this.#dirty = true;
    this.#stopAutosave();
    this.#autosave = setTimeout(() => {
      this.#autosave = null;
      this.flushRecovery();
    }, OPTIONS_AUTOSAVE_DELAY);
  }
  #persist(drafts: OptionsSavedDraft[], recovery = this.recovery): boolean {
    if (this.#readFailed) {
      this.storageError =
        'Local saving is paused because options drafts could not be read. Existing data is unchanged; export/copy working inputs, repair browser storage and reload this panel before saving.';
      return false;
    }
    try {
      if (!this.#storage || !this.#scope)
        throw new Error(
          'Options draft was not saved: storage is unavailable. Keep the panel open and export/copy inputs before closing.',
        );
      const raw = encodeOptionsStorage({
        version: 2,
        drafts,
        recovery: recovery ? $state.snapshot(recovery) : null,
      });
      this.#storage.setItem(`openquant.options.v2:${this.#scope}`, raw);
      this.saved = drafts;
      this.recovery = recovery;
      this.storageError = null;
      return true;
    } catch (e) {
      this.storageError =
        e instanceof Error && e.message.startsWith('Options')
          ? e.message
          : 'Options draft was not saved: browser storage is unavailable or full. Export/copy inputs, free storage, then retry; current edits remain in memory.';
      return false;
    }
  }
  flushRecovery(): boolean {
    this.#stopAutosave();
    if (!this.#dirty) return true;
    const recovery = {
      ...this.#working(),
      updatedAt: new Date().toISOString(),
    };
    if (!this.#persist($state.snapshot(this.saved), recovery)) return false;
    this.#dirty = false;
    return true;
  }
  discardRecovery(): boolean {
    if (!this.#persist($state.snapshot(this.saved), null)) return false;
    this.#stopAutosave();
    this.#dirty = false;
    this.notice =
      'Working recovery discarded for this browser scope. Current edits remain in memory.';
    return true;
  }
  #apply(value: OptionsWorkingDraft, notice: string): void {
    this.changed();
    this.#past = [
      ...this.#past,
      structuredClone($state.snapshot(this.draft)),
    ].slice(-HISTORY_LIMIT);
    this.#future = [];
    this.draft = structuredClone(value.draft);
    this.gridAuto = sameGrid(this.draft.spot_grid, fittedSpotGrid(this.draft));
    this.source = value.source;
    this.mode = value.mode;
    this.documentKey++;
    this.#submittedKey = '';
    this.#scheduleRecovery();
    this.notice = notice;
  }
  recover(): boolean {
    if (!this.recovery) return false;
    this.#apply(
      $state.snapshot(this.recovery),
      'Working inputs/source recovered explicitly. Incomplete fields may need repair. Analyze explicitly; no results were restored.',
    );
    return true;
  }
  save(name: string): boolean {
    const item: OptionsSavedDraft = {
      ...this.#working(),
      name: name.trim(),
      id: crypto.randomUUID(),
      revision: 1,
      revisions: [],
      updatedAt: new Date().toISOString(),
    };
    if (!validSaved(item)) {
      this.storageError =
        'Use a name of 1–120 characters, valid editor fields and at most 20,000 Python characters before saving.';
      return false;
    }
    if (this.saved.length >= MAX_OPTIONS_DRAFTS) {
      this.storageError =
        'At most 10 named options drafts per scope. Delete one before saving.';
      return false;
    }
    const ok = this.#persist([item, ...$state.snapshot(this.saved)]);
    if (ok)
      this.notice =
        'Named options draft saved locally. It is not encrypted storage or cloud sync.';
    return ok;
  }
  #update(index: number, name: string, value: OptionsWorkingDraft): boolean {
    const old = $state.snapshot(this.saved[index]);
    if (!old) return false;
    const previous: OptionsDraftRevision = {
      name: old.name,
      revision: old.revision ?? 1,
      updatedAt: old.updatedAt,
      draft: old.draft,
      source: old.source,
      mode: old.mode,
    };
    const item: OptionsSavedDraft = {
      ...value,
      name: name.trim(),
      id: old.id ?? crypto.randomUUID(),
      revision: previous.revision + 1,
      revisions: [previous, ...(old.revisions ?? [])].slice(
        0,
        MAX_OPTIONS_REVISIONS,
      ),
      updatedAt: new Date().toISOString(),
    };
    if (!validSaved(item)) {
      this.storageError =
        'Update not saved: use a valid name, complete editor fields and bounded Python source.';
      return false;
    }
    const drafts = structuredClone($state.snapshot(this.saved));
    drafts[index] = item;
    return this.#persist(drafts);
  }
  updateSaved(index: number): boolean {
    return this.#update(index, this.saved[index]?.name ?? '', this.#working());
  }
  renameSaved(index: number, name: string): boolean {
    const old = this.saved[index];
    return old
      ? this.#update(index, name, {
          draft: $state.snapshot(old.draft),
          mode: old.mode,
          source: old.source,
        })
      : false;
  }
  restore(index: number, revision?: number): boolean {
    const item = this.saved[index];
    const value =
      revision === undefined || revision === item?.revision
        ? item
        : item?.revisions?.find(r => r.revision === revision);
    if (!value || !validSaved({ ...$state.snapshot(value) })) return false;
    this.#apply(
      $state.snapshot(value),
      `Restored ${value.name}${revision ? ` revision ${revision}` : ''}. Analyze explicitly; no stored results were loaded.`,
    );
    return true;
  }
  remove(index: number): boolean {
    return this.#persist(
      $state.snapshot(this.saved).filter((_, i) => i !== index),
    );
  }
  exportBundle(): string {
    return exportOptionsBundle($state.snapshot(this.saved));
  }
  importBundle(raw: string, applyFirst = false): boolean {
    try {
      const imported = importOptionsBundle(raw).map(d => ({
        ...d,
        id: crypto.randomUUID(),
      }));
      if (this.saved.length + imported.length > MAX_OPTIONS_DRAFTS)
        throw new Error(
          'Import exceeds 10 drafts in this scope. Existing records are unchanged; remove/export records or import fewer drafts.',
        );
      if (!this.#persist([...imported, ...$state.snapshot(this.saved)]))
        return false;
      if (applyFirst)
        this.#apply(
          imported[0],
          'Imported and restored the first named draft explicitly. Analyze explicitly; no stored results were loaded.',
        );
      else
        this.notice =
          'Draft bundle imported into this browser scope. Restore explicitly to replace working inputs/source.';
      return true;
    } catch (e) {
      this.storageError =
        e instanceof Error
          ? e.message
          : 'Import failed; existing records are unchanged.';
      return false;
    }
  }
  exportSource(): string {
    return this.source;
  }
  exportCsv(): string | null {
    return this.result ? optionsResultCsv($state.snapshot(this.result)) : null;
  }
  exportReport(): string | null {
    return this.result
      ? optionsResultReport(
          $state.snapshot(this.result),
          this.submittedSource,
          this.stdout,
        )
      : null;
  }
  pin(): boolean {
    if (!this.result) {
      this.notice = 'Analyze explicitly before pinning submitted evidence.';
      return false;
    }
    if (this.comparisons.length >= 3) {
      this.notice = 'At most 3 session-only comparisons. Unpin one first.';
      return false;
    }
    this.comparisons = [
      ...this.comparisons,
      comparisonSnapshot(
        `options-pin-${++this.#pinId}`,
        $state.snapshot(this.result),
        this.submittedSource,
      ),
    ];
    this.notice =
      'Submitted evidence pinned for this session only, not current edits. Different assumptions are not apples-to-apples.';
    return true;
  }
  unpin(id: string): void {
    this.comparisons = this.comparisons.filter(item => item.id !== id);
  }
}

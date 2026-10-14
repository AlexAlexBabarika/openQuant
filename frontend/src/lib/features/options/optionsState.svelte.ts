import { apiJson } from '$lib/core/api';
import type { OptionsAnalysis, OptionsDraft } from './optionsTypes';
import { createOptionsDraft } from './optionsTemplates';
import { exportOptionsPython, OPTIONS_SOURCE_LIMIT } from './optionsPython';

export type OptionsMode = 'editor' | 'python';
export type OptionsSavedDraft = {
  name: string;
  updatedAt: string;
  draft: OptionsDraft;
  mode: OptionsMode;
  source: string;
};
const MAX_DRAFTS = 10;
const MAX_STORAGE = 300000;
const REQUEST_TIMEOUT = 15000;

export function optionsErrors(d: OptionsDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  const number = (
    key: string,
    v: number,
    min: number,
    max: number,
    integer = false,
  ) => {
    if (
      !Number.isFinite(v) ||
      v < min ||
      v > max ||
      (integer && !Number.isInteger(v))
    )
      errors[key] =
        `${integer ? 'Integer' : 'Number'} required, ${min === Number.MIN_VALUE ? '>0' : min} to ${max}.`;
  };
  const name = (key: string, v: string, max: number) => {
    if (typeof v !== 'string' || !v.trim() || v.length > max)
      errors[key] = `Enter a nonblank name (up to ${max} characters).`;
  };
  name('strategy.name', d.strategy.name, 120);
  if (
    d.strategy.currency !== 'USD' ||
    d.strategy.exercise_style !== 'european' ||
    d.strategy.settlement !== 'cash'
  )
    errors.strategy = 'Only USD European cash-settled research is supported.';
  if (
    ![
      'custom',
      'long_call',
      'long_put',
      'call_vertical',
      'put_vertical',
      'straddle',
      'strangle',
      'iron_condor',
      'iron_butterfly',
      'covered_call',
      'protective_put',
    ].includes(d.strategy.template)
  )
    errors.strategy = 'Unknown template label.';
  number('strategy.days_to_expiry', d.strategy.days_to_expiry, 0, 3650);
  number(
    'strategy.entry_fee_per_contract',
    d.strategy.entry_fee_per_contract,
    0,
    10000,
  );
  number('spot', d.spot, Number.MIN_VALUE, 1000000);
  number('volatility', d.volatility, 0, 5);
  number('rate', d.rate, -1, 1);
  number('dividend_yield', d.dividend_yield, -1, 1);
  if (
    !Array.isArray(d.strategy.legs) ||
    d.strategy.legs.length < 1 ||
    d.strategy.legs.length > 16
  )
    errors.legs = 'Use 1–16 legs, with at least one enabled.';
  else {
    if (!d.strategy.legs.some(l => l.enabled))
      errors.legs = 'Enable at least one leg.';
    d.strategy.legs.forEach((l, i) => {
      const key = `legs.${i}`;
      if (!['call', 'put', 'underlying'].includes(l.kind))
        errors[`${key}.kind`] = 'Choose call, put or underlying.';
      if (typeof l.enabled !== 'boolean')
        errors[`${key}.enabled`] = 'Enabled must be true or false.';
      const limit = l.kind === 'underlying' ? 1000000 : 10000;
      number(`${key}.quantity`, l.quantity, -limit, limit, true);
      if (l.quantity === 0)
        errors[`${key}.quantity`] =
          'Quantity cannot be zero; use positive buy or negative sell.';
      number(`${key}.entry_premium`, l.entry_premium, 0, 1000000);
      number(`${key}.multiplier`, l.multiplier, 1, 1000, true);
      if (l.kind === 'underlying') {
        if (l.strike !== null || l.multiplier !== 1)
          errors[`${key}.multiplier`] =
            'Underlying uses no strike and multiplier 1.';
      } else
        number(`${key}.strike`, l.strike as number, Number.MIN_VALUE, 1000000);
    });
  }
  if (
    !Array.isArray(d.spot_grid) ||
    d.spot_grid.length < 2 ||
    d.spot_grid.length > 201 ||
    d.spot_grid.some(
      (s, i) =>
        !Number.isFinite(s) ||
        s < 0 ||
        s > 1000000 ||
        (i > 0 && s <= d.spot_grid[i - 1]),
    )
  )
    errors.spot_grid =
      'Use 2–201 strictly increasing USD spots, from 0 to 1,000,000.';
  if (!Array.isArray(d.scenarios) || d.scenarios.length > 3)
    errors.scenarios = 'Use at most 3 scenarios.';
  else {
    const names = new Set<string>();
    d.scenarios.forEach((s, i) => {
      const key = `scenarios.${i}`;
      name(`${key}.name`, s.name, 80);
      if (names.has(s.name))
        errors[`${key}.name`] = 'Scenario names must be unique.';
      names.add(s.name);
      number(
        `${key}.elapsed_days`,
        s.elapsed_days,
        0,
        d.strategy.days_to_expiry,
      );
      number(`${key}.iv_shift_pp`, s.iv_shift_pp, -100, 100);
      if (
        d.volatility + s.iv_shift_pp / 100 < 0 ||
        d.volatility + s.iv_shift_pp / 100 > 5
      )
        errors[`${key}.iv_shift_pp`] =
          'Shifted IV must stay between 0% and 500%.';
    });
  }
  return errors;
}

function validSaved(value: unknown): value is OptionsSavedDraft {
  if (!value || typeof value !== 'object') return false;
  const v = value as OptionsSavedDraft;
  try {
    return (
      typeof v.name === 'string' &&
      !!v.name.trim() &&
      v.name.length <= 120 &&
      typeof v.updatedAt === 'string' &&
      Number.isFinite(Date.parse(v.updatedAt)) &&
      (v.mode === 'editor' || v.mode === 'python') &&
      typeof v.source === 'string' &&
      v.source.length <= OPTIONS_SOURCE_LIMIT &&
      Object.keys(optionsErrors(v.draft)).length === 0
    );
  } catch {
    return false;
  }
}

type Analyze = (path: string, init: RequestInit) => Promise<OptionsAnalysis>;

export class OptionsState {
  draft = $state<OptionsDraft>(createOptionsDraft());
  mode = $state<OptionsMode>('editor');
  source = $state(exportOptionsPython(createOptionsDraft()));
  result = $state<OptionsAnalysis | null>(null);
  submittedSource = $state<string | null>(null);
  loading = $state(false);
  error = $state<string | null>(null);
  notice = $state<string | null>(null);
  fieldErrors = $state<Record<string, string>>({});
  saved = $state<OptionsSavedDraft[]>([]);
  storageError = $state<string | null>(null);
  #submittedKey = $state('');
  #accountKey = '';
  #generation = 0;
  #controller: AbortController | null = null;
  #storage: Storage | null;
  #readFailed = false;
  #analyze: Analyze;

  constructor(
    storage?: Storage | null,
    analyze: Analyze = apiJson<OptionsAnalysis>,
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
  #inputKey(): string {
    return this.mode === 'python'
      ? `python:${this.source}`
      : `editor:${JSON.stringify(this.draft)}`;
  }

  setAccount(id: string | null): void {
    const key = `openquant.options.v1:${id ? `account:${encodeURIComponent(id)}` : 'guest'}`;
    if (key === this.#accountKey) return;
    this.cancel(false);
    this.#accountKey = key;
    this.#readFailed = false;
    this.draft = createOptionsDraft();
    this.source = exportOptionsPython(this.draft);
    this.mode = 'editor';
    this.result = null;
    this.submittedSource = null;
    this.#submittedKey = '';
    this.error = null;
    this.notice = null;
    this.fieldErrors = {};
    this.saved = [];
    this.storageError = null;
    try {
      if (!this.#storage) throw new Error('Storage unavailable');
      const raw = this.#storage.getItem(key);
      if (!raw) return;
      if (raw.length > MAX_STORAGE) throw new Error('Storage exceeds bounds');
      const data = JSON.parse(raw);
      if (
        data?.version !== 1 ||
        !Array.isArray(data.drafts) ||
        data.drafts.length > MAX_DRAFTS ||
        !data.drafts.every(validSaved)
      )
        throw new Error('Invalid options drafts');
      this.saved = data.drafts;
    } catch {
      this.#readFailed = true;
      this.storageError =
        'Local options drafts could not be read. Existing data is unchanged; repair browser storage before saving. Current edits remain in memory.';
    }
  }

  editDraft(update: (draft: OptionsDraft) => void): void {
    this.changed();
    const next = structuredClone($state.snapshot(this.draft));
    update(next);
    this.draft = next;
  }
  setSource(source: string): void {
    this.changed();
    this.source = source;
  }
  setMode(mode: OptionsMode): void {
    if (mode === this.mode) return;
    this.changed();
    this.mode = mode;
  }
  changed(): void {
    if (this.loading) this.cancel();
    this.error = null;
    this.fieldErrors = {};
  }
  exportPython(): boolean {
    const errors = optionsErrors(this.draft);
    this.fieldErrors = errors;
    if (Object.keys(errors).length) {
      this.error = 'Complete the editor fields before replacing Python.';
      return false;
    }
    this.changed();
    this.source = exportOptionsPython(this.draft);
    this.mode = 'python';
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

  #persist(drafts: OptionsSavedDraft[]): boolean {
    if (this.#readFailed) {
      this.storageError =
        'Local saving is paused because options drafts could not be read. Existing data is unchanged; repair browser storage before saving.';
      return false;
    }
    try {
      if (!this.#storage || !this.#accountKey)
        throw new Error('Storage unavailable');
      const raw = JSON.stringify({ version: 1, drafts });
      if (raw.length > MAX_STORAGE) throw new Error('Storage exceeds bounds');
      this.#storage.setItem(this.#accountKey, raw);
      this.saved = drafts;
      this.storageError = null;
      return true;
    } catch {
      this.storageError =
        'Options draft was not saved: browser storage is unavailable or full. Keep this panel open and copy Python before closing.';
      return false;
    }
  }
  save(name: string): boolean {
    const item: OptionsSavedDraft = {
      name: name.trim(),
      updatedAt: new Date().toISOString(),
      draft: structuredClone($state.snapshot(this.draft)),
      mode: this.mode,
      source: this.source,
    };
    if (!validSaved(item)) {
      this.storageError =
        'Use a name of 1–120 characters, valid editor fields and at most 20,000 Python characters before saving.';
      return false;
    }
    if (this.saved.length >= MAX_DRAFTS) {
      this.storageError =
        'At most 10 named options drafts per scope. Delete one before saving.';
      return false;
    }
    const ok = this.#persist([item, ...this.saved]);
    if (ok)
      this.notice =
        'Named options draft saved locally. It is not encrypted storage or cloud sync.';
    return ok;
  }
  restore(index: number): void {
    const saved = this.saved[index];
    if (!saved) return;
    this.changed();
    this.draft = structuredClone($state.snapshot(saved.draft));
    this.source = saved.source;
    this.mode = saved.mode;
    this.notice = `Restored ${saved.name}. Analyze explicitly to recalculate; no stored results were loaded.`;
  }
  remove(index: number): boolean {
    return this.#persist(this.saved.filter((_, i) => i !== index));
  }
}

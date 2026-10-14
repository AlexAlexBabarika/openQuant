import type { OptionsDraft } from './optionsTypes';
import { OPTIONS_SOURCE_LIMIT } from './optionsPython';
import { optionsErrors, workingDraftShape } from './optionsValidation';

export type OptionsMode = 'editor' | 'python';
export type OptionsWorkingDraft = {
  draft: OptionsDraft;
  mode: OptionsMode;
  source: string;
};
export type OptionsRecovery = OptionsWorkingDraft & { updatedAt: string };
export type OptionsDraftRevision = OptionsRecovery & {
  name: string;
  revision: number;
};
export type OptionsSavedDraft = OptionsRecovery & {
  name: string;
  id?: string;
  revision?: number;
  revisions?: OptionsDraftRevision[];
};
export type OptionsLibraryData = {
  version: 2;
  drafts: OptionsSavedDraft[];
  recovery: OptionsRecovery | null;
};
export const MAX_OPTIONS_DRAFTS = 10;
export const MAX_OPTIONS_REVISIONS = 3;
export const MAX_OPTIONS_STORAGE = 1000000;
export const OPTIONS_AUTOSAVE_DELAY = 500;

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const only = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).every(k => keys.includes(k));
const timestamp = (v: unknown) =>
  typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v));
const name = (v: unknown) =>
  typeof v === 'string' && !!v.trim() && v.length <= 120;
function working(v: unknown, strict: boolean): boolean {
  return (
    object(v) &&
    (v.mode === 'editor' || v.mode === 'python') &&
    typeof v.source === 'string' &&
    v.source.length <= OPTIONS_SOURCE_LIMIT &&
    workingDraftShape(v.draft) &&
    (!strict || Object.keys(optionsErrors(v.draft)).length === 0)
  );
}
export function validRecovery(v: unknown): v is OptionsRecovery {
  return (
    object(v) &&
    only(v, ['updatedAt', 'draft', 'mode', 'source']) &&
    timestamp(v.updatedAt) &&
    working(v, false)
  );
}
function validRevision(v: unknown): v is OptionsDraftRevision {
  return (
    object(v) &&
    only(v, ['name', 'revision', 'updatedAt', 'draft', 'mode', 'source']) &&
    name(v.name) &&
    timestamp(v.updatedAt) &&
    Number.isSafeInteger(v.revision) &&
    (v.revision as number) >= 1 &&
    working(v, true)
  );
}
export function validSaved(v: unknown): v is OptionsSavedDraft {
  return (
    object(v) &&
    only(v, [
      'id',
      'name',
      'revision',
      'revisions',
      'updatedAt',
      'draft',
      'mode',
      'source',
    ]) &&
    name(v.name) &&
    timestamp(v.updatedAt) &&
    working(v, true) &&
    (v.id === undefined ||
      (typeof v.id === 'string' && v.id.length > 0 && v.id.length <= 80)) &&
    (v.revision === undefined ||
      (Number.isSafeInteger(v.revision) && (v.revision as number) >= 1)) &&
    (v.revisions === undefined ||
      (Array.isArray(v.revisions) &&
        v.revisions.length <= MAX_OPTIONS_REVISIONS &&
        v.revisions.every(validRevision) &&
        v.revisions.every(
          (r, i, all) =>
            r.revision < (v.revision as number) &&
            (i === 0 || r.revision < all[i - 1].revision),
        )))
  );
}

/** Nonfinite form placeholders survive recovery only; portable named drafts must be valid. */
export function encodeOptionsStorage(data: OptionsLibraryData): string {
  if (!validLibrary(data))
    throw new Error(
      'Options storage contains invalid or oversized records. Current edits remain in memory.',
    );
  const raw = JSON.stringify(data, (_key, v) =>
    typeof v === 'number' && !Number.isFinite(v)
      ? { $optionsNumber: String(v) }
      : v,
  );
  if (raw.length > MAX_OPTIONS_STORAGE)
    throw new Error(
      'Options storage exceeds 1,000,000 characters. Export drafts or remove old revisions before saving.',
    );
  return raw;
}
function parse(raw: string): unknown {
  if (raw.length > MAX_OPTIONS_STORAGE)
    throw new Error(
      'Options file/storage exceeds 1,000,000 characters. Existing records are unchanged.',
    );
  try {
    return JSON.parse(raw, (_key, v) => {
      if (
        object(v) &&
        only(v, ['$optionsNumber']) &&
        typeof v.$optionsNumber === 'string'
      ) {
        if (v.$optionsNumber === 'NaN') return NaN;
        if (v.$optionsNumber === 'Infinity') return Infinity;
        if (v.$optionsNumber === '-Infinity') return -Infinity;
      }
      return v;
    });
  } catch {
    throw new Error(
      'Options file/storage is corrupt JSON. Existing records are unchanged; export/copy working inputs and repair browser storage.',
    );
  }
}
function validLibrary(v: unknown): v is OptionsLibraryData {
  return (
    object(v) &&
    only(v, ['version', 'drafts', 'recovery']) &&
    v.version === 2 &&
    Array.isArray(v.drafts) &&
    v.drafts.length <= MAX_OPTIONS_DRAFTS &&
    v.drafts.every(validSaved) &&
    (v.recovery === null || validRecovery(v.recovery))
  );
}
export function decodeOptionsStorage(raw: string): OptionsLibraryData {
  const v = parse(raw);
  if (!validLibrary(v))
    throw new Error(
      'Unsupported or invalid options storage. Existing records are unchanged; repair browser storage before saving.',
    );
  return v;
}
export function decodeLegacyOptions(raw: string): OptionsSavedDraft[] {
  if (raw.length > 300000)
    throw new Error(
      'Legacy options storage exceeds bounds. Existing records are unchanged.',
    );
  const v = parse(raw);
  if (
    !object(v) ||
    !only(v, ['version', 'drafts']) ||
    v.version !== 1 ||
    !Array.isArray(v.drafts) ||
    v.drafts.length > MAX_OPTIONS_DRAFTS ||
    !v.drafts.every(validSaved)
  )
    throw new Error(
      'Legacy options drafts could not be read. Existing data is unchanged; repair browser storage before saving.',
    );
  return v.drafts;
}
export function exportOptionsBundle(drafts: OptionsSavedDraft[]): string {
  if (drafts.length > MAX_OPTIONS_DRAFTS || !drafts.every(validSaved))
    throw new Error('Only valid named drafts can be exported.');
  const raw = JSON.stringify(
    { format: 'openquant-options-drafts', version: 2, drafts },
    null,
    2,
  );
  if (raw.length > MAX_OPTIONS_STORAGE)
    throw new Error(
      'Draft bundle exceeds 1,000,000 characters. Export fewer drafts.',
    );
  return raw;
}
export function importOptionsBundle(raw: string): OptionsSavedDraft[] {
  const v = parse(raw);
  if (
    !object(v) ||
    !only(v, ['format', 'version', 'drafts']) ||
    v.format !== 'openquant-options-drafts' ||
    v.version !== 2 ||
    !Array.isArray(v.drafts) ||
    !v.drafts.length ||
    v.drafts.length > MAX_OPTIONS_DRAFTS ||
    !v.drafts.every(validSaved)
  )
    throw new Error(
      'Invalid/unsupported draft bundle: use version 2 with 1–10 valid named drafts. Nothing was imported.',
    );
  return v.drafts;
}
export function optionsScope(id: string | null): string {
  return id ? `account:${encodeURIComponent(id)}` : 'guest';
}
export function downloadOptionsFile(
  content: string,
  filename: string,
  mime: string,
): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

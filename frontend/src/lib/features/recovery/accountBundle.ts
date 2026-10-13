import { validLayout } from '../workspace/researchShelf.svelte';
import { parseNotebookMetadata } from '../runs/notebookMetadata';
import { latestReviewKey, loadLatestReview } from '../trial/recovery';
import {
  extractDrawableFieldBag,
  narrowBundledDrawable,
} from '../drawables/bundledNarrow';
import { BUNDLED_TOOLS } from '../drawables/toolCatalog';
import { drawablesStorageKey } from '../drawables/persistence';

export type RecoveryIdentity = { account: string; generation: number };
type IdentityReader = () => RecoveryIdentity | null;
type RecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const kinds = ['shelf', 'notebook', 'robustness', 'elements'] as const;
type Kind = (typeof kinds)[number];
type Records = Record<Kind, string | null>;
type Bundle = {
  format: 'openquant-account-local-recovery';
  version: 1;
  account: string;
  records: Records;
};
export const MAX_BUNDLE_BYTES = 48 * 1024 * 1024;
const limits: Record<Kind, number> = {
  shelf: 24 * 1024 * 1024,
  notebook: 6 * 1024 * 1024,
  robustness: 3_000_000,
  elements: 4 * 1024 * 1024,
};

function fail(): never {
  throw new Error(
    'Account-local recovery unavailable; existing records were not replaced.',
  );
}

function bytes(raw: string): number {
  return new TextEncoder().encode(raw).length;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function only(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}

function keys(account: string): Record<Kind, string> {
  const encoded = encodeURIComponent(account);
  return {
    shelf: `openquant.research.v1:account:${encoded}`,
    notebook: `openquant.runs.history:account:${encoded}`,
    robustness: latestReviewKey(account),
    elements: drawablesStorageKey(account),
  };
}

function identity(read: IdentityReader): RecoveryIdentity {
  const value = read();
  if (
    !value ||
    !value.account ||
    value.account.length > 256 ||
    !Number.isSafeInteger(value.generation) ||
    value.generation < 0
  )
    fail();
  return { ...value };
}

function fence(read: IdentityReader, expected: RecoveryIdentity): void {
  const now = identity(read);
  if (
    now.account !== expected.account ||
    now.generation !== expected.generation
  )
    fail();
}

function bounded(raw: string, limit: number): boolean {
  return raw.length <= limit && bytes(raw) <= limit;
}

function validDraft(value: unknown): boolean {
  return (
    object(value) &&
    only(value, ['name', 'code', 'updatedAt']) &&
    typeof value.name === 'string' &&
    value.name.length <= 120 &&
    typeof value.code === 'string' &&
    value.code.length <= 1_000_000 &&
    typeof value.updatedAt === 'string' &&
    Number.isFinite(Date.parse(value.updatedAt))
  );
}

function readable(kind: Kind, raw: string, account: string): boolean {
  try {
    if (!bounded(raw, limits[kind])) return false;
    const value: unknown = JSON.parse(raw);
    if (kind === 'robustness')
      return (
        loadLatestReview({ getItem: () => raw, setItem: () => {} }, account)
          .status === 'ready'
      );
    if (kind === 'notebook') {
      parseNotebookMetadata(
        JSON.stringify({
          format: 'openquant-notebook-metadata',
          version: 1,
          entries: value,
        }),
      );
      return true;
    }
    if (kind === 'elements') {
      return (
        Array.isArray(value) &&
        value.length <= 2000 &&
        new Set(value.map(entry => (object(entry) ? entry.id : null))).size ===
          value.length &&
        value.every(entry => {
          if (!object(entry)) return false;
          const tool = BUNDLED_TOOLS.find(tool => tool.type === entry.type);
          if (!tool) return false;
          const candidate =
            entry.schemaVersion === tool.schemaVersion
              ? entry
              : entry.schemaVersion === 1
                ? tool.migrate?.(entry)
                : null;
          const fields = extractDrawableFieldBag(candidate);
          return fields !== null && narrowBundledDrawable(fields) !== null;
        })
      );
    }
    return (
      object(value) &&
      only(value, ['version', 'drafts', 'workspaces']) &&
      value.version === 1 &&
      object(value.drafts) &&
      only(value.drafts, ['strategy', 'indicator']) &&
      Object.values(value.drafts).every(validDraft) &&
      Array.isArray(value.workspaces) &&
      value.workspaces.length <= 10 &&
      value.workspaces.every(
        workspace =>
          object(workspace) &&
          only(workspace, ['id', 'name', 'updatedAt', 'layout']) &&
          typeof workspace.id === 'string' &&
          workspace.id.length > 0 &&
          workspace.id.length <= 256 &&
          typeof workspace.name === 'string' &&
          workspace.name.length > 0 &&
          workspace.name.length <= 120 &&
          typeof workspace.updatedAt === 'string' &&
          Number.isFinite(Date.parse(workspace.updatedAt)) &&
          validLayout(workspace.layout),
      )
    );
  } catch {
    return false;
  }
}

function preview(records: Records, account: string) {
  return kinds.map(kind => {
    const raw = records[kind];
    return {
      kind,
      bytes: raw === null ? 0 : bytes(raw),
      status:
        raw === null
          ? ('missing' as const)
          : readable(kind, raw, account)
            ? ('ready' as const)
            : ('unreadable' as const),
    };
  });
}

function readRecords(storage: RecoveryStorage, account: string): Records {
  const names = keys(account);
  return Object.fromEntries(
    kinds.map(kind => [kind, storage.getItem(names[kind])]),
  ) as Records;
}

/** Only the four account research keys; unreadable originals are retained privately. */
export function exportAccountBundle(
  storage: RecoveryStorage,
  read: IdentityReader,
) {
  try {
    const owner = identity(read);
    const records = readRecords(storage, owner.account);
    for (const kind of kinds)
      if (records[kind] !== null && !bounded(records[kind]!, limits[kind]))
        fail();
    const bundle: Bundle = {
      format: 'openquant-account-local-recovery',
      version: 1,
      account: owner.account,
      records,
    };
    const text = JSON.stringify(bundle);
    if (!bounded(text, MAX_BUNDLE_BYTES)) fail();
    fence(read, owner);
    return { text, preview: preview(records, owner.account) };
  } catch {
    fail();
  }
}

/** Caller must pause writers throughout preview/commit; target must be fresh. */
export function prepareAccountRestore(
  text: string,
  storage: RecoveryStorage,
  read: IdentityReader,
) {
  try {
    const owner = identity(read);
    if (!bounded(text, MAX_BUNDLE_BYTES)) fail();
    const value: unknown = JSON.parse(text);
    if (
      !object(value) ||
      !only(value, ['format', 'version', 'account', 'records']) ||
      value.format !== 'openquant-account-local-recovery' ||
      value.version !== 1 ||
      value.account !== owner.account ||
      !object(value.records) ||
      !only(value.records, kinds)
    )
      fail();
    const records = value.records as Records;
    for (const kind of kinds) {
      const raw = records[kind];
      if (
        raw !== null &&
        (typeof raw !== 'string' || !bounded(raw, limits[kind]))
      )
        fail();
    }
    const summary = preview(records, owner.account);
    const names = keys(owner.account);
    const fresh = () => {
      fence(read, owner);
      if (
        Object.values(readRecords(storage, owner.account)).some(
          raw => raw !== null,
        )
      )
        fail();
    };
    fresh();
    let used = false;
    return {
      preview: summary,
      commit(confirmation: {
        confirmed: boolean;
        writersPaused: boolean;
      }): void {
        if (
          used ||
          !confirmation.confirmed ||
          !confirmation.writersPaused ||
          summary.some(item => item.status === 'unreadable')
        )
          fail();
        used = true;
        const written: Kind[] = [];
        try {
          fresh();
          for (const kind of kinds) {
            fence(read, owner);
            if (storage.getItem(names[kind]) !== null) fail();
            const raw = records[kind];
            if (raw !== null) {
              storage.setItem(names[kind], raw);
              written.push(kind);
            }
          }
          fence(read, owner);
        } catch {
          // Best-effort rollback of only our exact bytes, never another writer's.
          for (const kind of written) {
            try {
              if (storage.getItem(names[kind]) === records[kind])
                storage.removeItem(names[kind]);
            } catch {
              /* A failed rollback remains a failed restore. */
            }
          }
          throw new Error(
            'Account-local restore failed; partial records may remain. Preserve originals and use a fresh target.',
          );
        }
      },
    };
  } catch {
    fail();
  }
}

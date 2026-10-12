import type { RunHistoryEntry } from './runsHistory.svelte';

export const RESEARCH_DECISIONS = {
  unreviewed: 'Unreviewed',
  continue: 'Continue research',
  revise: 'Revise',
  reject: 'Reject',
} as const;
export type ResearchDecision = keyof typeof RESEARCH_DECISIONS;
export const MAX_NOTEBOOK_REFERENCES = 50;
export const MAX_NOTEBOOK_BYTES = 6 * 1024 * 1024;
export const MAX_TAG_LENGTH = 600;

const FORMAT = 'openquant-notebook-metadata';
const VERSION = 1;
const ENTRY_KEYS = [
  'run_id',
  'kind',
  'label',
  'created_at',
  'tags',
  'notes',
  'baseline',
  'decision',
];

export function isResearchDecision(value: unknown): value is ResearchDecision {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(RESEARCH_DECISIONS, value)
  );
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown, max: number, nonempty = false): value is string {
  return (
    typeof value === 'string' &&
    value.length <= max &&
    (!nonempty || value.trim().length > 0)
  );
}

export function parseNotebookMetadata(json: string): RunHistoryEntry[] {
  if (
    json.length > MAX_NOTEBOOK_BYTES ||
    new TextEncoder().encode(json).length > MAX_NOTEBOOK_BYTES
  )
    throw new Error('Notebook metadata must be no larger than 6 MiB.');
  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch {
    throw new Error('Choose a valid notebook metadata JSON file.');
  }
  if (
    !object(payload) ||
    payload.format !== FORMAT ||
    payload.version !== VERSION ||
    Object.keys(payload).some(
      key => !['format', 'version', 'entries'].includes(key),
    ) ||
    !Array.isArray(payload.entries) ||
    payload.entries.length > MAX_NOTEBOOK_REFERENCES
  )
    throw new Error(
      'Expected version 1 OpenQuant notebook metadata with at most 50 references.',
    );

  const ids = new Set<string>();
  let baseline = false;
  return payload.entries.map((entry: unknown) => {
    if (
      !object(entry) ||
      Object.keys(entry).some(key => !ENTRY_KEYS.includes(key)) ||
      !text(entry.run_id, 256, true) ||
      !/^[A-Za-z0-9_-]+$/.test(entry.run_id) ||
      (entry.kind !== 'single' && entry.kind !== 'portfolio') ||
      !text(entry.label, 120, true) ||
      !text(entry.created_at, 40, true) ||
      !/^\d{4}-\d{2}-\d{2}T/.test(entry.created_at) ||
      !Number.isFinite(Date.parse(entry.created_at)) ||
      !Array.isArray(entry.tags) ||
      entry.tags.length > 12 ||
      !entry.tags.every(tag => text(tag, MAX_TAG_LENGTH, true)) ||
      !text(entry.notes, 10000) ||
      typeof entry.baseline !== 'boolean' ||
      !isResearchDecision(entry.decision)
    )
      throw new Error(
        'Invalid notebook reference or metadata bounds (name 120, 12 tags of 600, notes 10000 characters).',
      );
    if (ids.has(entry.run_id))
      throw new Error(
        'Duplicate run IDs within the import file are not allowed.',
      );
    ids.add(entry.run_id);
    if (entry.baseline && (baseline || entry.kind !== 'single'))
      throw new Error(
        'An import file may contain at most one single-symbol baseline.',
      );
    baseline ||= entry.baseline;
    return {
      run_id: entry.run_id,
      kind: entry.kind,
      label: entry.label,
      created_at: entry.created_at,
      tags: [...entry.tags] as string[],
      notes: entry.notes,
      baseline: entry.baseline,
      decision: entry.decision,
    };
  });
}

export function serializeNotebookMetadata(entries: RunHistoryEntry[]): string {
  const json = JSON.stringify(
    {
      format: FORMAT,
      version: VERSION,
      entries: entries.map(entry => ({
        run_id: entry.run_id,
        kind: entry.kind,
        label: entry.label,
        created_at: entry.created_at,
        tags: entry.tags ?? [],
        notes: entry.notes ?? '',
        baseline: entry.baseline ?? false,
        decision: entry.decision ?? 'unreviewed',
      })),
    },
    null,
    2,
  );
  parseNotebookMetadata(json);
  return json;
}

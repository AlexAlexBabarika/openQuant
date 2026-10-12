import { describe, expect, it } from 'vitest';
import {
  MAX_NOTEBOOK_BYTES,
  parseNotebookMetadata,
  serializeNotebookMetadata,
} from './notebookMetadata';
import type { RunHistoryEntry } from './runsHistory.svelte';

const entry: RunHistoryEntry = {
  run_id: 'run-a',
  kind: 'single',
  label: 'A hypothesis',
  created_at: '2026-01-01T00:00:00Z',
  tags: ['costs'],
  notes: 'Try higher fees',
  decision: 'revise',
  baseline: true,
};
const payload = (entries: unknown[]) =>
  JSON.stringify({
    format: 'openquant-notebook-metadata',
    version: 1,
    entries,
  });

describe('notebook metadata schema', () => {
  it('round-trips only bounded metadata, with explicit defaults for old records', () => {
    const exported = serializeNotebookMetadata([
      { ...entry, secret: 'not exported' } as RunHistoryEntry,
    ]);
    expect(exported).not.toContain('secret');
    expect(parseNotebookMetadata(exported)).toEqual([entry]);
    expect(
      parseNotebookMetadata(
        serializeNotebookMetadata([
          {
            run_id: 'legacy',
            label: 'Legacy',
            created_at: entry.created_at,
            kind: 'portfolio',
          },
        ]),
      )[0],
    ).toMatchObject({
      decision: 'unreviewed',
      tags: [],
      notes: '',
      baseline: false,
    });
  });

  it.each([
    'not JSON',
    'null',
    '[]',
    '{}',
    JSON.stringify({
      format: 'openquant-notebook-metadata',
      version: 2,
      entries: [],
    }),
    JSON.stringify({
      format: 'openquant-notebook-metadata',
      version: 1,
      entries: [],
      owner: 'account',
    }),
  ])(
    'rejects malformed, foreign, ownership-bearing or unsupported payloads: %s',
    json => {
      expect(() => parseNotebookMetadata(json)).toThrow();
    },
  );

  it.each([
    { run_id: '' },
    { run_id: '../bad' },
    { run_id: 'a'.repeat(257) },
    { kind: 'sweep' },
    { label: 'x'.repeat(121) },
    { label: ' ' },
    { created_at: 'yesterday' },
    { created_at: '2026-13-01T00:00:00Z' },
    { tags: ['x'.repeat(601)] },
    { tags: Array(13).fill('tag') },
    { tags: [''] },
    { notes: 'x'.repeat(10001) },
    { notes: null },
    { decision: 'certified' },
    { baseline: 1 },
    { source_code: 'not metadata' },
  ])('rejects the entire file when its final entry is invalid: %j', invalid => {
    expect(() =>
      parseNotebookMetadata(
        payload([
          { ...entry, baseline: false },
          { ...entry, run_id: 'last', ...invalid },
        ]),
      ),
    ).toThrow();
  });

  it('accepts exact field bounds and rejects reference-count and byte limits', () => {
    const bounded = {
      ...entry,
      label: 'x'.repeat(120),
      tags: Array(12).fill('t'.repeat(600)),
      notes: 'n'.repeat(10000),
    };
    expect(
      parseNotebookMetadata(
        payload(
          Array.from({ length: 50 }, (_, i) => ({
            ...bounded,
            baseline: false,
            run_id: `r${i}`,
          })),
        ),
      ),
    ).toHaveLength(50);
    expect(() =>
      parseNotebookMetadata(
        payload(
          Array.from({ length: 51 }, (_, i) => ({
            ...entry,
            baseline: false,
            run_id: `r${i}`,
          })),
        ),
      ),
    ).toThrow('50');
    expect(() =>
      parseNotebookMetadata(' '.repeat(MAX_NOTEBOOK_BYTES + 1)),
    ).toThrow('6 MiB');
    expect(() =>
      parseNotebookMetadata('😀'.repeat(MAX_NOTEBOOK_BYTES / 4 + 1)),
    ).toThrow('6 MiB');
  });

  it('rejects ambiguous repeated IDs, multiple baselines and portfolio baselines', () => {
    expect(() => parseNotebookMetadata(payload([entry, entry]))).toThrow(
      'Duplicate',
    );
    expect(() =>
      parseNotebookMetadata(payload([entry, { ...entry, run_id: 'b' }])),
    ).toThrow('baseline');
    expect(() =>
      parseNotebookMetadata(payload([{ ...entry, kind: 'portfolio' }])),
    ).toThrow('baseline');
  });
});

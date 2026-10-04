import { describe, it, expect } from 'vitest';
import {
  RunsHistory,
  MAX_RUNS,
  type RunHistoryEntry,
} from './runsHistory.svelte';

function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: k => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: k => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}

const entry = (id: string): RunHistoryEntry => ({
  run_id: id,
  kind: 'single',
  label: `L${id}`,
  created_at: '2026-01-01T00:00:00Z',
});

describe('RunsHistory', () => {
  it('keeps notebook edits and the baseline when an existing run is recorded again', () => {
    const storage = memStorage();
    const h = new RunsHistory(storage);
    h.record(entry('a'));
    h.annotate(
      'a',
      'Baseline hypothesis',
      'trend, trend, costs',
      'Try higher fees',
    );
    h.pin('a');
    h.record(entry('a'));
    const reloaded = new RunsHistory(storage);
    expect(reloaded.baseline).toMatchObject({
      label: 'Baseline hypothesis',
      tags: ['trend', 'costs'],
      notes: 'Try higher fees',
    });
  });

  it('retains the pinned baseline at the history limit and clears it on removal', () => {
    const h = new RunsHistory(memStorage());
    h.record(entry('baseline'));
    h.pin('baseline');
    for (let i = 0; i < MAX_RUNS + 5; i++) h.record(entry(String(i)));
    expect(h.baseline?.run_id).toBe('baseline');
    expect(h.entries).toHaveLength(MAX_RUNS);
    h.remove('baseline');
    expect(h.baseline).toBeNull();
  });

  it('separates anonymous and account notebooks', () => {
    const h = new RunsHistory(memStorage());
    h.record(entry('guest'));
    h.setAccount('a');
    expect(h.entries).toEqual([]);
    h.record(entry('private'));
    h.pin('private');
    h.setAccount('b');
    expect(h.baseline).toBeNull();
    h.setAccount('a');
    expect(h.baseline?.run_id).toBe('private');
    h.setAccount(null);
    expect(h.entries[0].run_id).toBe('guest');
  });

  it('ignores malformed stored history', () => {
    const storage = memStorage();
    storage.setItem(
      'openquant.runs.history',
      JSON.stringify({ invalid: true }),
    );
    expect(new RunsHistory(storage).entries).toEqual([]);
  });
  it('offers explicit copying of guest references without moving them or overwriting account notes', () => {
    const storage = memStorage();
    const history = new RunsHistory(storage);
    history.record(entry('legacy'));
    history.record(entry('shared'));
    history.pin('legacy');
    history.setAccount('a');
    history.record(entry('shared'));
    history.annotate('shared', 'Account A', 'account', 'A notes');
    history.pin('shared');
    history.setAccount('b');
    history.setAccount('a');
    expect(history.guestReferenceCount).toBe(1);
    expect(history.entries).toHaveLength(1);
    history.copyGuestReferences();
    expect(history.entries).toHaveLength(2);
    expect(history.entries[0].notes).toBe('A notes');
    expect(history.baseline?.run_id).toBe('shared');
    expect(history.guestReferenceCount).toBe(0);
    history.setAccount(null);
    expect(history.entries).toHaveLength(2);
    expect(history.baseline?.run_id).toBe('legacy');
    history.setAccount('b');
    expect(history.entries).toHaveLength(0);
  });
  it('does not overwrite unreadable notebook storage when recording a new result', () => {
    const storage = memStorage();
    storage.setItem('openquant.runs.history', '{broken');
    const history = new RunsHistory(storage);
    history.record(entry('new'));
    expect(storage.getItem('openquant.runs.history')).toBe('{broken');
    expect(history.storageError).toContain('memory');
    history.setAccount('other');
    history.record(entry('other'));
    expect(history.storageError).toBeNull();
  });
  it('sanitizes damaged notebook metadata and only accepts one single-symbol baseline', () => {
    const storage = memStorage();
    storage.setItem(
      'openquant.runs.history',
      JSON.stringify([
        { ...entry('a'), tags: {}, notes: {}, baseline: true },
        { ...entry('b'), baseline: true },
        { ...entry('p'), kind: 'portfolio', baseline: true },
      ]),
    );
    const history = new RunsHistory(storage);
    expect(history.entries[0].tags).toEqual([]);
    expect(history.entries[0].notes).toBe('');
    expect(history.entries.filter(e => e.baseline)).toHaveLength(1);
  });
  it('records newest-first and de-dupes by run_id', () => {
    const h = new RunsHistory(memStorage());
    h.record(entry('a'));
    h.record(entry('b'));
    h.record(entry('a'));
    expect(h.entries.map(e => e.run_id)).toEqual(['a', 'b']);
  });

  it('caps at MAX_RUNS', () => {
    const h = new RunsHistory(memStorage());
    for (let i = 0; i < MAX_RUNS + 10; i++) h.record(entry(`r${i}`));
    expect(h.entries.length).toBe(MAX_RUNS);
    expect(h.entries[0].run_id).toBe(`r${MAX_RUNS + 9}`);
  });

  it('persists and reloads from storage', () => {
    const s = memStorage();
    new RunsHistory(s).record(entry('a'));
    expect(new RunsHistory(s).entries.map(e => e.run_id)).toEqual(['a']);
  });

  it('remove drops by id', () => {
    const h = new RunsHistory(memStorage());
    h.record(entry('a'));
    h.remove('a');
    expect(h.entries).toEqual([]);
  });

  it('falls back to in-memory when storage throws', () => {
    const bad = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    const h = new RunsHistory(bad);
    expect(() => h.record(entry('a'))).not.toThrow();
    expect(h.entries.map(e => e.run_id)).toEqual(['a']);
  });
});

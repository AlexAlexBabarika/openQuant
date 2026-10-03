import { describe, it, expect, vi } from 'vitest';
import { CompareState } from './compareState.svelte';
import type { RunDiff } from './runTypes';

const DIFF = {
  inputs_diff: [],
  metrics_diff: [],
  equity_overlay: { a: [], b: [], residual: [] },
  trades_diff: { changed: [], unchanged: [], only_in_a: [], only_in_b: [] },
  status: {
    a: { stale: false, recorded: '1', current: '1' },
    b: { stale: false, recorded: '1', current: '1' },
  },
} as RunDiff;

describe('CompareState', () => {
  it('load() fetches and stores the diff', async () => {
    const compareRuns = vi.fn().mockResolvedValue(DIFF);
    const s = new CompareState({ compareRuns } as never);
    await s.load('a', 'b');
    expect(compareRuns).toHaveBeenCalledWith('a', 'b');
    expect(s.diff).toEqual(DIFF);
    expect(s.a).toBe('a');
    expect(s.error).toBeNull();
  });

  it('setDiff stores without fetching', () => {
    const compareRuns = vi.fn();
    const s = new CompareState({ compareRuns } as never);
    s.setDiff('a', 'b', DIFF);
    expect(compareRuns).not.toHaveBeenCalled();
    expect(s.diff).toEqual(DIFF);
  });

  it('load() captures errors', async () => {
    const s = new CompareState({
      compareRuns: vi.fn().mockRejectedValue(new Error('nope')),
    } as never);
    await s.load('a', 'b');
    expect(s.error).toBe('nope');
    expect(s.diff).toBeNull();
  });

  it('ignores an older diff that resolves after selecting another pair', async () => {
    let resolveOld!: (diff: RunDiff) => void;
    const old = new Promise<RunDiff>(resolve => {
      resolveOld = resolve;
    });
    const latest = {
      ...DIFF,
      inputs_diff: [{ path: 'symbol', a: 'MSFT', b: 'AAPL' }],
    };
    const s = new CompareState({
      compareRuns: vi
        .fn()
        .mockReturnValueOnce(old)
        .mockResolvedValueOnce(latest),
    } as never);
    const pending = s.load('old-a', 'old-b');
    await s.load('new-a', 'new-b');
    resolveOld(DIFF);
    await pending;
    expect(s.a).toBe('new-a');
    expect(s.diff).toEqual(latest);
  });

  it('keeps a newer selection loading when an older request fails', async () => {
    let rejectOld!: (error: Error) => void;
    let resolveNew!: (diff: RunDiff) => void;
    const old = new Promise<RunDiff>((_, reject) => {
      rejectOld = reject;
    });
    const latest = new Promise<RunDiff>(resolve => {
      resolveNew = resolve;
    });
    const s = new CompareState({
      compareRuns: vi.fn().mockReturnValueOnce(old).mockReturnValueOnce(latest),
    } as never);
    const pendingOld = s.load('old-a', 'old-b');
    const pendingNew = s.load('new-a', 'new-b');
    rejectOld(new Error('old request failed'));
    await pendingOld;
    expect(s.loading).toBe(true);
    expect(s.error).toBeNull();
    resolveNew(DIFF);
    await pendingNew;
  });

  it('does not replace a rerun diff with an earlier comparison response', async () => {
    let resolve!: (diff: RunDiff) => void;
    const s = new CompareState({
      compareRuns: () =>
        new Promise<RunDiff>(r => {
          resolve = r;
        }),
    } as never);
    const pending = s.load('old-a', 'old-b');
    const latest = {
      ...DIFF,
      inputs_diff: [{ path: 'symbol', a: 'MSFT', b: 'AAPL' }],
    };
    s.setDiff('rerun-a', 'rerun-b', latest);
    resolve(DIFF);
    await pending;
    expect(s.diff).toEqual(latest);
    expect(s.a).toBe('rerun-a');
  });
});

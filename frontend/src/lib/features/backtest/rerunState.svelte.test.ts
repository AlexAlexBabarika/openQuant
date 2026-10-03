import { describe, expect, it, vi } from 'vitest';
import { RerunState } from './rerunState.svelte';
import type { RerunResponse } from '$lib/features/runs/runTypes';

const response = { run_id: 'new', diff: {} } as RerunResponse;

describe('rerun controls', () => {
  it('ignores a rerun response after switching or closing the dashboard', async () => {
    let resolve!: (value: RerunResponse) => void;
    const client = {
      rerunRun: vi.fn(
        () =>
          new Promise<RerunResponse>(r => {
            resolve = r;
          }),
      ),
    };
    const state = new RerunState(client);
    const pending = state.run('old');
    state.reset();
    resolve(response);
    expect(await pending).toBeNull();
    expect(state.running).toBe(false);
    expect(state.error).toBeNull();
  });

  it('does not show an old failure or stop the newer rerun spinner', async () => {
    let rejectOld!: (error: Error) => void;
    let resolveNew!: (value: RerunResponse) => void;
    const old = new Promise<RerunResponse>((_, reject) => {
      rejectOld = reject;
    });
    const latest = new Promise<RerunResponse>(resolve => {
      resolveNew = resolve;
    });
    const state = new RerunState({
      rerunRun: vi.fn().mockReturnValueOnce(old).mockReturnValueOnce(latest),
    });
    const pendingOld = state.run('old');
    state.reset();
    const pendingNew = state.run('latest');
    rejectOld(new Error('old failure'));
    expect(await pendingOld).toBeNull();
    expect(state.running).toBe(true);
    expect(state.error).toBeNull();
    resolveNew(response);
    expect(await pendingNew).toEqual(response);
  });

  it('surfaces server errors and allows retry', async () => {
    const state = new RerunState({
      rerunRun: vi
        .fn()
        .mockRejectedValueOnce(new Error('Sign in required'))
        .mockResolvedValueOnce(response),
    });
    expect(await state.run('a')).toBeNull();
    expect(state.error).toBe('Sign in required');
    expect(state.running).toBe(false);
    expect(await state.run('a')).toEqual(response);
    expect(state.error).toBeNull();
  });
});

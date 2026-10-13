import { describe, it, expect, vi } from 'vitest';
import { storedRunLoader } from './storedRunLoader';
import { clearAccessToken } from '$lib/core/api';
import { deferred } from '$lib/features/chart/reactiveTestSupport';

describe('storedRunLoader', () => {
  it('never starts an old owner loader under a later session', async () => {
    const getRun = vi.fn();
    const loader = storedRunLoader('x', { getRun } as never);
    clearAccessToken();
    await expect(loader()).rejects.toThrow('Account changed');
    expect(getRun).not.toHaveBeenCalled();
  });

  it('rejects a delayed injected client result after a session change', async () => {
    const pending = deferred<unknown>();
    const loader = storedRunLoader('x', {
      getRun: () => pending.promise,
    } as never);
    const loading = loader();
    clearAccessToken();
    pending.resolve({ meta: { run_id: 'x' } });
    await expect(loading).rejects.toThrow('Account changed');
  });

  it('returns a loader that fetches the run by id', async () => {
    const getRun = vi.fn().mockResolvedValue({ meta: { run_id: 'x' } });
    const loader = storedRunLoader('x', { getRun } as never);
    expect(await loader()).toEqual({ meta: { run_id: 'x' } });
    expect(getRun).toHaveBeenCalledWith('x');
  });
});

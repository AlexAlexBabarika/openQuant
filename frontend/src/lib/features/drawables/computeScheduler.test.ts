import { describe, expect, it, vi } from 'vitest';
import { createDrawableComputeScheduler } from './computeScheduler';
import { deferred } from '$lib/features/chart/reactiveTestSupport';

function setup() {
  const events = {
    pending: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    removed: vi.fn(),
  };
  return { events, scheduler: createDrawableComputeScheduler(events) };
}

describe('drawable latest-work scheduler', () => {
  it('restarts after an aborted geometry round trip even when the original key returns', async () => {
    const { scheduler, events } = setup();
    const first = deferred<unknown>();
    let signal!: AbortSignal;
    const run = vi.fn((s: AbortSignal) => {
      signal = s;
      return first.promise;
    });
    scheduler.submit('a', { key: 'original', cancelKey: 'original', run });
    scheduler.submit('a', { key: 'changed', cancelKey: 'changed', run });
    const latest = vi.fn(() => 'latest');
    scheduler.submit('a', {
      key: 'original',
      cancelKey: 'original',
      run: latest,
    });
    expect(signal.aborted).toBe(true);
    expect(latest).not.toHaveBeenCalled();
    first.resolve('obsolete');
    await Promise.resolve();
    expect(events.success).toHaveBeenCalledExactlyOnceWith(
      'a',
      'original',
      'latest',
    );
    expect(latest).toHaveBeenCalledOnce();
    scheduler.submit('a', {
      key: 'original',
      cancelKey: 'original',
      run: latest,
    });
    expect(latest).toHaveBeenCalledOnce();
  });

  it('does not mistake null/undefined promise rejection or synchronous throw for success', async () => {
    const { scheduler, events } = setup();
    scheduler.submit('a', {
      key: '1',
      cancelKey: 'a',
      run: () => Promise.reject(undefined),
    });
    await Promise.resolve();
    expect(events.error).toHaveBeenLastCalledWith('a', '1', undefined);
    scheduler.submit('a', {
      key: '2',
      cancelKey: 'a',
      run: () => Promise.reject(null),
    });
    await Promise.resolve();
    expect(events.error).toHaveBeenLastCalledWith('a', '2', null);
    scheduler.submit('a', {
      key: '3',
      cancelKey: 'a',
      run: () => {
        throw new Error('sync');
      },
    });
    expect(events.error).toHaveBeenLastCalledWith(
      'a',
      '3',
      expect.objectContaining({ message: 'sync' }),
    );
    expect(events.success).not.toHaveBeenCalled();
  });

  it('drops queued work on deletion/destroy even if an aborted request later rejects', async () => {
    const { scheduler, events } = setup();
    const first = deferred<unknown>();
    const queued = vi.fn(() => 'never');
    scheduler.submit('a', {
      key: '1',
      cancelKey: 'a',
      run: () => first.promise,
    });
    scheduler.submit('a', { key: '2', cancelKey: 'a', run: queued });
    scheduler.retain(new Set());
    scheduler.destroy();
    first.reject(new Error('late error'));
    await Promise.resolve();
    scheduler.submit('a', { key: '3', cancelKey: 'a', run: queued });
    expect(queued).not.toHaveBeenCalled();
    expect(events.error).not.toHaveBeenCalled();
    expect(events.success).not.toHaveBeenCalled();
  });
});

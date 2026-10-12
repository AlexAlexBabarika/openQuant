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
  it('bounds a 100-Element context/publication burst to one active and one terminal request per id', async () => {
    const { scheduler, events } = setup();
    const requests: {
      id: string;
      key: string;
      signal: AbortSignal;
      result: ReturnType<typeof deferred<unknown>>;
    }[] = [];
    const ids = Array.from({ length: 100 }, (_, i) => `element-${i}`);
    for (let revision = 0; revision <= 100; revision++) {
      for (const id of ids) {
        const key = `revision:${revision}`;
        scheduler.submit(id, {
          key,
          cancelKey: revision < 50 ? 'old-context' : 'new-context',
          run: signal => {
            const result = deferred<unknown>();
            requests.push({ id, key, signal, result });
            return result.promise;
          },
        });
      }
      expect(requests).toHaveLength(100);
    }
    expect(requests.every(r => r.signal.aborted)).toBe(true);
    for (const r of requests) r.result.resolve('obsolete');
    await Promise.resolve();
    expect(events.success).not.toHaveBeenCalled();
    expect(events.error).not.toHaveBeenCalled();
    expect(requests).toHaveLength(200);
    expect(requests.slice(100).map(r => r.id)).toEqual(ids);
    expect(requests.slice(100).every(r => r.key === 'revision:100')).toBe(true);
    expect(requests.slice(100).every(r => !r.signal.aborted)).toBe(true);
    for (const r of requests.slice(100)) r.result.resolve(r.id);
    await Promise.resolve();
    expect(events.success).toHaveBeenCalledTimes(100);
    for (const id of ids) {
      expect(events.success).toHaveBeenCalledWith(id, 'revision:100', id);
      scheduler.submit(id, {
        key: 'revision:100',
        cancelKey: 'new-context',
        run: () => {
          throw new Error('duplicate request');
        },
      });
    }
    expect(events.error).not.toHaveBeenCalled();
    scheduler.retain(new Set());
    expect(events.removed.mock.calls.map(([id]) => id)).toEqual(ids);
    scheduler.destroy();
  });

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

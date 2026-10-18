import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearAccessToken, setAccessToken } from '$lib/core/api';
import { RequestFlight } from './optionsRequest';

afterEach(() => {
  clearAccessToken();
  vi.useRealTimers();
});

describe('document/query/session request fencing', () => {
  it('cancels prior flights and rejects success/error/finally after query or document replacement', () => {
    const gate = new RequestFlight();
    let key = 'guest:doc1:query1';
    const first = gate.start(() => key, vi.fn());
    expect(first.current()).toBe(true);
    const second = gate.start(() => key, vi.fn());
    expect(first.signal.aborted).toBe(true);
    expect(first.current()).toBe(false);
    key = 'guest:doc1:query2';
    expect(second.current()).toBe(false);
    key = 'account:doc2:query1';
    expect(second.current()).toBe(false);
    gate.cancel();
    expect(second.signal.aborted).toBe(true);
    second.finish();
    first.finish();
  });
  it('rejects a result after account token generation changes even before reactive scope cleanup', () => {
    const gate = new RequestFlight();
    const run = gate.start(() => 'unchanged-key', vi.fn());
    setAccessToken('test-only');
    expect(run.current()).toBe(false);
    clearAccessToken();
    expect(run.current()).toBe(false);
    gate.cancel();
  });
  it('times out and aborts only a current request, and cleans up its timer', () => {
    vi.useFakeTimers();
    const gate = new RequestFlight(),
      timeout = vi.fn();
    const run = gate.start(() => 'doc', timeout);
    vi.advanceTimersByTime(15000);
    expect(timeout).toHaveBeenCalledOnce();
    expect(run.signal.aborted).toBe(true);
    expect(run.current()).toBe(false);
    const complete = gate.start(() => 'doc', timeout);
    complete.finish();
    vi.advanceTimersByTime(20000);
    expect(timeout).toHaveBeenCalledOnce();
    gate.cancel();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('old finally cannot clear the replacement deadline; cancellation fences rejected promises', async () => {
    vi.useFakeTimers();
    const gate = new RequestFlight(),
      timeout = vi.fn();
    const old = gate.start(() => 'doc', timeout),
      current = gate.start(() => 'doc', timeout);
    old.finish();
    vi.advanceTimersByTime(15000);
    expect(timeout).toHaveBeenCalledOnce();
    expect(current.current()).toBe(false);
    const rejected = gate.start(() => 'doc', timeout);
    gate.cancel();
    const publish = vi.fn();
    await Promise.reject(new Error('obsolete'))
      .catch(() => {
        if (rejected.current()) publish();
      })
      .finally(() => {
        if (rejected.current()) publish();
        rejected.finish();
      });
    expect(publish).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

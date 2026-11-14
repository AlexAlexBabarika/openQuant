import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearAccessToken, setAccessToken } from '$lib/core/api';
import {
  RequestFlight,
  ResearchJob,
  type ResearchState,
} from './optionsRequest';

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

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('research job evidence', () => {
  function job(
    call: (request: { n: number[] }, signal: AbortSignal) => Promise<number>,
    input = { key: 'one' },
  ) {
    const seen: { state: ResearchState<number, { n: number[] }> | null } = {
      state: null,
    };
    const made = new ResearchJob<{ n: number[] }, number>(
      'doc',
      () => 'doc',
      next => (seen.state = next),
      () => input.key,
      {
        cancelled: 'cancelled',
        inputsChanged: 'inputs changed',
        failed: () => 'failed; retry explicitly',
        submitted: () => '',
      },
    );
    const submit = (
      request: { n: number[] },
      validate?: (n: number) => boolean | string | null,
    ) => made.submit(request, input.key, call, validate);
    return { job: made, seen, input, submit };
  }

  it('freezes the submitted request and keeps previous evidence during a refresh', async () => {
    const refresh = deferred<number>();
    const call = vi
      .fn()
      .mockResolvedValueOnce(1)
      .mockReturnValueOnce(refresh.promise);
    const { job: made, input, submit } = job(call);
    const request = { n: [100] };
    await submit(request);
    input.key = 'two';
    const task = submit(request);
    request.n[0] = 50;
    expect(made.state.result).toBe(1);
    expect(made.state.pending).toBe(true);
    expect(call.mock.calls[1][0].n[0]).toBe(100);
    refresh.resolve(2);
    await task;
    expect(made.state.submitted?.n[0]).toBe(100);
    expect(Object.isFrozen(made.state.submitted?.n)).toBe(true);
    expect(made.state.submittedKey).toBe('two');
  });

  it.each(['cancel', 'inputs', 'reset', 'replace'])(
    'fences a late failure after %s',
    async action => {
      const first = deferred<number>(),
        second = deferred<number>();
      const signals: AbortSignal[] = [];
      const {
        job: made,
        input,
        submit,
      } = job((_, signal) => {
        signals.push(signal);
        return signals.length === 1 ? first.promise : second.promise;
      });
      const task = submit({ n: [] });
      let replacement: Promise<void> | undefined;
      if (action === 'cancel') made.cancel();
      if (action === 'inputs') {
        input.key = 'two';
        made.inputsChanged();
      }
      if (action === 'reset') made.reset('doc');
      if (action === 'replace') replacement = submit({ n: [] });
      const before = made.state;
      first.reject(new Error('secret raw server content'));
      await task;
      expect(signals[0].aborted).toBe(true);
      expect(made.state).toBe(before);
      expect(made.state.error).toBe('');
      if (action === 'inputs') expect(made.state.notice).toBe('inputs changed');
      if (replacement) {
        second.resolve(7);
        await replacement;
        expect(made.state.result).toBe(7);
      }
    },
  );

  it('leaves settled evidence alone when inputs change with nothing pending', async () => {
    const { job: made, input, submit } = job(async () => 1);
    await submit({ n: [] });
    const before = made.state;
    input.key = 'two';
    made.inputsChanged();
    expect(made.state).toBe(before);
  });

  it('reports a failure with the tool copy, not raw server content', async () => {
    const { job: made, submit } = job(async () => {
      throw new Error('raw secret');
    });
    await submit({ n: [] });
    expect(made.state.pending).toBe(false);
    expect(made.state.error).toBe('failed; retry explicitly');
  });

  it('keeps previous evidence when validation rejects a refresh with a message', async () => {
    let next = 1;
    const { job: made, input, submit } = job(async () => next);
    await submit({ n: [] });
    next = 2;
    input.key = 'two';
    await submit({ n: [] }, n => (n === 2 ? 'empty evidence' : null));
    expect(made.state.result).toBe(1);
    expect(made.state.submittedKey).toBe('one');
    expect(made.state.error).toBe('empty evidence');
    expect(made.state.pending).toBe(false);
  });

  it('shows tool-authored feedback until the next submission', async () => {
    const { job: made, submit } = job(async () => 1);
    made.note({ error: 'Correct inputs first.' });
    expect(made.state.error).toBe('Correct inputs first.');
    await submit({ n: [] });
    expect(made.state.error).toBe('');
  });
});

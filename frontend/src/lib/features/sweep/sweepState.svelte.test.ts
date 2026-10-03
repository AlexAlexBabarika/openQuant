import { describe, it, expect, vi } from 'vitest';
import { SweepState } from './sweepState.svelte';
import type {
  ParamSchema,
  SweepClient,
  SweepProgress,
  SweepFormValues,
} from './types';

const FORM: SweepFormValues = {
  code: 'x',
  symbol: 'TEST',
  provider: 'yfinance',
  search: 'grid',
  metric: 'sharpe',
  vary: ['qty'],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function progress(over: Partial<SweepProgress> = {}): SweepProgress {
  return {
    sweep_id: 's1',
    status: 'running',
    total: 4,
    done: 0,
    trials: [],
    best_trial_id: null,
    error: null,
    result: null,
    ...over,
  };
}

function fakeClient(polls: SweepProgress[]): SweepClient {
  let i = 0;
  return {
    schema: vi.fn(
      async (): Promise<ParamSchema> => ({
        qty: { kind: 'int', low: 1, high: 4, step: 1 },
      }),
    ),
    start: vi.fn(async () => ({ sweep_id: 's1' })),
    poll: vi.fn(async () => polls[Math.min(i++, polls.length - 1)]),
    cancel: vi.fn(async () => undefined),
    loadTrial: vi.fn(async () => ({}) as never),
  };
}

describe('SweepState', () => {
  it('ignores old schema results after the editor source changes', async () => {
    const old = deferred<ParamSchema>();
    const latest = deferred<ParamSchema>();
    const client = fakeClient([]);
    client.schema = vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(latest.promise);
    const state = new SweepState(client, 0);
    const pendingOld = state.loadSchema('old code');
    const pendingNew = state.loadSchema('new code');
    latest.resolve({ fast: { kind: 'int', low: 1, high: 5, step: 1 } });
    await pendingNew;
    old.resolve({ qty: { kind: 'int', low: 1, high: 4, step: 1 } });
    await pendingOld;
    expect(Object.keys(state.schema)).toEqual(['fast']);
  });

  it('surfaces schema failures without leaving the previous strategy parameters usable', async () => {
    const client = fakeClient([]);
    const state = new SweepState(client, 0);
    await state.loadSchema('good code');
    client.schema = vi.fn().mockRejectedValue(new Error('invalid source'));
    await expect(state.loadSchema('bad code')).resolves.toBeUndefined();
    expect(state.schema).toEqual({});
    expect(state.schemaError).toBe('invalid source');
    expect(state.schemaLoading).toBe(false);
  });

  it('ignores a rejected old schema request while new parameters are still loading', async () => {
    const old = deferred<ParamSchema>();
    const latest = deferred<ParamSchema>();
    const client = fakeClient([]);
    client.schema = vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(latest.promise);
    const state = new SweepState(client, 0);
    const pendingOld = state.loadSchema('old');
    const pendingNew = state.loadSchema('new');
    old.reject(new Error('old syntax error'));
    await expect(pendingOld).resolves.toBeUndefined();
    expect(state.schemaLoading).toBe(true);
    expect(state.schemaError).toBeNull();
    latest.resolve({});
    await pendingNew;
  });

  it('cancels a superseded pending start without replacing the latest sweep', async () => {
    const oldStart = deferred<{ sweep_id: string }>();
    const client = fakeClient([progress({ status: 'done' })]);
    client.start = vi
      .fn()
      .mockReturnValueOnce(oldStart.promise)
      .mockResolvedValueOnce({ sweep_id: 'new' });
    const state = new SweepState(client, 0);
    const pendingOld = state.run(FORM);
    await state.run(FORM);
    oldStart.resolve({ sweep_id: 'old' });
    await pendingOld;
    expect(client.cancel).toHaveBeenCalledExactlyOnceWith('old');
    expect(state.sweepId).toBe('new');
  });

  it('clears the previous id and queues cancellation until start returns the new id', async () => {
    const start = deferred<{ sweep_id: string }>();
    const client = fakeClient([
      progress({ status: 'done', total: 4, done: 4 }),
    ]);
    const state = new SweepState(client, 0);
    await state.run(FORM);
    client.start = vi.fn(() => start.promise);
    client.poll = vi.fn(async () =>
      progress({ sweep_id: 's2', status: 'cancelled' }),
    );
    const pending = state.run(FORM);
    expect(state.sweepId).toBeNull();
    expect(state.total).toBe(0);
    await state.cancel();
    expect(client.cancel).not.toHaveBeenCalled();
    start.resolve({ sweep_id: 's2' });
    await pending;
    expect(client.cancel).toHaveBeenCalledExactlyOnceWith('s2');
    expect(state.status).toBe('cancelled');
  });

  it('does not apply an older poll after a new sweep completes', async () => {
    const oldPoll = deferred<SweepProgress>();
    const client = fakeClient([]);
    client.start = vi
      .fn()
      .mockResolvedValueOnce({ sweep_id: 'old' })
      .mockResolvedValueOnce({ sweep_id: 'new' });
    client.poll = vi
      .fn()
      .mockReturnValueOnce(oldPoll.promise)
      .mockResolvedValueOnce(
        progress({ sweep_id: 'new', status: 'done', done: 4 }),
      );
    const state = new SweepState(client, 0);
    const old = state.run(FORM);
    await Promise.resolve();
    await state.run(FORM);
    oldPoll.resolve(
      progress({ sweep_id: 'old', status: 'error', error: 'old failure' }),
    );
    await old;
    expect(state.status).toBe('done');
    expect(state.sweepId).toBe('new');
    expect(state.error).toBeNull();
  });

  it('ignores an old start failure while a new sweep is running', async () => {
    const oldStart = deferred<{ sweep_id: string }>();
    const newPoll = deferred<SweepProgress>();
    const client = fakeClient([]);
    client.start = vi
      .fn()
      .mockReturnValueOnce(oldStart.promise)
      .mockResolvedValueOnce({ sweep_id: 'new' });
    client.poll = vi.fn(() => newPoll.promise);
    const state = new SweepState(client, 0);
    const old = state.run(FORM);
    const latest = state.run(FORM);
    oldStart.reject(new Error('old failure'));
    await old;
    expect(state.status).toBe('running');
    expect(state.error).toBeNull();
    newPoll.resolve(progress({ sweep_id: 'new', status: 'done' }));
    await latest;
  });

  it('reports a failed cancellation and allows retry without losing polling', async () => {
    const poll = deferred<SweepProgress>();
    const client = fakeClient([]);
    client.poll = vi.fn(() => poll.promise);
    client.cancel = vi
      .fn()
      .mockRejectedValueOnce(new Error('cancel rejected'))
      .mockResolvedValueOnce(undefined);
    const state = new SweepState(client, 0);
    const pending = state.run(FORM);
    await Promise.resolve();
    await expect(state.cancel()).resolves.toBeUndefined();
    expect(state.cancelError).toBe('cancel rejected');
    expect(state.cancelling).toBe(false);
    expect(state.status).toBe('running');
    await state.cancel();
    poll.resolve(progress({ status: 'cancelled' }));
    await pending;
    expect(state.cancelError).toBeNull();
    expect(state.status).toBe('cancelled');
  });

  it('pins a trial loader to its original sweep and form when another run starts', async () => {
    const client = fakeClient([progress({ status: 'done' })]);
    const state = new SweepState(client, 0);
    const form = { ...FORM, vary: ['qty'] };
    await state.run(form);
    const loader = state.trialLoader(2, form);
    form.code = 'changed';
    form.vary.push('other');
    client.start = vi.fn(async () => ({ sweep_id: 's2' }));
    await state.run(form);
    await loader();
    expect(client.loadTrial).toHaveBeenCalledWith('s1', 2, FORM);
  });

  it('starts a sweep then polls to completion', async () => {
    const done = progress({
      status: 'done',
      done: 4,
      best_trial_id: 2,
      trials: [
        {
          trial_id: 2,
          params: { qty: 3 },
          metrics: { sharpe: 1.2 },
          cached: false,
        },
      ],
      result: {
        sweep_id: 's1',
        config: {} as never,
        trials: [],
        best_trial_id: 2,
      },
    });
    const client = fakeClient([progress({ done: 2 }), done]);
    const state = new SweepState(client, 0); // 0ms poll interval for the test

    await state.run({
      code: 'x',
      symbol: 'TEST',
      provider: 'yfinance',
      search: 'grid',
      metric: 'sharpe',
      vary: ['qty'],
    });

    expect(client.start).toHaveBeenCalledOnce();
    expect(state.status).toBe('done');
    expect(state.bestTrialId).toBe(2);
    expect(state.trials).toHaveLength(1);
  });

  it('records an error status', async () => {
    const client = fakeClient([progress({ status: 'error', error: 'boom' })]);
    const state = new SweepState(client, 0);
    await state.run({
      code: 'x',
      symbol: 'TEST',
      provider: 'yfinance',
      search: 'grid',
      metric: 'sharpe',
      vary: ['qty'],
    });
    expect(state.status).toBe('error');
    expect(state.error).toBe('boom');
  });
});

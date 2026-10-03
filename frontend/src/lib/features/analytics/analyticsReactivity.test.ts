import { afterEach, describe, expect, it, vi } from 'vitest';
import { client, clientModule, deferred } from '../chart/reactiveTestSupport';
import { AnalyticsState, type AnalyticsResult } from './analyticsState.svelte';
import * as api from './analyticsApi';
import { METRICS, type MetricId } from './metrics';
import * as storage from '$lib/core/storage';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
const scalar = (
  symbol: string,
  metric: MetricId,
  value: number,
): AnalyticsResult => ({
  kind: 'scalar',
  data: { symbol, metric, value, n: 100 },
});

describe('analytics reactive request ownership', () => {
  it('releases failed in-flight work, including synchronous fetcher throws, for an explicit retry', async () => {
    const state = new AnalyticsState();
    const fetch = vi.fn((): Promise<AnalyticsResult> => {
      throw new Error('failed');
    });
    state.fetchers.sharpe = fetch;
    state.enabled.sharpe = true;
    await state.refresh('AAA');
    expect(state.loading.sharpe).toBe(false);
    expect(state.errors.sharpe).toBe('failed');
    fetch.mockImplementation(() => Promise.resolve(scalar('AAA', 'sharpe', 3)));
    await state.refresh('AAA');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(state.results.sharpe).toEqual(scalar('AAA', 'sharpe', 3));
    expect(state.errors.sharpe).toBeNull();
  });

  it('runs three metrics exactly once through staged completion and same-context refreshes', async () => {
    const { AnalyticsState: State } = clientModule<{
      AnalyticsState: typeof AnalyticsState;
    }>(new URL('./analyticsState.svelte.ts', import.meta.url), {
      './analyticsApi': api,
      './metrics': { METRICS },
      '$lib/core/storage': storage,
    });
    const state = new State();
    const ids = ['sharpe', 'sortino', 'stdev'] as const;
    const requests = ids.map(() => deferred<AnalyticsResult>());
    ids.forEach((id, i) => {
      state.fetchers[id] = vi.fn(() => requests[i].promise);
    });
    const stop = client.effect_root(() => {
      // Mirrors AnalyticsPanel's refresh boundary, including no manual untrack.
      client.user_effect(() => {
        void state.refresh('AAPL');
      });
    });
    cleanups.push(stop);
    client.flush();
    for (const id of ids) {
      state.toggle(id);
      client.flush();
    }
    const pending = state.refresh('AAPL');
    void state.refresh('AAPL');
    for (let i = 0; i < ids.length; i++) {
      requests[i].resolve(scalar('AAPL', ids[i], i));
      await Promise.resolve();
      client.flush();
      void state.refresh('AAPL');
      for (const id of ids) expect(state.fetchers[id]).toHaveBeenCalledTimes(1);
    }
    await pending;
    for (const id of ids) {
      expect(state.results[id]).not.toBeNull();
      expect(state.loading[id]).toBe(false);
    }
  });

  it('fences reverse symbol completion, invalidation and disabled requests', async () => {
    const state = new AnalyticsState();
    const old = deferred<AnalyticsResult>();
    const current = deferred<AnalyticsResult>();
    state.fetchers.sharpe = vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(current.promise);
    state.toggle('sharpe');
    const first = state.refresh('AAA');
    const second = state.refresh('BBB');
    current.resolve(scalar('BBB', 'sharpe', 2));
    await second;
    old.reject(new Error('AAA failed'));
    await first;
    expect(state.results.sharpe).toEqual(scalar('BBB', 'sharpe', 2));
    expect(state.errors.sharpe).toBeNull();
    const obsolete = deferred<AnalyticsResult>();
    state.fetchers.sharpe = vi
      .fn()
      .mockReturnValueOnce(obsolete.promise)
      .mockResolvedValueOnce(scalar('BBB', 'sharpe', 3));
    state.invalidate();
    state.toggle('sharpe');
    obsolete.resolve(scalar('BBB', 'sharpe', 99));
    await Promise.resolve();
    expect(state.results.sharpe).toBeNull();
    state.toggle('sharpe');
    await state.refresh('BBB');
    expect(state.results.sharpe).toEqual(scalar('BBB', 'sharpe', 3));
  });

  it('does not restore old correlation rows after clearing benchmarks', async () => {
    const state = new AnalyticsState();
    const old = deferred<AnalyticsResult>();
    state.fetchers.correlation = vi.fn(() => old.promise);
    state.toggle('correlation');
    const pending = state.refresh('AAA');
    state.setCorrelationBenchmarks([]);
    old.resolve({
      kind: 'correlation',
      data: {
        symbol: 'AAA',
        metric: 'correlation',
        rows: [{ benchmark: 'SPY', value: 0.9 }],
      },
    });
    await pending;
    expect(state.results.correlation).toEqual({
      kind: 'correlation',
      data: { symbol: 'AAA', metric: 'correlation', rows: [] },
    });
    expect(state.loading.correlation).toBe(false);
  });
});

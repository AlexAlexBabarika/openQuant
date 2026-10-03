import { afterEach, describe, expect, it, vi } from 'vitest';
import { client, clientModule, deferred } from './reactiveTestSupport';
import type {
  useIndicatorEffect,
  IndicatorResult,
} from './indicatorEffect.svelte';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.useRealTimers();
});

function setup() {
  vi.useFakeTimers();
  const context = client.proxy({
    enabled: true,
    hasCandles: true,
    symbol: 'AAA',
    version: 1,
    period: 20,
    account: 'one',
  });
  let session = 0;
  const errors = vi.fn();
  const requests: ReturnType<typeof deferred<number[]>>[] = [];
  const fetch = vi.fn(
    (_symbol: string, _args: readonly unknown[], _signal: AbortSignal) => {
      const request = deferred<number[]>();
      requests.push(request);
      return request.promise;
    },
  );
  const { useIndicatorEffect: use } = clientModule<{
    useIndicatorEffect: typeof useIndicatorEffect;
  }>(new URL('./indicatorEffect.svelte.ts', import.meta.url), {
    '$lib/core/api': { getSessionGeneration: () => session },
  });
  let result!: IndicatorResult<number>;
  const stop = client.effect_root(() => {
    result = use<number>({
      enabled: () => context.enabled,
      hasCandles: () => context.hasCandles,
      symbol: () => context.symbol,
      version: () => context.version,
      args: () => [context.period],
      account: () => context.account,
      fetch,
      onError: errors,
      label: 'SMA',
    });
  });
  cleanups.push(stop);
  client.flush();
  return {
    context,
    result,
    fetch,
    requests,
    errors,
    stop,
    changeSession: () => session++,
  };
}

describe('indicator context ownership', () => {
  it.each(['symbol', 'period', 'version', 'account'] as const)(
    'keeps latest success and ignores obsolete errors/success after %s changes',
    async field => {
      const { context, result, fetch, requests, errors } = setup();
      await vi.advanceTimersByTimeAsync(300);
      if (field === 'symbol') context.symbol = 'BBB';
      else if (field === 'account') context.account = 'two';
      else context[field]++;
      client.flush();
      expect(fetch.mock.calls[0][2].aborted).toBe(true);
      await vi.advanceTimersByTimeAsync(300);
      requests[1].resolve([2]);
      await Promise.resolve();
      expect(result.points).toEqual([2]);
      requests[0].reject(new Error('obsolete'));
      await Promise.resolve();
      expect(errors).not.toHaveBeenCalled();
      expect(result.points).toEqual([2]);

      context.version++;
      client.flush();
      expect(result.points).toEqual([]);
      await vi.advanceTimersByTimeAsync(300);
      context.version++;
      client.flush();
      await vi.advanceTimersByTimeAsync(300);
      requests[3].resolve([4]);
      await Promise.resolve();
      requests[2].resolve([99]);
      await Promise.resolve();
      expect(result.points).toEqual([4]);
    },
  );

  it.each(['disable', 'no-candles', 'destroy', 'session'] as const)(
    'drops pending/in-flight writes on %s',
    async change => {
      const { context, result, fetch, requests, errors, stop, changeSession } =
        setup();
      await vi.advanceTimersByTimeAsync(300);
      if (change === 'disable') context.enabled = false;
      if (change === 'no-candles') context.hasCandles = false;
      if (change === 'destroy') stop();
      if (change === 'session') changeSession();
      client.flush();
      requests[0].resolve([99]);
      await Promise.resolve();
      expect(result.points).toEqual([]);
      expect(errors).not.toHaveBeenCalled();
      if (change !== 'session')
        expect(fetch.mock.calls[0][2].aborted).toBe(true);
    },
  );

  it('cancels debounce timers and reports only the current request error', async () => {
    const { context, fetch, requests, result, errors } = setup();
    context.enabled = false;
    client.flush();
    await vi.advanceTimersByTimeAsync(300);
    expect(fetch).not.toHaveBeenCalled();
    context.enabled = true;
    client.flush();
    await vi.advanceTimersByTimeAsync(300);
    requests[0].reject(new Error('current failure'));
    await Promise.resolve();
    expect(result.points).toEqual([]);
    expect(errors).toHaveBeenCalledExactlyOnceWith('current failure');
  });
});

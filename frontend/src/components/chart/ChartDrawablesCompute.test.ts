import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  client,
  clientModule,
  deferred,
} from '$lib/features/chart/reactiveTestSupport';
import * as fingerprint from '$lib/features/chart/candleFingerprint';
import { withRulerCandleIndex } from '$lib/features/drawables/tools/ruler/compute';
import { createDrawableComputeScheduler } from '$lib/features/drawables/computeScheduler';
import type {
  DrawableComputeState,
  ComputeCtx,
} from '$lib/features/drawables/types';
import type { OHLCVCandle } from '$lib/core/types';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
const item = (id: string) => ({
  id,
  type: 'ruler',
  geometry: { endTime: 1 },
  params: {},
  style: { showStats: true },
});

function setup(candleRevision?: number, types = ['ruler', 'ruler']) {
  const props = client.proxy({
    symbol: 'AAA',
    provider: 'binance',
    interval: '1m',
    candleRevision,
    items: types.map((type, i) => ({ ...item(i === 0 ? 'a' : 'b'), type })),
    candles: [
      {
        symbol: 'AAA',
        timestamp: '2026-01-01T00:00:00Z',
        open: 1,
        high: 2,
        low: 1,
        close: 2,
        volume: 100,
      },
    ] as OHLCVCandle[],
  });
  const data = client.state(new Map<string, unknown>());
  const states = client.state(new Map<string, DrawableComputeState>());
  const requests: {
    id: string;
    signal: AbortSignal;
    volume: number;
    endTime: number;
    context: string;
    request: ReturnType<typeof deferred<unknown>>;
  }[] = [];
  const compute = vi.fn(
    (d: { id: string; geometry: { endTime: number } }, ctx: ComputeCtx) => {
      const request = deferred<unknown>();
      requests.push({
        id: d.id,
        signal: ctx.signal,
        request,
        volume: ctx.candles[0]?.volume,
        endTime: d.geometry.endTime,
        context: `${ctx.symbol}/${ctx.provider}/${ctx.interval}`,
      });
      return request.promise;
    },
  );
  const signature = vi.fn(fingerprint.candleBatchSignature);
  const component = clientModule<{
    default: (anchor: unknown, props: unknown) => void;
  }>(new URL('./ChartDrawablesCompute.svelte', import.meta.url), {
    '$lib/features/chart/candleFingerprint': {
      ...fingerprint,
      candleBatchSignature: signature,
    },
    '$lib/features/drawables': {
      getTool: (type: string) =>
        type === 'ruler'
          ? { compute }
          : type === 'position-long'
            ? { compute, computeUsesCandles: false }
            : undefined,
    },
    '$lib/features/drawables/tools/ruler/compute': { withRulerCandleIndex },
    '$lib/features/drawables/computeScheduler': {
      createDrawableComputeScheduler,
    },
    '$lib/core/dev/drawablesProfile': {
      measureDrawablesSync: (_label: string, fn: () => unknown) => fn(),
    },
  }).default;
  const stop = client.effect_root(() =>
    component(null, {
      get symbol() {
        return props.symbol;
      },
      get provider() {
        return props.provider;
      },
      get interval() {
        return props.interval;
      },
      get items() {
        return props.items;
      },
      get candles() {
        return props.candles;
      },
      get candleRevision() {
        return props.candleRevision;
      },
      get computedData() {
        return client.get(data);
      },
      set computedData(value: Map<string, unknown>) {
        client.set(data, value);
      },
      get computedStates() {
        return client.get(states);
      },
      set computedStates(value: Map<string, DrawableComputeState>) {
        client.set(states, value);
      },
    }),
  );
  cleanups.push(stop);
  client.flush();
  return {
    props,
    data: () => client.get(data),
    states: () => client.get(states),
    requests,
    compute,
    signature,
    stop,
  };
}

describe('drawable compute state and dirty keys', () => {
  it('clears large-scene pending work and results when returning to 500 bars / zero Elements', async () => {
    const { props, requests, data, states, stop } = setup(0, ['ruler']);
    props.candles = Array.from({ length: 50_000 }, (_, i) => ({
      ...props.candles[0],
      timestamp: new Date(i * 60_000).toISOString(),
    }));
    props.candleRevision = 1;
    client.flush();
    requests[0].request.resolve('old');
    await Promise.resolve();
    expect(requests).toHaveLength(2);
    props.candles = props.candles.slice(0, 500);
    props.items = [];
    props.candleRevision = 2;
    client.flush();
    expect(requests[1].signal.aborted).toBe(true);
    expect(data().size).toBe(0);
    expect(states().size).toBe(0);
    requests[1].request.resolve('obsolete-large-scene');
    await Promise.resolve();
    expect(requests).toHaveLength(2);
    expect(data().size).toBe(0);
    expect(states().size).toBe(0);
    stop();
    expect(data().size).toBe(0);
    expect(states().size).toBe(0);
  });

  it('reuses context/geometry keys for 100 Elements across a candle publication burst', async () => {
    const { props, requests, data } = setup(0, ['ruler']);
    props.items = Array.from({ length: 100 }, (_, i) => item(`element-${i}`));
    client.flush();
    const stringify = vi.spyOn(JSON, 'stringify');
    try {
      for (let revision = 1; revision <= 100; revision++) {
        props.candles = [{ ...props.candles[0], volume: revision }];
        props.candleRevision = revision;
        client.flush();
      }
      const contextKeys = () =>
        stringify.mock.calls.filter(
          ([value]) => Array.isArray(value) && value.length === 7,
        );
      expect(contextKeys()).toHaveLength(0);
      expect(requests).toHaveLength(101);
      expect(requests.slice(1).every(r => !r.signal.aborted)).toBe(true);
      for (const r of requests) r.request.resolve('obsolete');
      await Promise.resolve();
      expect(requests).toHaveLength(201);
      expect(requests.slice(101).every(r => r.volume === 100)).toBe(true);
      expect(data().size).toBe(0);
      for (const r of requests.slice(101)) r.request.resolve('terminal');
      await Promise.resolve();
      expect(data().size).toBe(100);
      expect([...data().values()].every(value => value === 'terminal')).toBe(
        true,
      );
      props.items[0].geometry.endTime = 2;
      client.flush();
      expect(contextKeys()).toHaveLength(100);
      expect(requests).toHaveLength(202);
      expect(requests[201].endTime).toBe(2);
      expect(data().has('element-0')).toBe(false);
      expect(data().size).toBe(99);
    } finally {
      stringify.mockRestore();
    }
  });

  it('coalesces a publication burst to one latest request per Element without abort churn', async () => {
    const { props, requests, data, states } = setup(0);
    for (let revision = 1; revision <= 100; revision++) {
      props.candles = [{ ...props.candles[0], volume: revision }];
      props.candleRevision = revision;
      client.flush();
      expect(requests).toHaveLength(2);
      expect(states().get('a')?.status).toBe('pending');
    }
    const latestKey = states().get('a')?.workKey;
    expect(requests.every(r => !r.signal.aborted)).toBe(true);
    requests[0].request.resolve('obsolete');
    requests[1].request.reject(new Error('obsolete error'));
    await Promise.resolve();
    expect(requests).toHaveLength(4);
    expect(requests.slice(2).map(r => r.volume)).toEqual([100, 100]);
    expect(data().size).toBe(0);
    expect(states().get('a')).toEqual({
      status: 'pending',
      workKey: latestKey,
    });
    expect(states().get('b')?.status).toBe('pending');
    requests[2].request.resolve('latest');
    requests[3].request.reject(new Error('current error'));
    await Promise.resolve();
    expect(data().get('a')).toBe('latest');
    expect(states().get('a')).toEqual({
      status: 'success',
      workKey: latestKey,
    });
    expect(states().get('b')).toMatchObject({
      status: 'error',
      error: 'current error',
    });
  });

  it.each([
    'geometry',
    'params',
    'style',
    'symbol',
    'provider',
    'interval',
  ] as const)(
    'cancels obsolete %s work and waits for abort settlement before launching only the latest',
    async field => {
      const { props, requests, data, states } = setup(0, ['ruler']);
      props.candleRevision = 1;
      client.flush();
      if (field === 'geometry') props.items[0].geometry.endTime = 2;
      else if (field === 'params') props.items[0].params = { changed: 1 };
      else if (field === 'style') props.items[0].style.showStats = false;
      else props[field] = 'changed';
      client.flush();
      props.candles = [{ ...props.candles[0], volume: 999 }];
      props.candleRevision = 2;
      client.flush();
      expect(requests).toHaveLength(1);
      expect(requests[0].signal.aborted).toBe(true);
      const key = states().get('a')?.workKey;
      requests[0].request.reject(new DOMException('Aborted', 'AbortError'));
      await Promise.resolve();
      expect(requests).toHaveLength(2);
      expect(requests[1].volume).toBe(999);
      expect(data().has('a')).toBe(false);
      expect(states().get('a')).toEqual({ status: 'pending', workKey: key });
      requests[1].request.resolve('fresh');
      await Promise.resolve();
      expect(data().get('a')).toBe('fresh');
    },
  );

  it('does not defer synchronous geometry-only work behind another Element request', () => {
    const { props, compute, data, states, requests } = setup(0, ['ruler']);
    compute.mockImplementation(() => 'sync' as never);
    props.items.push({ ...item('b'), type: 'position-long' });
    client.flush();
    expect(data().get('b')).toBe('sync');
    expect(states().get('b')?.status).toBe('success');
    props.items[1].geometry.endTime = 2;
    client.flush();
    expect(compute).toHaveBeenCalledTimes(3);
    props.candleRevision = 1;
    client.flush();
    expect(compute).toHaveBeenCalledTimes(3);
    expect(requests).toHaveLength(1);
    expect(data().get('b')).toBe('sync');
  });

  it('drops deleted pending work, fences reused IDs, and isolates a remounted component', async () => {
    const first = setup(0, ['ruler']);
    first.props.candleRevision = 1;
    client.flush();
    first.props.items = [];
    client.flush();
    expect(first.requests[0].signal.aborted).toBe(true);
    expect(first.states().size).toBe(0);
    first.props.items = [item('a')];
    client.flush();
    expect(first.requests).toHaveLength(1);
    first.requests[0].request.resolve('deleted');
    await Promise.resolve();
    expect(first.requests).toHaveLength(2);
    expect(first.data().size).toBe(0);
    first.props.candleRevision = 2;
    client.flush();
    first.stop();
    const second = setup(2, ['ruler']);
    first.requests[1].request.resolve('destroyed');
    await Promise.resolve();
    expect(first.requests).toHaveLength(2);
    expect(first.data().size).toBe(0);
    expect(first.states().size).toBe(0);
    expect(second.states().get('a')?.status).toBe('pending');
    second.requests[0].request.resolve('remounted');
    await Promise.resolve();
    expect(second.data().get('a')).toBe('remounted');
  });

  it('uses owned revisions without scanning history, including same-reference edits', async () => {
    const { props, requests, signature, data } = setup(0);
    expect(signature).not.toHaveBeenCalled();
    requests[0].request.resolve('old');
    await Promise.resolve();
    props.candles[0].volume = 777;
    props.candleRevision = 1;
    client.flush();
    expect(requests).toHaveLength(3);
    expect(data().has('a')).toBe(false);
    expect(requests[1].signal.aborted).toBe(false);
    props.candles = [{ ...props.candles[0], high: 500 }];
    props.candleRevision = 2;
    client.flush();
    expect(requests).toHaveLength(3);
    expect(signature).not.toHaveBeenCalled();
    requests[2].request.resolve('obsolete');
    await Promise.resolve();
    expect(requests).toHaveLength(4);
    expect(data().has('a')).toBe(false);
    props.candleRevision = undefined;
    client.flush();
    expect(signature).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(4);
    requests[3].request.resolve('old revision');
    requests[1].request.resolve('old b');
    await Promise.resolve();
    expect(requests).toHaveLength(6);
    requests[4].request.resolve('latest a');
    requests[5].request.resolve('latest b');
    await Promise.resolve();
    expect(data().get('a')).toBe('latest a');
    expect(data().get('b')).toBe('latest b');
  });

  it('keeps geometry-only work/results across candle changes without hashing history', async () => {
    const { props, requests, signature, data } = setup(undefined, [
      'position-long',
    ]);
    const pending = requests[requests.length - 1];
    const requestCount = requests.length;
    signature.mockClear();
    props.candles[0].close = 99;
    client.flush();
    expect(pending.signal.aborted).toBe(false);
    expect(requests).toHaveLength(requestCount);
    pending.request.resolve('metrics');
    await Promise.resolve();
    props.candles = [{ ...props.candles[0], volume: 500 }];
    client.flush();
    expect(signature).not.toHaveBeenCalled();
    expect(requests).toHaveLength(requestCount);
    expect(data().get('a')).toBe('metrics');
    props.items[0].geometry.endTime = 2;
    client.flush();
    expect(requests).toHaveLength(requestCount + 1);
    expect(data().has('a')).toBe(false);
    props.interval = '1h';
    client.flush();
    expect(requests).toHaveLength(requestCount + 1);
    expect(requests[requestCount].signal.aborted).toBe(true);
    requests[requestCount].request.resolve('obsolete');
    await Promise.resolve();
    expect(requests).toHaveLength(requestCount + 2);
    expect(data().has('a')).toBe(false);
  });

  it('only recalculates candle-dependent tools in a mixed scene', async () => {
    const { props, requests, data } = setup(undefined, [
      'position-long',
      'ruler',
    ]);
    requests[0].request.resolve('position-metrics');
    requests[1].request.resolve('ruler-volume');
    await Promise.resolve();
    props.candles[0].volume = 777;
    client.flush();
    expect(requests.map(r => r.id)).toEqual(['a', 'b', 'b']);
    expect(requests[0].signal.aborted).toBe(false);
    expect(data().get('a')).toBe('position-metrics');
    expect(data().has('b')).toBe(false);
  });

  it('skips history hashing without compute tools and resumes with fresh candles', () => {
    const { props, signature, requests } = setup();
    props.items = [];
    client.flush();
    signature.mockClear();
    props.candles[0].close = 3;
    props.candles.push({
      ...props.candles[0],
      timestamp: '2026-01-01T00:01:00Z',
    });
    client.flush();
    expect(signature).not.toHaveBeenCalled();
    props.items = [{ ...item('c'), type: 'horizontal-line' }];
    client.flush();
    expect(signature).not.toHaveBeenCalled();
    props.items[0].type = 'ruler';
    client.flush();
    expect(signature).toHaveBeenCalledOnce();
    expect(requests[requests.length - 1]?.id).toBe('c');
    expect(signature.mock.calls[0][0]).toHaveLength(2);
    expect(signature.mock.calls[0][0][0].close).toBe(3);
  });

  it('clears result/status and cancels work if the same id no longer has a compute tool', async () => {
    const { props, requests, data, states } = setup();
    requests[0].request.resolve('old');
    await Promise.resolve();
    props.items[0].type = 'horizontal-line';
    props.items[1].type = 'horizontal-line';
    client.flush();
    expect(requests[1].signal.aborted).toBe(true);
    requests[1].request.resolve('obsolete');
    await Promise.resolve();
    expect(data().size).toBe(0);
    expect(states().size).toBe(0);
  });

  it('clears prior success immediately on pending/error/retry and fences reversed completion', async () => {
    const { props, data, states, requests } = setup();
    expect(states().get('a')?.status).toBe('pending');
    requests[0].request.resolve('first');
    requests[1].request.resolve('independent');
    await Promise.resolve();
    expect(data().get('a')).toBe('first');
    expect(states().get('a')?.status).toBe('success');
    const oldKey = states().get('a')?.workKey;
    props.items[0].geometry.endTime = 2;
    client.flush();
    expect(requests).toHaveLength(3);
    expect(requests[2].signal.aborted).toBe(false);
    expect(data().has('a')).toBe(false);
    expect(states().get('a')).toEqual({
      status: 'pending',
      workKey: expect.any(String),
    });
    expect(states().get('a')?.workKey).not.toBe(oldKey);
    expect(data().get('b')).toBe('independent');
    requests[2].request.reject(new Error('failed'));
    await Promise.resolve();
    expect(states().get('a')).toEqual({
      status: 'error',
      error: 'failed',
      workKey: expect.any(String),
    });
    expect(data().has('a')).toBe(false);
    props.items[0].geometry.endTime = 3;
    client.flush();
    expect(states().get('a')?.status).toBe('pending');
    props.items[0].geometry.endTime = 4;
    client.flush();
    expect(requests).toHaveLength(4);
    expect(requests[3].signal.aborted).toBe(true);
    requests[3].request.resolve('obsolete');
    await Promise.resolve();
    expect(data().has('a')).toBe(false);
    expect(requests).toHaveLength(5);
    requests[4].request.resolve('latest');
    await Promise.resolve();
    expect(data().get('a')).toBe('latest');
    expect(states().get('a')?.status).toBe('success');
  });

  it('detects same-reference proxy edits but skips unchanged elements and equivalent arrays', async () => {
    const { props, requests, signature, data } = setup();
    requests[0].request.resolve('a');
    requests[1].request.resolve('b');
    await Promise.resolve();
    const firstSignatureCount = signature.mock.calls.length;
    props.items[0].style.showStats = false;
    client.flush();
    expect(requests.map(r => r.id)).toEqual(['a', 'b', 'a']);
    expect(signature).toHaveBeenCalledTimes(firstSignatureCount);
    props.items = props.items.map(d => ({
      ...d,
      geometry: { ...d.geometry },
      params: {},
      style: { ...d.style },
    }));
    props.candles = props.candles.map(c => ({ ...c }));
    client.flush();
    expect(requests).toHaveLength(3);
    props.candles[0].close = 3;
    props.candles[0].volume = 500;
    client.flush();
    expect(requests.map(r => r.id)).toEqual(['a', 'b', 'a', 'b']);
    expect(data().size).toBe(0);
    requests[2].request.resolve('obsolete-style');
    requests[3].request.resolve('live-b');
    await Promise.resolve();
    requests[4].request.resolve('live');
    await Promise.resolve();
    props.candles.push({
      ...props.candles[0],
      timestamp: '2026-01-01T00:01:00Z',
    });
    client.flush();
    expect(requests).toHaveLength(7);
    expect(data().size).toBe(0);
  });

  it('prunes deletion, ignores obsolete errors, and clears everything on destroy', async () => {
    const { props, data, states, requests, stop } = setup();
    props.items.splice(0, 1);
    client.flush();
    expect(requests[0].signal.aborted).toBe(true);
    expect(states().has('a')).toBe(false);
    requests[0].request.reject(new Error('deleted'));
    await Promise.resolve();
    expect(states().has('a')).toBe(false);
    stop();
    expect(requests[1].signal.aborted).toBe(true);
    requests[1].request.resolve('destroyed');
    await Promise.resolve();
    expect(data().size).toBe(0);
    expect(states().size).toBe(0);
  });

  it('reports synchronous throw and success without retaining stale values', async () => {
    const { props, compute, data, states, requests } = setup();
    requests[0].request.resolve('old');
    await Promise.resolve();
    compute.mockImplementationOnce(() => {
      throw new Error('sync failure');
    });
    props.items[0].geometry.endTime = 2;
    client.flush();
    expect(data().has('a')).toBe(false);
    expect(states().get('a')?.status).toBe('error');
    compute.mockImplementationOnce(() => 'fresh' as never);
    props.items[0].geometry.endTime = 3;
    client.flush();
    expect(data().get('a')).toBe('fresh');
    expect(states().get('a')?.status).toBe('success');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  client,
  clientModule,
  deferred,
} from '$lib/features/chart/reactiveTestSupport';
import * as fingerprint from '$lib/features/chart/candleFingerprint';
import { withRulerCandleIndex } from '$lib/features/drawables/tools/ruler/compute';
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

function setup() {
  const props = client.proxy({
    symbol: 'AAA',
    provider: 'binance',
    interval: '1m',
    items: [item('a'), item('b')],
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
    request: ReturnType<typeof deferred<unknown>>;
  }[] = [];
  const compute = vi.fn((d: { id: string }, ctx: ComputeCtx) => {
    const request = deferred<unknown>();
    requests.push({ id: d.id, signal: ctx.signal, request });
    return request.promise;
  });
  const signature = vi.fn(fingerprint.candleBatchSignature);
  const component = clientModule<{
    default: (anchor: unknown, props: unknown) => void;
  }>(new URL('./ChartDrawablesCompute.svelte', import.meta.url), {
    '$lib/features/chart/candleFingerprint': {
      ...fingerprint,
      candleBatchSignature: signature,
    },
    '$lib/features/drawables': {
      getTool: (type: string) => (type === 'ruler' ? { compute } : undefined),
    },
    '$lib/features/drawables/tools/ruler/compute': { withRulerCandleIndex },
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
    expect(requests.every(r => r.signal.aborted)).toBe(true);
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
    expect(requests[0].signal.aborted).toBe(true);
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
    requests[4].request.resolve('latest');
    await Promise.resolve();
    requests[3].request.resolve('obsolete');
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
    expect(requests.map(r => r.id)).toEqual(['a', 'b', 'a', 'a', 'b']);
    expect(data().size).toBe(0);
    requests[3].request.resolve('live');
    requests[4].request.resolve('live-b');
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

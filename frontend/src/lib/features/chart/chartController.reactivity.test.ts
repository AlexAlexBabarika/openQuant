import { afterEach, describe, expect, it, vi } from 'vitest';
import { client, clientModule, deferred } from './reactiveTestSupport';
import type { ChartController } from './chartController.svelte';
import type { OHLCVCandle } from '$lib/core/types';
import {
  mergeCandleSnapshot,
  type SubscribeMarketStreamOptions,
} from '../market/streaming';
import { providerSupportsWs } from '../market/marketDataProviders';
import { DEFAULT_MARKET_INTERVAL } from '../market/marketIntervals';
import { DEFAULT_MARKET_PERIOD } from '../market/marketPeriods';

const candle: OHLCVCandle = {
  symbol: 'BTCUSDT',
  timestamp: '2026-01-01T00:00:00Z',
  open: 10,
  high: 12,
  low: 9,
  close: 11,
  volume: 100,
};
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function setup(source: 'binance' | 'csv' = 'binance') {
  const fetchHistory = vi.fn(async () => ({ candles: [candle] }));
  const subscribe = vi.fn((_opts: SubscribeMarketStreamOptions) => vi.fn());
  const csvCallbacks: { onCandle?: (c: OHLCVCandle) => void }[] = [];
  const module = clientModule<{ ChartController: typeof ChartController }>(
    new URL('./chartController.svelte.ts', import.meta.url),
    {
      '$lib/core/api': { apiFetch: vi.fn(), readErrorMessage: vi.fn() },
      '$lib/core/ws': {
        WSClient: class {
          constructor(opts: (typeof csvCallbacks)[number]) {
            csvCallbacks.push(opts);
          }
          connect() {}
          disconnect() {}
        },
      },
      '$lib/features/market/marketData': { fetchMarketOHLCV: fetchHistory },
      '$lib/features/market/marketIntervals': { DEFAULT_MARKET_INTERVAL },
      '$lib/features/market/marketPeriods': { DEFAULT_MARKET_PERIOD },
      '$lib/features/market/marketDataProviders': { providerSupportsWs },
      '$lib/features/market/streaming': {
        subscribeMarketStream: subscribe,
        mergeCandleSnapshot,
      },
    },
  );
  let controller!: ChartController;
  const user = client.proxy({ id: 'user-1' as string | null });
  const snapshots: number[][] = [];
  const reset = vi.fn();
  const append = vi.fn();
  const stop = client.effect_root(() => {
    controller = new module.ChartController({
      initialSymbol: 'BTCUSDT',
      initialSource: source,
      userId: () => user.id,
    });
    controller.chartApi = { appendCandle: append };
    // Same tracking boundary as Chart's full-history series-data effect.
    client.user_effect(() => {
      const data = controller.candles;
      client.untrack(() => reset(data));
    });
    client.user_effect(() => {
      snapshots.push([
        controller.candles.length,
        controller.candles[controller.candles.length - 1]?.close ?? 0,
        controller.candles.reduce((n, c) => n + c.volume, 0),
      ]);
    });
  });
  cleanups.push(stop);
  client.flush();
  return {
    controller,
    fetchHistory,
    subscribe,
    snapshots,
    reset,
    append,
    csvCallbacks,
    user,
    stop,
  };
}

describe('chart reactive publication', () => {
  it('publishes same/new bars once without invalidating the history-reference consumer', async () => {
    const { controller, snapshots, reset, append, subscribe } = setup();
    await controller.loadMarketData();
    client.flush();
    const ref = controller.candles;
    const resetCount = reset.mock.calls.length;
    const publicationCount = snapshots.length;
    const callbacks = subscribe.mock.calls[0][0];
    callbacks.onCandle({ ...candle, close: 77, volume: 200 }, false);
    client.flush();
    expect(snapshots[snapshots.length - 1]).toEqual([1, 77, 200]);
    expect(snapshots).toHaveLength(publicationCount + 1);
    callbacks.onCandle(
      { ...candle, timestamp: '2026-01-01T00:01:00Z', close: 88, volume: 300 },
      false,
    );
    client.flush();
    expect(snapshots[snapshots.length - 1]).toEqual([2, 88, 500]);
    expect(snapshots).toHaveLength(publicationCount + 2);
    expect(controller.candles).toBe(ref);
    expect(append).toHaveBeenCalledTimes(2);
    expect(reset).toHaveBeenCalledTimes(resetCount);
    const before = snapshots.length;
    callbacks.onSnapshot?.([candle]);
    client.flush();
    expect(snapshots).toHaveLength(before);
  });

  it('publishes CSV updates and drops old callbacks after account/destroy', () => {
    const { controller, csvCallbacks, snapshots, reset, append, user, stop } =
      setup('csv');
    controller.startStream();
    client.flush();
    const callback = csvCallbacks[0].onCandle!;
    const resets = reset.mock.calls.length;
    callback(candle);
    client.flush();
    callback({ ...candle, close: 33 });
    client.flush();
    expect(snapshots[snapshots.length - 1]).toEqual([1, 33, 100]);
    expect(reset).toHaveBeenCalledTimes(resets);
    user.id = null;
    callback({ ...candle, close: 99 });
    client.flush();
    expect(controller.candles).toEqual([]);
    stop();
    callback(candle);
    expect(append).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])(
    'loads/starts once at startup (failure=%s) then once on timeframe change',
    async fail => {
      const { controller, fetchHistory, subscribe } = setup();
      if (fail) fetchHistory.mockRejectedValueOnce(new Error('unavailable'));
      await controller.loadMarketData();
      client.flush();
      await Promise.resolve();
      client.flush();
      expect(fetchHistory).toHaveBeenCalledTimes(1);
      expect(subscribe).toHaveBeenCalledTimes(fail ? 0 : 1);
      controller.interval = '1h';
      client.flush();
      await Promise.resolve();
      client.flush();
      expect(fetchHistory).toHaveBeenCalledTimes(2);
      expect(subscribe).toHaveBeenCalledTimes(fail ? 1 : 2);
      client.flush();
      expect(fetchHistory).toHaveBeenCalledTimes(2);
    },
  );

  it('reloads a timeframe selected while startup is still pending', async () => {
    const { controller, fetchHistory, subscribe } = setup();
    const old = deferred<{ candles: OHLCVCandle[] }>();
    fetchHistory.mockReturnValueOnce(old.promise);
    const pending = controller.loadMarketData();
    controller.interval = '1h';
    client.flush();
    old.resolve({ candles: [candle] });
    await pending;
    client.flush();
    await Promise.resolve();
    client.flush();
    expect(fetchHistory).toHaveBeenCalledTimes(2);
    expect(subscribe).toHaveBeenCalledTimes(1);
  });
});

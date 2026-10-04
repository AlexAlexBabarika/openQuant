import { afterEach, describe, expect, it, vi } from 'vitest';
import { onDestroy } from 'svelte';
import { ChartController } from './chartController.svelte';
import {
  fetchMarketOHLCV,
  type MarketOHLCVResponse,
} from '../market/marketData';
import { subscribeMarketStream } from '../market/streaming';
import { apiFetch } from '$lib/core/api';
import { WSClient } from '$lib/core/ws';
import type { OHLCVCandle } from '$lib/core/types';

vi.mock('svelte', async importOriginal => ({
  ...(await importOriginal<typeof import('svelte')>()),
  onDestroy: vi.fn(),
}));
vi.mock('../market/marketData', () => ({ fetchMarketOHLCV: vi.fn() }));
vi.mock('../market/streaming', async importOriginal => ({
  ...(await importOriginal<typeof import('../market/streaming')>()),
  subscribeMarketStream: vi.fn(),
}));
vi.mock('$lib/core/api', () => ({
  apiFetch: vi.fn(),
  readErrorMessage: vi.fn(async () => 'Upload failed'),
}));
vi.mock('$lib/core/ws', () => ({
  WSClient: vi.fn(
    class {
      connect = vi.fn();
      disconnect = vi.fn();
    },
  ),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const candle: OHLCVCandle = {
  symbol: 'BTCUSDT',
  timestamp: '2026-01-01T00:00:00Z',
  open: 10,
  high: 12,
  low: 9,
  close: 11,
  volume: 100,
};
const response = { symbol: 'BTCUSDT', candles: [candle] };

function setup() {
  const onSymbolFetched = vi.fn();
  const unsubscribe = vi.fn();
  vi.mocked(subscribeMarketStream).mockReturnValue(unsubscribe);
  vi.mocked(fetchMarketOHLCV).mockResolvedValue(response);
  const controller = new ChartController({
    initialSymbol: 'BTCUSDT',
    initialSource: 'binance',
    onSymbolFetched,
  });
  controller.chartApi = { appendCandle: vi.fn() };
  return { controller, onSymbolFetched, unsubscribe };
}

afterEach(() => vi.resetAllMocks());

describe('chart request and streaming lifecycles', () => {
  it('keeps browser receipt times associated with successful loaded data, including stale failures', async () => {
    const { controller } = setup();
    await controller.loadMarketData();
    const received = controller.snapshotReceivedAt;
    expect(received).toEqual(expect.any(Number));
    expect(controller.streamReceivedAt).toBeNull();
    const callbacks = vi.mocked(subscribeMarketStream).mock.calls[0][0];
    callbacks.onCandle(candle, true);
    expect(controller.streamReceivedAt).toEqual(expect.any(Number));
    controller.symbol = 'OTHER';
    vi.mocked(fetchMarketOHLCV).mockRejectedValueOnce(new Error('offline'));
    await controller.loadMarketData();
    expect(controller.snapshotReceivedAt).toBe(received);
    expect(controller.loadedContext?.symbol).toBe('BTCUSDT');
  });
  it.each([null, 'user-2'])(
    'rejects history and stream callbacks after changing account to %s',
    async nextUser => {
      let userId: string | null = 'user-1';
      const unsubscribe = vi.fn();
      vi.mocked(subscribeMarketStream).mockReturnValue(unsubscribe);
      vi.mocked(fetchMarketOHLCV).mockResolvedValue(response);
      const controller = new ChartController({
        initialSymbol: 'BTCUSDT',
        initialSource: 'binance',
        userId: () => userId,
      });
      await controller.loadMarketData();
      const callbacks = vi.mocked(subscribeMarketStream).mock.calls[0][0];
      const old = deferred<MarketOHLCVResponse>();
      vi.mocked(fetchMarketOHLCV).mockReturnValueOnce(old.promise);
      const pending = controller.loadMarketData();
      userId = nextUser;
      callbacks.onCandle?.({ ...candle, close: 999 }, true);
      old.resolve({ ...response, candles: [{ ...candle, close: 888 }] });
      await pending;
      expect(controller.candles[0].close).toBe(11);
      expect(subscribeMarketStream).toHaveBeenCalledTimes(1);
    },
  );

  it('clears private history on logout without an anonymous reload', async () => {
    let userId: string | null = 'user-1';
    const unsubscribe = vi.fn();
    vi.mocked(subscribeMarketStream).mockReturnValue(unsubscribe);
    vi.mocked(fetchMarketOHLCV).mockResolvedValue(response);
    const controller = new ChartController({
      initialSource: 'twelvedata',
      userId: () => userId,
    });
    await controller.loadMarketData();
    userId = null;
    controller.syncSession();
    expect(subscribeMarketStream).not.toHaveBeenCalled();
    expect(controller.candles).toEqual([]);
    expect(controller.loadedSymbol).toBe('');
    expect(controller.connectionStatus).toBe('disconnected');
    expect(fetchMarketOHLCV).toHaveBeenCalledOnce();
  });

  it('disconnects an active stream and reloads under the new account', async () => {
    let userId: string | null = 'user-1';
    const unsubscribe = vi.fn();
    vi.mocked(subscribeMarketStream).mockReturnValue(unsubscribe);
    vi.mocked(fetchMarketOHLCV).mockResolvedValue(response);
    const controller = new ChartController({
      initialSource: 'binance',
      userId: () => userId,
    });
    await controller.loadMarketData();
    const replacement = deferred<MarketOHLCVResponse>();
    vi.mocked(fetchMarketOHLCV).mockReturnValueOnce(replacement.promise);
    userId = 'user-2';
    controller.syncSession();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(controller.connectionStatus).toBe('disconnected');
    expect(controller.isLoading).toBe(true);
    replacement.resolve(response);
    await vi.waitFor(() => expect(controller.isLoading).toBe(false));
    expect(subscribeMarketStream).toHaveBeenCalledTimes(2);
  });

  it('rejects delayed private history after logout before the reactive effect runs', async () => {
    let userId: string | null = 'user-1';
    const controller = new ChartController({
      initialSource: 'twelvedata',
      userId: () => userId,
    });
    const old = deferred<MarketOHLCVResponse>();
    vi.mocked(fetchMarketOHLCV).mockReturnValueOnce(old.promise);
    const pending = controller.loadMarketData();
    userId = null;
    old.resolve(response);
    await pending;
    expect(controller.candles).toEqual([]);
    expect(controller.loadedSymbol).toBe('');
  });

  it('keeps only the newest response and its captured stream context', async () => {
    const { controller, onSymbolFetched } = setup();
    const old = deferred<MarketOHLCVResponse>();
    vi.mocked(fetchMarketOHLCV).mockReturnValueOnce(old.promise);
    const pending = controller.loadMarketData();
    controller.symbol = 'ETHUSDT';
    controller.interval = '1h';
    const ethCandle = { ...candle, symbol: 'ETHUSDT' };
    vi.mocked(fetchMarketOHLCV).mockResolvedValueOnce({
      symbol: 'ETHUSDT',
      candles: [ethCandle],
    });
    await controller.loadMarketData();
    old.resolve({ symbol: 'BTCUSDT', candles: [{ ...candle, close: 5 }] });
    await pending;
    expect(controller.candles).toEqual([ethCandle]);
    expect(controller.loadedSymbol).toBe('ETHUSDT');
    expect(controller.marketDataVersion).toBe(1);
    expect(onSymbolFetched).toHaveBeenCalledExactlyOnceWith(
      'ETHUSDT',
      'binance',
      1,
    );
    expect(subscribeMarketStream).toHaveBeenCalledTimes(1);
    expect(subscribeMarketStream).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'ETHUSDT',
        interval: '1h',
        provider: 'binance',
      }),
    );
  });

  it('does not finish a newer request or display an older error', async () => {
    const { controller } = setup();
    const old = deferred<MarketOHLCVResponse>();
    const current = deferred<MarketOHLCVResponse>();
    vi.mocked(fetchMarketOHLCV)
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(current.promise);
    const first = controller.loadMarketData();
    const second = controller.loadMarketData();
    old.reject(new Error('Old failure'));
    await first;
    expect(controller.isLoading).toBe(true);
    expect(controller.initialLoadDone).toBe(false);
    expect(controller.errorMessage).toBeNull();
    current.resolve(response);
    await second;
    expect(controller.isLoading).toBe(false);
  });

  it.each(['symbol', 'source', 'period', 'interval'] as const)(
    'ignores a response after the selected %s changes without a new request',
    async field => {
      const { controller } = setup();
      const old = deferred<MarketOHLCVResponse>();
      vi.mocked(fetchMarketOHLCV).mockReturnValueOnce(old.promise);
      const pending = controller.loadMarketData();
      if (field === 'source') controller.source = 'yfinance';
      else controller[field] = 'changed';
      old.resolve(response);
      await pending;
      expect(controller.candles).toEqual([]);
      expect(controller.loadedSymbol).toBe('');
      expect(subscribeMarketStream).not.toHaveBeenCalled();
      expect(controller.isLoading).toBe(false);
    },
  );

  it('disconnects the previous stream even when the replacement load fails', async () => {
    const { controller, unsubscribe } = setup();
    await controller.loadMarketData();
    const handlers = vi.mocked(subscribeMarketStream).mock.calls[0][0];
    controller.liveBarCloseTs = Date.parse(candle.timestamp);
    vi.mocked(fetchMarketOHLCV).mockRejectedValueOnce(new Error('Unavailable'));
    controller.symbol = 'ETHUSDT';
    await controller.loadMarketData();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(controller.connectionStatus).toBe('disconnected');
    expect(controller.liveBarCloseTs).toBeNull();
    expect(controller.loadedContext).toMatchObject({
      symbol: 'BTCUSDT',
      source: 'binance',
    });
    expect(controller.dataContextCurrent).toBe(false);
    expect(controller.candles[0].close).toBe(11);
    handlers.onCandle({ ...candle, close: 99 }, true);
    handlers.onCandleClose?.(candle);
    handlers.onStatus?.('connected');
    expect(controller.chartApi?.appendCandle).not.toHaveBeenCalled();
    expect(controller.connectionStatus).toBe('disconnected');
    expect(controller.liveBarCloseTs).toBeNull();
  });

  it('tracks the context of loaded bars, not pending or failed requests', async () => {
    const { controller } = setup();
    expect(controller.loadedContext).toBeNull();
    expect(controller.dataContextCurrent).toBe(false);
    await controller.loadMarketData();
    expect(controller.dataContextCurrent).toBe(true);
    const previous = controller.loadedContext;
    const next = deferred<MarketOHLCVResponse>();
    vi.mocked(fetchMarketOHLCV).mockReturnValueOnce(next.promise);
    controller.symbol = 'ETHUSDT';
    const pending = controller.loadMarketData();
    expect(controller.loadedContext).toEqual(previous);
    expect(controller.dataContextCurrent).toBe(false);
    next.resolve({
      ...response,
      symbol: 'ETHUSDT',
      candles: [{ ...candle, symbol: 'ETHUSDT' }],
    });
    await pending;
    expect(controller.loadedContext?.symbol).toBe('ETHUSDT');
    expect(controller.dataContextCurrent).toBe(true);
  });

  it('does not restart a deliberately stopped stream after refresh or a delayed load', async () => {
    const { controller } = setup();
    await controller.loadMarketData();
    controller.stopStream();
    const old = deferred<MarketOHLCVResponse>();
    vi.mocked(fetchMarketOHLCV).mockReturnValueOnce(old.promise);
    const pending = controller.loadMarketData();
    controller.stopStream();
    old.resolve(response);
    await pending;
    await controller.loadMarketData();
    expect(subscribeMarketStream).toHaveBeenCalledTimes(1);
    controller.startStream();
    expect(subscribeMarketStream).toHaveBeenCalledTimes(2);
  });

  it('invalidates pending loads when the component is destroyed', async () => {
    const { controller } = setup();
    const old = deferred<MarketOHLCVResponse>();
    vi.mocked(fetchMarketOHLCV).mockReturnValueOnce(old.promise);
    const pending = controller.loadMarketData();
    const cleanup = vi.mocked(onDestroy).mock.calls;
    cleanup[cleanup.length - 1][0]();
    old.resolve(response);
    await pending;
    expect(controller.candles).toEqual([]);
    expect(subscribeMarketStream).not.toHaveBeenCalled();
  });

  it('does not let an old CSV upload replace a later remote load', async () => {
    const { controller } = setup();
    controller.source = 'csv';
    const upload = deferred<Response>();
    vi.mocked(apiFetch).mockReturnValueOnce(upload.promise);
    const pending = controller.handleCsvUpload(new File(['data'], 'bars.csv'));
    controller.source = 'binance';
    await controller.loadMarketData();
    upload.resolve(new Response('{}', { status: 200 }));
    await pending;
    expect(WSClient).not.toHaveBeenCalled();
    expect(controller.candles).toEqual([candle]);
  });

  it('updates loaded CSV identity and disconnects it before a remote load fails', async () => {
    const { controller, onSymbolFetched } = setup();
    controller.source = 'csv';
    controller.symbol = ' CSV-SYMBOL ';
    vi.mocked(apiFetch).mockResolvedValueOnce(
      new Response('{}', { status: 200 }),
    );
    await controller.handleCsvUpload(new File(['data'], 'bars.csv'));
    expect(controller.loadedSymbol).toBe('CSV-SYMBOL');
    expect(controller.marketDataVersion).toBe(1);
    expect(onSymbolFetched).toHaveBeenCalledWith('CSV-SYMBOL', 'csv', 0);
    expect(WSClient).toHaveBeenCalledWith(
      expect.objectContaining({ maxReconnectAttempts: 0 }),
    );
    controller.source = 'yfinance';
    vi.mocked(fetchMarketOHLCV).mockRejectedValueOnce(new Error('Unavailable'));
    await controller.loadMarketData();
    expect(
      vi.mocked(WSClient).mock.results[0].value.disconnect,
    ).toHaveBeenCalledTimes(1);
  });

  it('loads the selected context before manually streaming a different symbol', async () => {
    const { controller } = setup();
    await controller.loadMarketData();
    controller.stopStream();
    controller.symbol = 'ETHUSDT';
    const current = deferred<MarketOHLCVResponse>();
    vi.mocked(fetchMarketOHLCV).mockReturnValueOnce(current.promise);
    controller.startStream();
    expect(subscribeMarketStream).toHaveBeenCalledTimes(1);
    expect(controller.isLoading).toBe(true);
    current.resolve({
      symbol: 'ETHUSDT',
      candles: [{ ...candle, symbol: 'ETHUSDT' }],
    });
    await vi.waitFor(() =>
      expect(subscribeMarketStream).toHaveBeenCalledTimes(2),
    );
    expect(controller.loadedSymbol).toBe('ETHUSDT');
  });

  it('replays completed CSV data on a single Stream click', async () => {
    const { controller } = setup();
    controller.source = 'csv';
    vi.mocked(apiFetch).mockResolvedValueOnce(
      new Response('{}', { status: 200 }),
    );
    await controller.handleCsvUpload(new File(['data'], 'bars.csv'));
    vi.mocked(WSClient).mock.calls[0][0].onStatus?.('disconnected');
    controller.startStream();
    expect(WSClient).toHaveBeenCalledTimes(2);
    expect(
      vi.mocked(WSClient).mock.results[1].value.connect,
    ).toHaveBeenCalledTimes(1);
  });

  it('replaces the latest bar when live and REST timestamps use equivalent ISO formats', async () => {
    const { controller } = setup();
    await controller.loadMarketData();
    const handlers = vi.mocked(subscribeMarketStream).mock.calls[0][0];
    const update = {
      ...candle,
      timestamp: '2026-01-01T00:00:00+00:00',
      close: 12,
    };
    handlers.onCandle(update, false);
    expect(controller.candles).toEqual([update]);
  });

  it('fills delayed snapshot gaps without appending older bars through the chart API', async () => {
    const { controller } = setup();
    await controller.loadMarketData();
    const handlers = vi.mocked(subscribeMarketStream).mock.calls[0][0];
    const live = { ...candle, timestamp: '2026-01-01T00:02:00Z', close: 12 };
    handlers.onCandle(live, false);
    const gap = { ...candle, timestamp: '2026-01-01T00:01:00Z' };
    handlers.onSnapshot?.([gap, { ...live, close: 10 }]);
    expect(controller.candles).toEqual([candle, gap, live]);
    expect(controller.chartApi?.appendCandle).toHaveBeenCalledExactlyOnceWith(
      live,
    );
    const next = { ...candle, timestamp: '2026-01-01T00:03:00Z' };
    handlers.onCandle(next, false);
    expect(controller.candles).toEqual([candle, gap, live, next]);
  });
});

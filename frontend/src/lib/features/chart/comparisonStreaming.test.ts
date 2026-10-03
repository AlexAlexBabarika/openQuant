import { afterEach, describe, expect, it, vi } from 'vitest';
import { onDestroy } from 'svelte';
import { ComparisonController } from './comparisonController.svelte';
import {
  listComparisons,
  deleteComparison,
  createComparison,
  updateComparison,
  type ComparisonRecord,
} from './comparisonsApi';
import {
  fetchMarketOHLCV,
  type MarketOHLCVResponse,
} from '../market/marketData';
import { subscribeMarketStream } from '../market/streaming';

vi.mock('svelte', async importOriginal => ({
  ...(await importOriginal<typeof import('svelte')>()),
  onDestroy: vi.fn(),
}));
vi.mock('./comparisonsApi', () => ({
  listComparisons: vi.fn(),
  createComparison: vi.fn(),
  deleteComparison: vi.fn(),
  updateComparison: vi.fn(),
}));
vi.mock('../market/marketData', () => ({ fetchMarketOHLCV: vi.fn() }));
vi.mock('../market/streaming', async importOriginal => ({
  ...(await importOriginal<typeof import('../market/streaming')>()),
  subscribeMarketStream: vi.fn(),
}));

const record: ComparisonRecord = {
  id: 'comparison-1',
  main_symbol: 'BTCUSDT',
  comparison_symbol: 'ETHUSDT',
  provider: 'binance',
  color: '#ffffff',
  series_type: 'line',
  position: 0,
  created_at: '2026-01-01T00:00:00Z',
};
const candle = {
  symbol: 'ETHUSDT',
  timestamp: '2026-01-01T00:00:00Z',
  open: 1,
  high: 2,
  low: 1,
  close: 2,
  volume: 1,
};
const response = { symbol: 'ETHUSDT', candles: [candle] };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function setup() {
  const state = {
    userId: 'user-1' as string | null,
    period: '5d',
    interval: '1h',
  };
  const unsubscribe = vi.fn();
  const onError = vi.fn();
  vi.mocked(listComparisons).mockResolvedValue([record]);
  vi.mocked(fetchMarketOHLCV).mockResolvedValue(response);
  vi.mocked(subscribeMarketStream).mockReturnValue(unsubscribe);
  vi.mocked(deleteComparison).mockResolvedValue();
  const controller = new ComparisonController({
    userId: () => state.userId,
    mainSymbol: () => 'BTCUSDT',
    period: () => state.period,
    interval: () => state.interval,
    mainProvider: () => 'binance',
    onError,
  });
  return { controller, state, unsubscribe, onError };
}
afterEach(() => vi.resetAllMocks());

describe('comparison streaming lifecycles', () => {
  it('uses current constructor context even before host updateContext runs', async () => {
    const { controller } = setup();
    await controller.load('BTCUSDT');
    expect(fetchMarketOHLCV).toHaveBeenCalledExactlyOnceWith(
      'ETHUSDT',
      'binance',
      '5d',
      '1h',
    );
    expect(subscribeMarketStream).toHaveBeenCalledWith(
      expect.objectContaining({ interval: '1h' }),
    );
  });

  it('does not attach a stream after removing a comparison during history loading', async () => {
    const { controller } = setup();
    const data = deferred<MarketOHLCVResponse>();
    vi.mocked(fetchMarketOHLCV).mockReturnValueOnce(data.promise);
    const pending = controller.load('BTCUSDT');
    await vi.waitFor(() => expect(controller.comparisons).toHaveLength(1));
    await controller.remove(record.id);
    data.resolve(response);
    await pending;
    expect(controller.comparisons).toEqual([]);
    expect(subscribeMarketStream).not.toHaveBeenCalled();
  });

  it.each([null, 'user-2'])(
    'ignores in-flight candle responses after session changes to %s',
    async userId => {
      const { controller, state } = setup();
      const data = deferred<MarketOHLCVResponse>();
      vi.mocked(fetchMarketOHLCV).mockReturnValueOnce(data.promise);
      const pending = controller.load('BTCUSDT');
      await vi.waitFor(() => expect(controller.comparisons).toHaveLength(1));
      state.userId = userId;
      vi.mocked(listComparisons).mockResolvedValueOnce([]);
      await controller.load('BTCUSDT');
      data.resolve(response);
      await pending;
      expect(controller.comparisons).toEqual([]);
      expect(subscribeMarketStream).not.toHaveBeenCalled();
    },
  );

  it('ignores an old response after switching away and back to the same main symbol', async () => {
    const { controller } = setup();
    const old = deferred<ComparisonRecord[]>();
    vi.mocked(listComparisons).mockReturnValueOnce(old.promise);
    const pending = controller.load('BTCUSDT');
    vi.mocked(listComparisons)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    await controller.load('SOLUSDT');
    await controller.load('BTCUSDT');
    old.resolve([record]);
    await pending;
    expect(controller.comparisons).toEqual([]);
    expect(subscribeMarketStream).not.toHaveBeenCalled();
  });

  it('keeps newer candles and exactly one stream when history requests overlap', async () => {
    const { controller } = setup();
    const old = deferred<MarketOHLCVResponse>();
    vi.mocked(fetchMarketOHLCV).mockReturnValueOnce(old.promise);
    const pending = controller.load('BTCUSDT');
    await vi.waitFor(() => expect(fetchMarketOHLCV).toHaveBeenCalledTimes(1));
    const newer = { ...candle, close: 3 };
    vi.mocked(fetchMarketOHLCV).mockResolvedValueOnce({
      ...response,
      candles: [newer],
    });
    await controller.load('BTCUSDT');
    old.resolve(response);
    await pending;
    expect(controller.comparisons[0].candles).toEqual([newer]);
    expect(subscribeMarketStream).toHaveBeenCalledTimes(1);
  });

  it('does not stream old-interval history under a newly selected interval', async () => {
    const { controller, state } = setup();
    controller.updateContext(state.period, state.interval);
    const data = deferred<MarketOHLCVResponse>();
    vi.mocked(fetchMarketOHLCV).mockReturnValueOnce(data.promise);
    const pending = controller.load('BTCUSDT');
    await vi.waitFor(() => expect(fetchMarketOHLCV).toHaveBeenCalledTimes(1));
    state.interval = '1m';
    controller.updateContext(state.period, state.interval);
    data.resolve(response);
    await pending;
    expect(subscribeMarketStream).not.toHaveBeenCalled();
    expect(controller.comparisons[0].candles).toEqual([]);
  });

  it('does not attach a stream after component destruction', async () => {
    const { controller } = setup();
    const data = deferred<MarketOHLCVResponse>();
    vi.mocked(fetchMarketOHLCV).mockReturnValueOnce(data.promise);
    const pending = controller.load('BTCUSDT');
    await vi.waitFor(() => expect(fetchMarketOHLCV).toHaveBeenCalledTimes(1));
    const cleanup = vi.mocked(onDestroy).mock.calls;
    cleanup[cleanup.length - 1][0]();
    data.resolve(response);
    await pending;
    expect(subscribeMarketStream).not.toHaveBeenCalled();
    expect(controller.comparisons).toEqual([]);
  });

  it('disconnects previous streams immediately even when the new main-symbol list fails', async () => {
    const { controller, unsubscribe } = setup();
    await controller.load('BTCUSDT');
    vi.mocked(listComparisons).mockRejectedValueOnce(new Error('Failed'));
    await controller.load('SOLUSDT');
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(controller.comparisons).toEqual([]);
  });

  it('does not revive a removed comparison in another session after DELETE fails', async () => {
    const { controller, state, onError } = setup();
    await controller.load('BTCUSDT');
    const deletion = deferred<void>();
    vi.mocked(deleteComparison).mockReturnValueOnce(deletion.promise);
    const pending = controller.remove(record.id);
    state.userId = null;
    await controller.load('BTCUSDT');
    deletion.reject(new Error('Old failure'));
    await pending;
    expect(controller.comparisons).toEqual([]);
    expect(onError).not.toHaveBeenCalled();
  });

  it('restarts a removed stream when an in-context DELETE fails', async () => {
    const { controller } = setup();
    await controller.load('BTCUSDT');
    vi.mocked(deleteComparison).mockRejectedValueOnce(new Error('Failed'));
    await controller.remove(record.id);
    expect(controller.comparisons).toHaveLength(1);
    expect(subscribeMarketStream).toHaveBeenCalledTimes(2);
  });

  it('does not append an old create response after switching the main symbol', async () => {
    const { controller } = setup();
    vi.mocked(listComparisons).mockResolvedValueOnce([]);
    await controller.load('BTCUSDT');
    const creation = deferred<ComparisonRecord>();
    vi.mocked(createComparison).mockReturnValueOnce(creation.promise);
    const pending = controller.add('BTCUSDT', 'ETHUSDT', null, 'binance');
    vi.mocked(listComparisons).mockResolvedValueOnce([]);
    await controller.load('SOLUSDT');
    creation.resolve(record);
    await pending;
    expect(controller.comparisons).toEqual([]);
    expect(subscribeMarketStream).not.toHaveBeenCalled();
  });

  it('ignores removed-stream callbacks even if the same comparison is restored after a failed delete', async () => {
    const { controller } = setup();
    await controller.load('BTCUSDT');
    const oldHandlers = vi.mocked(subscribeMarketStream).mock.calls[0][0];
    vi.mocked(deleteComparison).mockRejectedValueOnce(new Error('Failed'));
    await controller.remove(record.id);
    oldHandlers.onCandle({ ...candle, close: 100 }, false);
    oldHandlers.onStatus?.('error');
    expect(controller.comparisons[0].candles).toEqual([candle]);
    expect(controller.comparisons[0].status).toBe('ready');
  });

  it('fills delayed comparison snapshot gaps without overwriting newer live values', async () => {
    const { controller } = setup();
    await controller.load('BTCUSDT');
    const handlers = vi.mocked(subscribeMarketStream).mock.calls[0][0];
    const live = { ...candle, timestamp: '2026-01-01T00:02:00Z', close: 3 };
    const gap = { ...candle, timestamp: '2026-01-01T00:01:00Z' };
    handlers.onCandle(live, false);
    handlers.onSnapshot?.([gap, { ...live, close: 2 }]);
    expect(controller.comparisons[0].candles).toEqual([candle, gap, live]);
  });

  it('replaces comparison candles with equivalent timestamp formats', async () => {
    const { controller } = setup();
    await controller.load('BTCUSDT');
    const update = {
      ...candle,
      timestamp: '2026-01-01T00:00:00+00:00',
      close: 3,
    };
    vi.mocked(subscribeMarketStream).mock.calls[0][0].onCandle(update, false);
    expect(controller.comparisons[0].candles).toEqual([update]);
  });

  it.each(['color', 'seriesType'] as const)(
    'does not roll back a newer %s edit when an older save fails',
    async field => {
      const { controller, onError } = setup();
      await controller.load('BTCUSDT');
      const old = deferred<ComparisonRecord>();
      vi.mocked(updateComparison)
        .mockReturnValueOnce(old.promise)
        .mockResolvedValueOnce(record);
      const pending =
        field === 'color'
          ? controller.setColor(record.id, '#111111')
          : controller.setSeriesType(record.id, 'candlestick');
      await vi.waitFor(() => expect(updateComparison).toHaveBeenCalledTimes(1));
      const newer =
        field === 'color'
          ? controller.setColor(record.id, '#222222')
          : controller.setSeriesType(record.id, 'line');
      old.reject(new Error('Old failure'));
      await Promise.all([pending, newer]);
      expect(controller.comparisons[0][field]).toBe(
        field === 'color' ? '#222222' : 'line',
      );
      expect(onError).not.toHaveBeenCalled();
    },
  );

  it('persists rapid edits in order even when the older request is slow', async () => {
    const { controller } = setup();
    await controller.load('BTCUSDT');
    const old = deferred<ComparisonRecord>();
    vi.mocked(updateComparison)
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce({ ...record, color: '#222222' });
    const first = controller.setColor(record.id, '#111111');
    await vi.waitFor(() => expect(updateComparison).toHaveBeenCalledTimes(1));
    const second = controller.setColor(record.id, '#222222');
    await Promise.resolve();
    expect(updateComparison).toHaveBeenCalledTimes(1);
    old.resolve({ ...record, color: '#111111' });
    await Promise.all([first, second]);
    expect(vi.mocked(updateComparison).mock.calls).toEqual([
      [record.id, { color: '#111111' }],
      [record.id, { color: '#222222' }],
    ]);
    expect(controller.comparisons[0].color).toBe('#222222');
  });

  it('rolls back failed rapid edits to the persisted value, not an unsaved optimistic edit', async () => {
    const { controller } = setup();
    await controller.load('BTCUSDT');
    const old = deferred<ComparisonRecord>();
    vi.mocked(updateComparison)
      .mockReturnValueOnce(old.promise)
      .mockRejectedValueOnce(new Error('Latest failure'));
    const first = controller.setColor(record.id, '#111111');
    await vi.waitFor(() => expect(updateComparison).toHaveBeenCalledTimes(1));
    const second = controller.setColor(record.id, '#222222');
    old.reject(new Error('Old failure'));
    await Promise.all([first, second]);
    expect(controller.comparisons[0].color).toBe(record.color);
  });

  it('rolls back a latest failure to the earlier successfully persisted edit', async () => {
    const { controller } = setup();
    await controller.load('BTCUSDT');
    const old = deferred<ComparisonRecord>();
    vi.mocked(updateComparison)
      .mockReturnValueOnce(old.promise)
      .mockRejectedValueOnce(new Error('Latest failure'));
    const first = controller.setColor(record.id, '#111111');
    await vi.waitFor(() => expect(updateComparison).toHaveBeenCalledTimes(1));
    const second = controller.setColor(record.id, '#222222');
    old.resolve({ ...record, color: '#111111' });
    await Promise.all([first, second]);
    expect(controller.comparisons[0].color).toBe('#111111');
  });

  it('does not send queued edits after the account changes', async () => {
    const { controller, state } = setup();
    await controller.load('BTCUSDT');
    const old = deferred<ComparisonRecord>();
    vi.mocked(updateComparison).mockReturnValueOnce(old.promise);
    const first = controller.setColor(record.id, '#111111');
    await vi.waitFor(() => expect(updateComparison).toHaveBeenCalledTimes(1));
    const second = controller.setColor(record.id, '#222222');
    state.userId = 'user-2';
    await controller.load('BTCUSDT');
    old.resolve({ ...record, color: '#111111' });
    await Promise.all([first, second]);
    expect(updateComparison).toHaveBeenCalledTimes(1);
    expect(controller.comparisons[0].color).toBe(record.color);
  });
});

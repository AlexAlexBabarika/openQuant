import { afterEach, describe, expect, it, vi } from 'vitest';
import { getStreamClient, type CandleHandlers } from '$lib/core/streamClient';
import { subscribeMarketStream } from './streaming';
import type { OHLCVCandle } from '$lib/core/types';

vi.mock('$lib/core/streamClient', () => ({ getStreamClient: vi.fn() }));
const sub = { provider: 'binance', symbol: 'BTCUSDT', interval: '1m' } as const;
function candle(timestamp: string, close = 2): OHLCVCandle {
  return {
    symbol: sub.symbol,
    timestamp,
    open: 1,
    high: 3,
    low: 1,
    close,
    volume: 1,
  };
}
function setup() {
  const subscribeCandles = vi.fn(() => vi.fn());
  vi.mocked(getStreamClient).mockReturnValue({
    subscribeCandles,
  } as unknown as ReturnType<typeof getStreamClient>);
  const onCandle = vi.fn();
  const onCandleClose = vi.fn();
  const onRejected = vi.fn();
  subscribeMarketStream({
    ...sub,
    historyEndIso: '2026-01-01T00:00:00Z',
    onCandle,
    onCandleClose,
    onRejected,
  });
  const handlers = subscribeCandles.mock.calls[0] as unknown as [
    unknown,
    CandleHandlers,
  ];
  return { handlers: handlers[1], onCandle, onCandleClose, onRejected };
}
afterEach(() => vi.clearAllMocks());

describe('market stream reconciliation', () => {
  it.each(['candle', 'snapshot'] as const)(
    'rejects malformed future %s data without starving valid follow-up candles',
    type => {
      const { handlers, onCandle, onCandleClose, onRejected } = setup();
      const bad = { ...candle('2099-01-01T00:00:00Z'), volume: -1 };
      if (type === 'candle')
        handlers.onCandle?.({ type, ...sub, candle: bad, is_final: true });
      else handlers.onSnapshot?.({ type, ...sub, candles: [bad] });
      expect(onCandle).not.toHaveBeenCalled();
      expect(onCandleClose).not.toHaveBeenCalled();
      expect(onRejected).toHaveBeenCalledExactlyOnceWith([bad]);
      const valid = candle('2026-01-01T00:01:00Z');
      handlers.onCandle?.({
        type: 'candle',
        ...sub,
        candle: valid,
        is_final: true,
      });
      expect(onCandle).toHaveBeenCalledExactlyOnceWith(valid, true);
      expect(onCandleClose).toHaveBeenCalledExactlyOnceWith(valid);
    },
  );

  it('rejects the whole malformed snapshot before cutoff filtering or gap-fill publication', () => {
    const subscribeCandles = vi.fn(() => vi.fn());
    vi.mocked(getStreamClient).mockReturnValue({
      subscribeCandles,
    } as unknown as ReturnType<typeof getStreamClient>);
    const onSnapshot = vi.fn();
    const onRejected = vi.fn();
    subscribeMarketStream({
      ...sub,
      onCandle: vi.fn(),
      onSnapshot,
      onRejected,
    });
    const handlers = (
      subscribeCandles.mock.calls[0] as unknown as [unknown, CandleHandlers]
    )[1];
    const bars = [candle('invalid'), candle('2099-01-01T00:00:00Z')];
    handlers.onSnapshot?.({ type: 'snapshot', ...sub, candles: bars });
    expect(onSnapshot).not.toHaveBeenCalled();
    expect(onRejected).toHaveBeenCalledExactlyOnceWith(bars);
    const valid = candle('2026-01-01T00:01:00Z');
    handlers.onSnapshot?.({ type: 'snapshot', ...sub, candles: [valid] });
    expect(onSnapshot).toHaveBeenCalledExactlyOnceWith([valid]);
  });

  it('reports a rejected live subscription as an error instead of staying connected', () => {
    const subscribeCandles = vi.fn(() => vi.fn());
    vi.mocked(getStreamClient).mockReturnValue({
      subscribeCandles,
    } as unknown as ReturnType<typeof getStreamClient>);
    const onStatus = vi.fn();
    subscribeMarketStream({ ...sub, onCandle: vi.fn(), onStatus });
    const handlers = subscribeCandles.mock.calls[0] as unknown as [
      unknown,
      CandleHandlers,
    ];
    handlers[1].onError?.({
      type: 'error',
      code: 'unsupported',
      message: 'Unsupported',
      ...sub,
    });
    expect(onStatus).toHaveBeenCalledExactlyOnceWith('error');
  });

  it('does not append older live candles or fire close hooks for stale bars', () => {
    const { handlers, onCandle, onCandleClose } = setup();
    const latest = candle('2026-01-01T00:02:00Z');
    handlers.onCandle?.({
      type: 'candle',
      ...sub,
      candle: latest,
      is_final: false,
    });
    handlers.onCandle?.({
      type: 'candle',
      ...sub,
      candle: candle('2026-01-01T00:01:00Z'),
      is_final: true,
    });
    expect(onCandle).toHaveBeenCalledExactlyOnceWith(latest, false);
    expect(onCandleClose).not.toHaveBeenCalled();
  });

  it('does not replay stale snapshot bars over a newer live candle', () => {
    const { handlers, onCandle, onCandleClose } = setup();
    const latest = candle('2026-01-01T00:02:00Z', 3);
    const next = candle('2026-01-01T00:03:00Z');
    handlers.onCandle?.({
      type: 'candle',
      ...sub,
      candle: latest,
      is_final: false,
    });
    handlers.onSnapshot?.({
      type: 'snapshot',
      ...sub,
      candles: [candle('2026-01-01T00:01:00Z'), candle(latest.timestamp), next],
    });
    expect(onCandle.mock.calls).toEqual([
      [latest, false],
      [next, true],
    ]);
    expect(onCandleClose).not.toHaveBeenCalled();
  });

  it('allows updates and finalization at the current timestamp, including the REST boundary', () => {
    const { handlers, onCandle, onCandleClose } = setup();
    const current = candle('2026-01-01T00:00:00Z');
    handlers.onCandle?.({
      type: 'candle',
      ...sub,
      candle: current,
      is_final: false,
    });
    const closed = { ...current, close: 3 };
    handlers.onCandle?.({
      type: 'candle',
      ...sub,
      candle: closed,
      is_final: true,
    });
    expect(onCandle.mock.calls).toEqual([
      [current, false],
      [closed, true],
    ]);
    expect(onCandleClose).toHaveBeenCalledExactlyOnceWith(closed);
  });

  it('drops live candles before the REST boundary', () => {
    const { handlers, onCandle } = setup();
    handlers.onCandle?.({
      type: 'candle',
      ...sub,
      candle: candle('2025-12-31T23:59:00Z'),
      is_final: true,
    });
    expect(onCandle).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StreamClient } from './streamClient';

class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static sockets: FakeSocket[] = [];
  readyState = FakeSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = FakeSocket.CLOSED;
  });
  constructor(public url: string) {
    FakeSocket.sockets.push(this);
  }
  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  closed() {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  }
  message(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
  sent() {
    return this.send.mock.calls.map(([data]) => JSON.parse(data));
  }
}

const sub = { provider: 'binance', symbol: 'BTCUSDT', interval: '1m' } as const;
const quote = { provider: 'binance', symbol: 'BTCUSDT' } as const;
const candle = {
  symbol: 'BTCUSDT',
  timestamp: '2026-01-01T00:00:00Z',
  open: 1,
  high: 2,
  low: 1,
  close: 2,
  volume: 1,
};

beforeEach(() => {
  FakeSocket.sockets = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('StreamClient subscription lifecycle', () => {
  it.each(['candle', 'snapshot'] as const)(
    'does not use a rejected %s timestamp for reconnect gap-fill',
    type => {
      const client = new StreamClient();
      const onCandle = vi.fn();
      const onSnapshot = vi.fn();
      client.subscribeCandles(
        sub,
        { onCandle, onSnapshot },
        { since: '2025-12-31T00:00:00Z' },
      );
      const old = FakeSocket.sockets[0];
      old.open();
      old.message({ type: 'candle', ...sub, candle, is_final: true });
      const bad = { ...candle, timestamp: '2099-01-01T00:00:00Z', volume: -1 };
      if (type === 'candle')
        old.message({ type, ...sub, candle: bad, is_final: true });
      else
        old.message({
          type,
          ...sub,
          candles: [bad, { ...candle, timestamp: '2100-01-01T00:00:00Z' }],
        });
      expect(type === 'candle' ? onCandle : onSnapshot).toHaveBeenCalled();
      old.closed();
      vi.advanceTimersByTime(500);
      const current = FakeSocket.sockets[1];
      current.open();
      expect(current.sent()).toEqual([
        { type: 'subscribe', ...sub, since: candle.timestamp },
      ]);
    },
  );

  it('routes a rejected subscription only to its own candle or quote handlers', () => {
    const client = new StreamClient();
    const onError = vi.fn();
    const otherError = vi.fn();
    const quoteError = vi.fn();
    client.subscribeCandles(sub, { onError });
    client.subscribeCandles(
      { ...sub, interval: '1h' },
      { onError: otherError },
    );
    client.subscribeQuote(quote, { onError: quoteError });
    const ws = FakeSocket.sockets[0];
    ws.open();
    const error = {
      type: 'error',
      code: 'subscribe_failed',
      message: 'Subscription failed',
    };
    ws.message({ ...error, ...sub });
    expect(onError).toHaveBeenCalledExactlyOnceWith({ ...error, ...sub });
    expect(otherError).not.toHaveBeenCalled();
    expect(quoteError).not.toHaveBeenCalled();
    ws.message({ ...error, ...quote, interval: null });
    expect(quoteError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('sends each active subscription once on initial open', () => {
    const client = new StreamClient();
    client.subscribeCandles(sub, {}, { since: candle.timestamp });
    client.subscribeQuote(quote, {});
    const ws = FakeSocket.sockets[0];
    ws.open();
    expect(ws.sent()).toEqual([
      { type: 'subscribe', ...sub, since: candle.timestamp },
      { type: 'subscribe_quote', ...quote },
    ]);
  });

  it('does not replay subscriptions removed or switched while connecting', () => {
    const client = new StreamClient();
    client.subscribeQuote(quote, {});
    const stop = client.subscribeCandles(sub, {});
    stop();
    client.subscribeCandles({ ...sub, interval: '1h' }, {});
    const ws = FakeSocket.sockets[0];
    ws.open();
    expect(ws.sent()).toHaveLength(2);
    expect(ws.sent()).toContainEqual({
      type: 'subscribe',
      ...sub,
      interval: '1h',
    });
    expect(ws.sent()).not.toContainEqual({ type: 'subscribe', ...sub });
    expect(ws.sent().some(msg => msg.type === 'unsubscribe')).toBe(false);
  });

  it('ignores old socket events after rapid unsubscribe and resubscribe', () => {
    const client = new StreamClient();
    const stop = client.subscribeCandles(sub, {});
    const old = FakeSocket.sockets[0];
    stop();
    const onCandle = vi.fn();
    const onConnectionChange = vi.fn();
    client.subscribeCandles(sub, { onCandle, onConnectionChange });
    const current = FakeSocket.sockets[1];
    current.open();
    onConnectionChange.mockClear();
    old.open();
    old.message({ type: 'candle', ...sub, candle, is_final: false });
    old.closed();
    expect(onCandle).not.toHaveBeenCalled();
    expect(onConnectionChange).not.toHaveBeenCalled();
    expect(old.send).not.toHaveBeenCalled();
    client.subscribeQuote(quote, {});
    expect(FakeSocket.sockets).toHaveLength(2);
    expect(current.sent()).toContainEqual({
      type: 'subscribe_quote',
      ...quote,
    });
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.sockets).toHaveLength(2);
  });

  it('cancels a scheduled reconnect when a subscription connects sooner', () => {
    const client = new StreamClient();
    client.subscribeCandles(sub, {});
    const old = FakeSocket.sockets[0];
    old.open();
    old.closed();
    client.subscribeQuote(quote, {});
    const current = FakeSocket.sockets[1];
    current.open();
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.sockets).toHaveLength(2);
    expect(current.close).not.toHaveBeenCalled();
  });

  it('resubscribes once using the newest candle timestamp after a reconnect', () => {
    const client = new StreamClient();
    client.subscribeCandles(sub, {}, { since: '2025-12-31T00:00:00Z' });
    const old = FakeSocket.sockets[0];
    old.open();
    old.message({ type: 'candle', ...sub, candle, is_final: true });
    old.closed();
    vi.advanceTimersByTime(500);
    const current = FakeSocket.sockets[1];
    current.open();
    expect(current.sent()).toEqual([
      { type: 'subscribe', ...sub, since: candle.timestamp },
    ]);
  });

  it('keeps a shared subscription until the last handler leaves', () => {
    const client = new StreamClient();
    const first = client.subscribeCandles(sub, { onCandle: vi.fn() });
    const second = client.subscribeCandles(sub, { onCandle: vi.fn() });
    const ws = FakeSocket.sockets[0];
    ws.open();
    first();
    expect(ws.sent().filter(msg => msg.type === 'unsubscribe')).toHaveLength(0);
    second();
    expect(ws.sent().filter(msg => msg.type === 'unsubscribe')).toHaveLength(1);
    expect(ws.close).toHaveBeenCalledTimes(1);
  });

  it.each(['candle', 'quote'] as const)(
    'makes %s unsubscribe idempotent after reusing a handler',
    kind => {
      const client = new StreamClient();
      const handlers = {};
      const subscribe = () =>
        kind === 'candle'
          ? client.subscribeCandles(sub, handlers)
          : client.subscribeQuote(quote, handlers);
      const stop = subscribe();
      FakeSocket.sockets[0].open();
      stop();
      subscribe();
      const current = FakeSocket.sockets[1];
      current.open();
      stop();
      expect(current.close).not.toHaveBeenCalled();
      expect(current.sent()).toHaveLength(1);
    },
  );

  it('notifies a new candle subscriber that a shared socket is already connected', () => {
    const client = new StreamClient();
    client.subscribeQuote(quote, {});
    FakeSocket.sockets[0].open();
    const onConnectionChange = vi.fn();
    client.subscribeCandles(sub, { onConnectionChange });
    expect(onConnectionChange).toHaveBeenCalledExactlyOnceWith('connected');
  });

  it('stops heartbeat and reconnect timers after the final unsubscribe', () => {
    const client = new StreamClient();
    const stop = client.subscribeCandles(sub, {});
    const ws = FakeSocket.sockets[0];
    ws.open();
    vi.advanceTimersByTime(client.pingIntervalMs);
    const sent = ws.sent();
    expect(sent[sent.length - 1]).toEqual({ type: 'ping' });
    stop();
    ws.closed();
    vi.advanceTimersByTime(100000);
    expect(FakeSocket.sockets).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

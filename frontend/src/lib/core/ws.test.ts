import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WSClient } from './ws';

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
}

const candle = {
  symbol: 'CSV',
  timestamp: '2026-01-01T00:00:00Z',
  open: 1,
  high: 2,
  low: 1,
  close: 2,
  volume: 1,
};
function setup() {
  const onCandle = vi.fn();
  const onStatus = vi.fn();
  const client = new WSClient({
    provider: 'csv',
    symbol: 'CSV',
    onCandle,
    onStatus,
  });
  return { client, onCandle, onStatus };
}

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

describe('WSClient lifecycle', () => {
  it('ignores all events from a socket disconnected before reopening', () => {
    const { client, onCandle, onStatus } = setup();
    client.connect();
    const old = FakeSocket.sockets[0];
    client.disconnect();
    client.connect();
    const current = FakeSocket.sockets[1];
    current.open();
    onStatus.mockClear();
    old.open();
    old.onmessage?.({ data: JSON.stringify(candle) });
    old.onerror?.();
    old.closed();
    expect(onCandle).not.toHaveBeenCalled();
    expect(onStatus).not.toHaveBeenCalled();
    client.disconnect();
    expect(current.close).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.sockets).toHaveLength(2);
  });

  it('does not open multiple sockets on repeated connect', () => {
    const { client } = setup();
    client.connect();
    client.connect();
    expect(FakeSocket.sockets).toHaveLength(1);
    FakeSocket.sockets[0].open();
    client.connect();
    expect(FakeSocket.sockets).toHaveLength(1);
  });

  it('cancels an old reconnect timer on manual reconnect', () => {
    const { client } = setup();
    client.connect();
    FakeSocket.sockets[0].closed();
    client.connect();
    FakeSocket.sockets[1].open();
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.sockets).toHaveLength(2);
  });

  it('does not deliver a late candle after intentional disconnect', () => {
    const { client, onCandle } = setup();
    client.connect();
    const old = FakeSocket.sockets[0];
    old.open();
    client.disconnect();
    old.onmessage?.({ data: JSON.stringify(candle) });
    old.closed();
    expect(onCandle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10000);
    expect(FakeSocket.sockets).toHaveLength(1);
  });
});

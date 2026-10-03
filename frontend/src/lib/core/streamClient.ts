import type { OHLCVCandle } from './types';
import { wsLiveUrl } from './config';
import type { MarketDataProviderValue } from '$lib/features/market/marketDataProviders';

export type StreamConnectionState = 'connecting' | 'connected' | 'closed';

export interface CandleSubscription {
  provider: MarketDataProviderValue;
  symbol: string;
  interval: string;
}

export interface SnapshotMsg {
  type: 'snapshot';
  provider: MarketDataProviderValue;
  symbol: string;
  interval: string;
  candles: OHLCVCandle[];
}

export interface CandleMsg {
  type: 'candle';
  provider: MarketDataProviderValue;
  symbol: string;
  interval: string;
  candle: OHLCVCandle;
  is_final: boolean;
}

export interface StatusMsg {
  type: 'status';
  provider: MarketDataProviderValue;
  symbol: string;
  interval: string;
  state: 'connected' | 'reconnecting' | 'closed';
}

export interface ErrorMsg {
  type: 'error';
  code: string;
  message: string;
}

export interface QuoteMsg {
  type: 'quote';
  provider: MarketDataProviderValue;
  symbol: string;
  price: number;
  ts: string;
}

type ServerMsg =
  | SnapshotMsg
  | CandleMsg
  | StatusMsg
  | ErrorMsg
  | QuoteMsg
  | { type: 'pong' };

export interface QuoteSubscription {
  provider: MarketDataProviderValue;
  symbol: string;
}

export interface QuoteHandlers {
  onQuote?: (msg: QuoteMsg) => void;
}

export interface CandleHandlers {
  onSnapshot?: (msg: SnapshotMsg) => void;
  onCandle?: (msg: CandleMsg) => void;
  onStatus?: (msg: StatusMsg) => void;
  onConnectionChange?: (state: StreamConnectionState) => void;
}

function candleKey(s: CandleSubscription): string {
  return `c:${s.provider}:${s.symbol}:${s.interval}`;
}

function quoteKey(s: QuoteSubscription): string {
  return `q:${s.provider}:${s.symbol}`;
}

interface CandleEntry {
  sub: CandleSubscription;
  handlers: Set<CandleHandlers>;
  /** Initial `since` from the first subscriber (REST history end). */
  initialSince?: string;
  /** Most recent candle timestamp seen on the wire — used for gap-fill on reconnect. */
  lastSeenTs?: string;
}

interface QuoteEntry {
  sub: QuoteSubscription;
  handlers: Set<QuoteHandlers>;
}

export class StreamClient {
  #ws: WebSocket | null = null;
  #candleSubs = new Map<string, CandleEntry>();
  #quoteSubs = new Map<string, QuoteEntry>();
  #reconnectAttempts = 0;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #pingTimer: ReturnType<typeof setInterval> | null = null;
  #silenceTimer: ReturnType<typeof setTimeout> | null = null;
  #intentionalClose = false;

  readonly reconnectDelayMs = 1000;
  readonly maxReconnectDelayMs = 30000;
  readonly maxReconnectAttempts = 10;
  readonly pingIntervalMs = 20000;
  /** If no message arrives within this window, treat the socket as dead. */
  readonly silenceTimeoutMs = 45000;

  subscribeCandles(
    sub: CandleSubscription,
    handlers: CandleHandlers,
    opts: { since?: string } = {},
  ): () => void {
    const key = candleKey(sub);
    let entry = this.#candleSubs.get(key);
    const isFirst = !entry;
    if (!entry) {
      entry = { sub, handlers: new Set(), initialSince: opts.since };
      this.#candleSubs.set(key, entry);
    }
    entry.handlers.add(handlers);

    const alreadyConnected = this.#ws?.readyState === WebSocket.OPEN;
    this.#ensureConnected();
    if (alreadyConnected) handlers.onConnectionChange?.('connected');
    if (isFirst) {
      this.#sendJson({
        type: 'subscribe',
        provider: sub.provider,
        symbol: sub.symbol,
        interval: sub.interval,
        since: entry.lastSeenTs ?? entry.initialSince,
      });
    }

    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;
      const e = this.#candleSubs.get(key);
      if (e !== entry) return;
      e.handlers.delete(handlers);
      if (e.handlers.size === 0) {
        this.#candleSubs.delete(key);
        this.#sendJson({
          type: 'unsubscribe',
          provider: sub.provider,
          symbol: sub.symbol,
          interval: sub.interval,
        });
        this.#maybeDisconnect();
      }
    };
  }

  subscribeQuote(sub: QuoteSubscription, handlers: QuoteHandlers): () => void {
    const key = quoteKey(sub);
    let entry = this.#quoteSubs.get(key);
    const isFirst = !entry;
    if (!entry) {
      entry = { sub, handlers: new Set() };
      this.#quoteSubs.set(key, entry);
    }
    entry.handlers.add(handlers);

    this.#ensureConnected();
    if (isFirst) {
      this.#sendJson({
        type: 'subscribe_quote',
        provider: sub.provider,
        symbol: sub.symbol,
      });
    }

    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;
      const e = this.#quoteSubs.get(key);
      if (e !== entry) return;
      e.handlers.delete(handlers);
      if (e.handlers.size === 0) {
        this.#quoteSubs.delete(key);
        this.#sendJson({
          type: 'unsubscribe_quote',
          provider: sub.provider,
          symbol: sub.symbol,
        });
        this.#maybeDisconnect();
      }
    };
  }

  #maybeDisconnect(): void {
    if (this.#candleSubs.size === 0 && this.#quoteSubs.size === 0) {
      this.#disconnect();
    }
  }

  #ensureConnected(): void {
    if (
      this.#ws &&
      (this.#ws.readyState === WebSocket.OPEN ||
        this.#ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    this.#connect();
  }

  #connect(): void {
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    const previous = this.#ws;
    this.#ws = null;
    previous?.close();
    this.#stopHeartbeat();
    this.#clearSilenceTimer();
    this.#intentionalClose = false;
    const ws = new WebSocket(wsLiveUrl());
    this.#ws = ws;
    this.#emitConnectionState('connecting');

    ws.onopen = () => {
      if (this.#ws !== ws) return;
      this.#reconnectAttempts = 0;
      this.#emitConnectionState('connected');
      if (this.#ws !== ws) return;
      this.#startHeartbeat();
      this.#armSilenceTimer();
      // The subscription maps are authoritative, including changes made before open.
      for (const entry of this.#candleSubs.values()) {
        this.#sendJson({
          type: 'subscribe',
          provider: entry.sub.provider,
          symbol: entry.sub.symbol,
          interval: entry.sub.interval,
          since: entry.lastSeenTs ?? entry.initialSince,
        });
      }
      for (const entry of this.#quoteSubs.values()) {
        this.#sendJson({
          type: 'subscribe_quote',
          provider: entry.sub.provider,
          symbol: entry.sub.symbol,
        });
      }
    };

    ws.onmessage = ev => {
      if (this.#ws !== ws) return;
      this.#armSilenceTimer();
      let msg: ServerMsg;
      try {
        msg = JSON.parse(ev.data as string) as ServerMsg;
      } catch {
        return;
      }
      this.#dispatch(msg);
    };

    ws.onclose = () => {
      if (this.#ws !== ws) return;
      this.#ws = null;
      this.#stopHeartbeat();
      this.#clearSilenceTimer();
      this.#emitConnectionState('closed');
      if (this.#intentionalClose) return;
      if (this.#candleSubs.size === 0 && this.#quoteSubs.size === 0) return;
      if (this.#reconnectAttempts >= this.maxReconnectAttempts) return;
      const delay = this.#nextReconnectDelay();
      this.#reconnectTimer = setTimeout(() => {
        this.#reconnectTimer = null;
        this.#reconnectAttempts += 1;
        this.#connect();
      }, delay);
    };

    ws.onerror = () => {
      // close handler will run; nothing extra to do.
    };
  }

  #disconnect(): void {
    this.#intentionalClose = true;
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    this.#stopHeartbeat();
    this.#clearSilenceTimer();
    if (this.#ws) {
      const ws = this.#ws;
      this.#ws = null;
      ws.close();
    }
    this.#reconnectAttempts = 0;
  }

  #startHeartbeat(): void {
    this.#stopHeartbeat();
    this.#pingTimer = setInterval(() => {
      if (this.#ws?.readyState === WebSocket.OPEN) {
        this.#ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, this.pingIntervalMs);
  }

  #stopHeartbeat(): void {
    if (this.#pingTimer) {
      clearInterval(this.#pingTimer);
      this.#pingTimer = null;
    }
  }

  #armSilenceTimer(): void {
    this.#clearSilenceTimer();
    this.#silenceTimer = setTimeout(() => {
      // No data within window — proxies/NAT may have silently dropped the
      // connection. Force-close so onclose triggers the reconnect path.
      this.#ws?.close();
    }, this.silenceTimeoutMs);
  }

  #clearSilenceTimer(): void {
    if (this.#silenceTimer) {
      clearTimeout(this.#silenceTimer);
      this.#silenceTimer = null;
    }
  }

  #nextReconnectDelay(): number {
    const exp = this.reconnectDelayMs * 2 ** this.#reconnectAttempts;
    const capped = Math.min(exp, this.maxReconnectDelayMs);
    return Math.random() * capped;
  }

  #sendJson(payload: unknown): void {
    if (this.#ws && this.#ws.readyState === WebSocket.OPEN) {
      this.#ws.send(JSON.stringify(payload));
    }
  }

  #emitConnectionState(state: StreamConnectionState): void {
    for (const entry of this.#candleSubs.values()) {
      for (const h of entry.handlers) h.onConnectionChange?.(state);
    }
  }

  #dispatch(msg: ServerMsg): void {
    if (
      msg.type === 'snapshot' ||
      msg.type === 'candle' ||
      msg.type === 'status'
    ) {
      const key = candleKey({
        provider: msg.provider as MarketDataProviderValue,
        symbol: msg.symbol,
        interval: msg.interval,
      });
      const entry = this.#candleSubs.get(key);
      if (!entry) return;
      if (msg.type === 'snapshot') {
        const last = msg.candles[msg.candles.length - 1];
        if (last) entry.lastSeenTs = maxIso(entry.lastSeenTs, last.timestamp);
      } else if (msg.type === 'candle') {
        entry.lastSeenTs = maxIso(entry.lastSeenTs, msg.candle.timestamp);
      }
      for (const h of entry.handlers) {
        if (msg.type === 'snapshot') h.onSnapshot?.(msg);
        else if (msg.type === 'candle') h.onCandle?.(msg);
        else h.onStatus?.(msg);
      }
      return;
    }
    if (msg.type === 'quote') {
      const key = quoteKey({ provider: msg.provider, symbol: msg.symbol });
      const entry = this.#quoteSubs.get(key);
      if (!entry) return;
      for (const h of entry.handlers) h.onQuote?.(msg);
    }
  }
}

function maxIso(a: string | undefined, b: string): string {
  if (!a) return b;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

let _instance: StreamClient | null = null;

export function getStreamClient(): StreamClient {
  if (!_instance) _instance = new StreamClient();
  return _instance;
}

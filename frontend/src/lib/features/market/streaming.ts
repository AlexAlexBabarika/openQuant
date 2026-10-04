import type { OHLCVCandle } from '$lib/core/types';
import { isUsableCandle } from '$lib/core/candles';
import {
  getStreamClient,
  type CandleSubscription,
  type StreamConnectionState,
} from '$lib/core/streamClient';

export type StreamStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

export interface SubscribeMarketStreamOptions extends CandleSubscription {
  /** Last historical candle timestamp from REST. Snapshot bars at or before this are dropped. */
  historyEndIso?: string;
  /** Fired for every candle that should be applied to the chart (snapshot tail + live updates). */
  onCandle: (c: OHLCVCandle, isFinal: boolean) => void;
  /** Reconcile gap-fill bars that may arrive after newer live candles. */
  onSnapshot?: (candles: OHLCVCandle[]) => void;
  onRejected?: (candles: OHLCVCandle[]) => void;
  /** Fired only when the live stream delivers a final (closed) candle. Snapshot replay does NOT trigger this. */
  onCandleClose?: (c: OHLCVCandle) => void;
  onStatus?: (s: StreamStatus) => void;
}

/**
 * Subscribe to live candles for one (provider, symbol, interval). Returns an unsubscribe fn.
 *
 * Snapshot reconciliation: candles whose timestamp is <= historyEndIso are dropped, so the
 * chart never sees a duplicate of a bar it already loaded over REST.
 */
export function subscribeMarketStream(
  opts: SubscribeMarketStreamOptions,
): () => void {
  const {
    historyEndIso,
    onCandle,
    onSnapshot,
    onRejected,
    onCandleClose,
    onStatus,
    ...sub
  } = opts;
  const cutoff = historyEndIso
    ? Date.parse(historyEndIso)
    : Number.NEGATIVE_INFINITY;
  let latest = cutoff;

  const mapState = (s: StreamConnectionState): StreamStatus =>
    s === 'connected'
      ? 'connected'
      : s === 'connecting'
        ? 'connecting'
        : 'disconnected';

  return getStreamClient().subscribeCandles(
    sub,
    {
      onSnapshot: msg => {
        if (!msg.candles.every(isUsableCandle)) {
          onRejected?.(msg.candles);
          return;
        }
        const candles = msg.candles.filter(
          c => Date.parse(c.timestamp) > cutoff,
        );
        if (onSnapshot) {
          onSnapshot(candles);
          for (const c of candles)
            latest = Math.max(latest, Date.parse(c.timestamp));
        } else {
          for (const c of candles) {
            const ts = Date.parse(c.timestamp);
            if (ts <= latest) continue;
            latest = ts;
            onCandle(c, true);
          }
        }
      },
      onCandle: msg => {
        if (!isUsableCandle(msg.candle)) {
          onRejected?.([msg.candle]);
          return;
        }
        const ts = Date.parse(msg.candle.timestamp);
        if (!Number.isFinite(ts) || ts < latest) return;
        latest = ts;
        onCandle(msg.candle, msg.is_final);
        if (msg.is_final) onCandleClose?.(msg.candle);
      },
      onConnectionChange: state => {
        onStatus?.(mapState(state));
      },
      onError: () => onStatus?.('error'),
      onStatus: msg => {
        if (msg.state === 'closed') onStatus?.('disconnected');
        else if (msg.state === 'reconnecting') onStatus?.('connecting');
        else onStatus?.('connected');
      },
    },
    { since: historyEndIso },
  );
}

/** Insert missing snapshot bars without overwriting more recent live values. */
export function mergeCandleSnapshot(
  existing: OHLCVCandle[],
  snapshot: OHLCVCandle[],
): OHLCVCandle[] {
  const byTime = new Map<number, OHLCVCandle>();
  for (const c of [...snapshot, ...existing]) {
    byTime.set(Date.parse(c.timestamp), c);
  }
  return [...byTime.entries()].sort(([a], [b]) => a - b).map(([, c]) => c);
}

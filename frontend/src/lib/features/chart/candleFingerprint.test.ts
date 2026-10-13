import { describe, it, expect } from 'vitest';
import {
  bundledDrawablesFingerprint,
  candleBatchSignature,
  publishOwnedCandles,
  ownedCandleHistory,
} from './candleFingerprint';
import type { OHLCVCandle } from '$lib/core/types';

const base = (overrides: Partial<OHLCVCandle> = {}): OHLCVCandle => ({
  symbol: 'X',
  timestamp: '2024-01-01T00:00:00.000Z',
  open: 1,
  high: 2,
  low: 0.5,
  close: 1.5,
  volume: 100,
  ...overrides,
});

describe('controller candle publication contract', () => {
  it('certifies only consecutive tail publications on the owned array and exact revision', () => {
    const candles = [base(), base()];
    expect(ownedCandleHistory(candles, 'revision:0')).toBeUndefined();
    publishOwnedCandles(candles, 0);
    const history = ownedCandleHistory(candles, 'revision:0');
    expect(history).toBeDefined();
    candles[1].volume = 99;
    publishOwnedCandles(candles, 1, true);
    expect(ownedCandleHistory(candles, 'revision:1')).toBe(history);
    expect(ownedCandleHistory(candles, 'revision:0')).toBeUndefined();
    expect(
      ownedCandleHistory(candles, candleBatchSignature(candles)),
    ).toBeUndefined();
    expect(ownedCandleHistory(candles.slice(), 'revision:1')).toBeUndefined();
    candles.push(base());
    publishOwnedCandles(candles, 2, true);
    expect(ownedCandleHistory(candles, 'revision:2')).toBe(history);
    candles[0].volume = 300;
    publishOwnedCandles(candles, 3);
    expect(ownedCandleHistory(candles, 'revision:3')).not.toBe(history);
    const edited = ownedCandleHistory(candles, 'revision:3');
    publishOwnedCandles(candles, 5, true);
    expect(ownedCandleHistory(candles, 'revision:5')).not.toBe(edited);
    const skipped = ownedCandleHistory(candles, 'revision:5');
    candles.pop();
    expect(ownedCandleHistory(candles, 'revision:5')).toBeUndefined();
    publishOwnedCandles(candles, 6, true);
    expect(ownedCandleHistory(candles, 'revision:6')).not.toBe(skipped);
  });
});

describe('candleBatchSignature', () => {
  it('fingerprints empty history without work', () => {
    expect(candleBatchSignature([])).toBe('0');
  });
  it('is stable for same data with different array identity', () => {
    const a = [base()];
    const b = [base()];
    expect(candleBatchSignature(a)).toBe(candleBatchSignature(b));
  });

  it.each(['open', 'high', 'low', 'close', 'volume'] as const)(
    'detects interior %s edits including values hidden by display rounding',
    field => {
      const candles = [base(), base(), base()];
      const before = candleBatchSignature(candles);
      candles[1][field] += 1e-10;
      expect(candleBatchSignature(candles)).not.toBe(before);
    },
  );

  it('includes timestamps, length and row ordering', () => {
    const a = base();
    const b = base({ timestamp: '2024-01-01T00:01:00Z' });
    const signature = candleBatchSignature([a, b]);
    expect(candleBatchSignature([b, a])).not.toBe(signature);
    expect(candleBatchSignature([a, b, a])).not.toBe(signature);
    expect(
      candleBatchSignature([a, { ...b, timestamp: a.timestamp }]),
    ).not.toBe(signature);
  });

  it('normalizes negative zero and remains deterministic for non-finite data', () => {
    expect(candleBatchSignature([base({ low: -0 })])).toBe(
      candleBatchSignature([base({ low: 0 })]),
    );
    expect(candleBatchSignature([base({ volume: NaN })])).toBe(
      candleBatchSignature([base({ volume: NaN })]),
    );
    expect(candleBatchSignature([base({ volume: Infinity })])).not.toBe(
      candleBatchSignature([base({ volume: -Infinity })]),
    );
  });
});

describe('bundledDrawablesFingerprint', () => {
  const row = (id: string, close: number) => ({
    id,
    type: 'ruler',
    geometry: { startTime: 0, endTime: 1, startPrice: 1, endPrice: close },
    params: {},
    style: { upColor: 'x', downColor: 'y', showStats: true },
  });

  it('is stable for same logical list with different array identity', () => {
    const a = [row('a', 2)];
    const b = [row('a', 2)];
    expect(bundledDrawablesFingerprint(a)).toBe(bundledDrawablesFingerprint(b));
  });

  it('changes when a drawable field changes', () => {
    const x = bundledDrawablesFingerprint([row('a', 2)]);
    const y = bundledDrawablesFingerprint([row('a', 2.01)]);
    expect(x).not.toBe(y);
  });
});

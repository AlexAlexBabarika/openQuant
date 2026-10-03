import { describe, it, expect } from 'vitest';
import {
  bundledDrawablesFingerprint,
  candleBatchSignature,
  fnv1a32Hex,
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

describe('candleBatchSignature', () => {
  it('preserves the full-series digest without joined-history allocation', () => {
    const candles = [
      base(),
      base({ close: 2, timestamp: '2024-01-01T00:01:00Z' }),
    ];
    const legacy = candles
      .map(
        c =>
          `${c.timestamp}\x1f${c.open}\x1f${c.high}\x1f${c.low}\x1f${c.close}\x1f${c.volume}`,
      )
      .join('\x1e');
    expect(candleBatchSignature(candles)).toBe(
      `${candles.length}:${fnv1a32Hex(legacy)}`,
    );
  });
  it('is stable for same data with different array identity', () => {
    const a = [base()];
    const b = [base()];
    expect(candleBatchSignature(a)).toBe(candleBatchSignature(b));
  });

  it('changes when any bar field changes', () => {
    const a = candleBatchSignature([base()]);
    const b = candleBatchSignature([base({ close: 1.51 })]);
    expect(a).not.toBe(b);
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

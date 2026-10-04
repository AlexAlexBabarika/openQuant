import { describe, it, expect } from 'vitest';
import { inspectCandles, utcTime } from './dataInspection';
import type { OHLCVCandle } from '$lib/core/types';
const candle = (timestamp: string): OHLCVCandle => ({
  symbol: 'SPY',
  timestamp,
  open: 10,
  close: 11,
  high: 12,
  low: 9,
  volume: 100,
});
describe('data inspection', () => {
  it('measures actual coverage without changing input order', () => {
    const bars = [
      candle('2026-01-02T00:00:00Z'),
      candle('2026-01-01T00:00:00Z'),
      candle('2026-01-02T00:00:00Z'),
    ];
    expect(inspectCandles(bars, '1d')).toMatchObject({
      count: 3,
      duplicates: 1,
      outOfOrder: 1,
      first: Date.parse(bars[1].timestamp),
      last: Date.parse(bars[0].timestamp),
    });
    expect(bars[0].timestamp).toBe('2026-01-02T00:00:00Z');
  });
  it('reports long intervals without claiming missing market bars', () => {
    const bars = [
      candle('2026-01-02T00:00:00Z'),
      candle('2026-01-05T00:00:00Z'),
    ];
    expect(inspectCandles(bars, '1d').longIntervals).toBe(1);
    expect(inspectCandles(bars, '1mo')).toMatchObject({
      fixedInterval: false,
      longIntervals: 0,
    });
  });
  it('finds nonfinite OHLCV, inverted ranges, negative volume, and invalid dates', () => {
    const bars = [
      { ...candle('bad'), high: 5 },
      { ...candle('2026-01-01'), volume: -1 },
      { ...candle('2026-01-02'), close: NaN },
    ];
    expect(inspectCandles(bars, '1d')).toMatchObject({
      invalidTimestamps: 1,
      invalidBars: 3,
    });
  });
  it('handles empty data and UTC receipt formatting', () => {
    expect(inspectCandles([], '1d')).toMatchObject({
      count: 0,
      first: null,
      last: null,
    });
    expect(utcTime(null)).toBe('Not available');
    expect(utcTime(0)).toContain('UTC');
  });
});

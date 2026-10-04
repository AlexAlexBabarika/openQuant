import { describe, it, expect, vi } from 'vitest';
import {
  computeStats,
  formatPriceDelta,
  formatPct,
  formatVolume,
  withRulerCandleIndex,
} from './compute';
import type { OHLCVCandle } from '$lib/core/types';
import { candleBatchSignature } from '$lib/features/chart/candleFingerprint';

function candle(tsIso: string, volume: number): OHLCVCandle {
  return {
    timestamp: tsIso,
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume,
  } as OHLCVCandle;
}

describe('ruler computeStats', () => {
  it('does not build an index for compute passes without a ruler', () => {
    const candles = [candle('2024-01-01T00:00:00Z', 10)];
    const parse = vi.spyOn(Date, 'parse');
    try {
      withRulerCandleIndex(
        candles,
        candleBatchSignature(candles),
        () => undefined,
      );
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
  });

  it('shares parsed timestamps across geometry edits and invalidates live content', () => {
    const candles = [
      candle('2024-01-01T00:00:00Z', 10),
      candle('2024-01-01T01:00:00Z', 20),
      candle('2024-01-01T02:00:00Z', 30),
    ];
    const t0 = Date.parse(candles[0].timestamp) / 1000;
    const geo = {
      startTime: t0,
      endTime: t0 + 7200,
      startPrice: 100,
      endPrice: 110,
    };
    const parse = vi.spyOn(Date, 'parse');
    try {
      const run = () =>
        withRulerCandleIndex(candles, candleBatchSignature(candles), () =>
          computeStats(geo, candles),
        );
      expect(run().volumeSum).toBe(60);
      expect(parse).toHaveBeenCalledTimes(3);
      geo.endTime = t0 + 3600;
      expect(run().volumeSum).toBe(30);
      expect(parse).toHaveBeenCalledTimes(3);
      candles[1].volume = 70;
      expect(run().volumeSum).toBe(80);
      expect(parse).toHaveBeenCalledTimes(6);
      candles.push(candle('2024-01-01T03:00:00Z', 100));
      geo.endTime = t0 + 10800;
      expect(run()).toMatchObject({ barCount: 4, volumeSum: 210 });
      expect(parse).toHaveBeenCalledTimes(10);
    } finally {
      parse.mockRestore();
    }
  });

  it('matches uncached inclusive scans for reversed ranges, irregular/unsorted/duplicate/invalid timestamps', () => {
    const candles = [
      candle('2024-01-01T03:00:00Z', 40),
      candle('invalid', 999),
      candle('2024-01-01T00:00:00Z', 10),
      candle('2024-01-01T01:00:00Z', 20),
      candle('2024-01-01T01:00:00Z', 30),
    ];
    const t0 = Date.parse('2024-01-01T00:00:00Z') / 1000;
    for (const [start, end] of [
      [0, 3600],
      [3600, 0],
      [3600, 3600],
      [1, 3599],
      [-1, 10801],
      [12000, 13000],
    ]) {
      const geo = {
        startTime: t0 + start,
        endTime: t0 + end,
        startPrice: 0,
        endPrice: 1,
      };
      const expected = computeStats(geo, candles);
      const indexed = withRulerCandleIndex(
        candles,
        candleBatchSignature(candles),
        () => computeStats(geo, candles),
      );
      expect(indexed).toEqual(expected);
    }
  });

  it('does not reuse a prepared index for unannounced direct mutations outside a compute pass', () => {
    const candles = [candle('2024-01-01T00:00:00Z', 10)];
    const geo = { startTime: 0, endTime: Infinity, startPrice: 1, endPrice: 2 };
    withRulerCandleIndex(candles, candleBatchSignature(candles), () =>
      computeStats(geo, candles),
    );
    candles[0].volume = 90;
    expect(computeStats(geo, candles).volumeSum).toBe(90);
  });

  it('sums volume for candles inside the range (inclusive)', () => {
    const t0 = new Date('2024-01-01T00:00:00Z').getTime() / 1000;
    const candles = [
      candle('2024-01-01T00:00:00Z', 10),
      candle('2024-01-01T01:00:00Z', 20),
      candle('2024-01-01T02:00:00Z', 30),
    ];
    const stats = computeStats(
      { startTime: t0, endTime: t0 + 3600, startPrice: 100, endPrice: 110 },
      candles,
    );
    expect(stats.barCount).toBe(2);
    expect(stats.volumeSum).toBe(30);
    expect(stats.priceDelta).toBe(10);
    expect(stats.pctDelta).toBeCloseTo(10);
    expect(stats.isUp).toBe(true);
  });

  it('marks negative price movement as not up', () => {
    const s = computeStats(
      { startTime: 0, endTime: 1, startPrice: 100, endPrice: 90 },
      [],
    );
    expect(s.isUp).toBe(false);
  });

  it('formats price delta with sign', () => {
    expect(formatPriceDelta(1.5)).toBe('+1.50');
    expect(formatPriceDelta(-1.5)).toBe('−1.50');
  });

  it.each([
    [0, '+0.00'],
    [1234.56, '+1234.56'],
    [-1234.56, '−1234.56'],
    [0.00123456, '+0.00123456'],
    [-0.00000123, '−0.00000123'],
    [3.419354838709673e-8, '+3.41935e-8'],
    [-2.671370967741943e-8, '−2.67137e-8'],
    [NaN, '—'],
    [Infinity, '—'],
    [-Infinity, '—'],
  ])('preserves signed absolute price distance %s as %s', (value, expected) => {
    expect(formatPriceDelta(value)).toBe(expected);
  });

  it('formats pct with sign', () => {
    expect(formatPct(2.5)).toBe('+2.50%');
    expect(formatPct(-2.5)).toBe('−2.50%');
  });

  it('formats volume with magnitude suffixes', () => {
    expect(formatVolume(1500)).toBe('1.50K');
    expect(formatVolume(1_500_000)).toBe('1.50M');
    expect(formatVolume(2_000_000_000)).toBe('2.00B');
    expect(formatVolume(999)).toBe('999');
  });
});

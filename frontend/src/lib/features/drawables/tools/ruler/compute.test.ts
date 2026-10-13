import { describe, it, expect, vi } from 'vitest';
import {
  computeStats,
  formatPriceDelta,
  formatPct,
  formatVolume,
  withRulerCandleIndex,
} from './compute';
import type { OHLCVCandle } from '$lib/core/types';
import {
  candleBatchSignature,
  publishOwnedCandles,
} from '$lib/features/chart/candleFingerprint';

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
  it('parses only the changed tail for 100 Rulers on controller-certified 50k histories', () => {
    const candles = Array.from({ length: 50_000 }, (_, i) =>
      candle(new Date(i * 60_000).toISOString(), 100),
    );
    const ranges = Array.from({ length: 100 }, (_, i) => ({
      startTime: i * 60,
      endTime: (49_999 - i) * 60,
      startPrice: 1,
      endPrice: 2,
    }));
    const parse = vi.spyOn(Date, 'parse');
    try {
      publishOwnedCandles(candles, 0);
      const run = (revision: number) =>
        withRulerCandleIndex(candles, `revision:${revision}`, () =>
          ranges.map(geo => computeStats(geo, candles)),
        );
      run(0);
      expect(parse).toHaveBeenCalledTimes(50_000);
      parse.mockClear();
      for (let revision = 1; revision <= 100; revision++) {
        candles[49_999].volume = 100 + revision;
        publishOwnedCandles(candles, revision, true);
        expect(run(revision)[0].volumeSum).toBe(5_000_000 + revision);
      }
      expect(parse).toHaveBeenCalledTimes(100);
      parse.mockClear();
      run(100);
      expect(parse).not.toHaveBeenCalled();
      ranges[0].endTime = 49_998 * 60;
      expect(run(100)[0].volumeSum).toBe(4_999_900);
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
  });

  it('includes skipped tail publications, appended bars and moved tail timestamps', () => {
    const candles = Array.from({ length: 3 }, (_, i) =>
      candle(new Date(i * 60_000).toISOString(), i + 1),
    );
    const geo = { startTime: 60, endTime: 300, startPrice: 1, endPrice: 2 };
    const run = (revision: number) =>
      withRulerCandleIndex(candles, `revision:${revision}`, () =>
        computeStats(geo, candles),
      );
    publishOwnedCandles(candles, 0);
    run(0);
    candles[2].volume = 30;
    publishOwnedCandles(candles, 1, true);
    candles.push(candle(new Date(180_000).toISOString(), 4));
    publishOwnedCandles(candles, 2, true);
    candles[3].volume = 40;
    publishOwnedCandles(candles, 3, true);
    candles.push(candle(new Date(240_000).toISOString(), 5));
    publishOwnedCandles(candles, 4, true);
    expect(run(4)).toEqual(computeStats(geo, candles));
    candles[4].timestamp = new Date(300_000).toISOString();
    publishOwnedCandles(candles, 5, true);
    expect(run(5)).toEqual(computeStats(geo, candles));
  });

  it('rebuilds for history edits, unknown revisions, replacement arrays and shape regressions', () => {
    let candles = Array.from({ length: 4 }, (_, i) =>
      candle(new Date(i * 60_000).toISOString(), i + 1),
    );
    const geo = { startTime: 0, endTime: 1000, startPrice: 1, endPrice: 2 };
    const run = (revision: number) =>
      withRulerCandleIndex(candles, `revision:${revision}`, () =>
        computeStats(geo, candles),
      );
    publishOwnedCandles(candles, 0);
    run(0);
    candles[1].volume = 70;
    publishOwnedCandles(candles, 1);
    expect(run(1)).toEqual(computeStats(geo, candles));
    candles[0].volume = 99;
    expect(run(2)).toEqual(computeStats(geo, candles));
    candles[3].volume = 100;
    publishOwnedCandles(candles, 3, true);
    expect(run(3)).toEqual(computeStats(geo, candles));
    candles = candles.map(c => ({ ...c }));
    candles[2].volume = 88;
    publishOwnedCandles(candles, 4, true);
    expect(run(4)).toEqual(computeStats(geo, candles));
    candles.splice(1, 2);
    publishOwnedCandles(candles, 5, true);
    expect(run(5)).toEqual(computeStats(geo, candles));
  });

  it.each(['duplicate', 'out-of-order', 'invalid', 'fractional', 'unsafe'])(
    'retains direct-scan parity for %s tail and subsequent publications',
    kind => {
      const candles = Array.from({ length: 4 }, (_, i) =>
        candle(new Date(i * 60_000).toISOString(), i + 1),
      );
      const ranges = [
        [0, Infinity],
        [60, 180],
        [180, 60],
        [180, 180],
        [1, 59],
      ].map(([startTime, endTime]) => ({
        startTime,
        endTime,
        startPrice: 1,
        endPrice: 2,
      }));
      const run = (revision: number) =>
        withRulerCandleIndex(candles, `revision:${revision}`, () =>
          ranges.map(geo => computeStats(geo, candles)),
        );
      publishOwnedCandles(candles, 0);
      run(0);
      if (kind === 'duplicate') candles[3].timestamp = candles[1].timestamp;
      if (kind === 'out-of-order')
        candles[3].timestamp = new Date(30_000).toISOString();
      if (kind === 'invalid') candles[3].timestamp = 'invalid';
      if (kind === 'fractional') candles[3].volume = 0.1;
      if (kind === 'unsafe') candles[3].volume = 1e20;
      publishOwnedCandles(candles, 1, true);
      expect(run(1)).toEqual(ranges.map(geo => computeStats(geo, candles)));
      candles.push(candle(new Date(240_000).toISOString(), 0.2));
      publishOwnedCandles(candles, 2, true);
      expect(run(2)).toEqual(ranges.map(geo => computeStats(geo, candles)));
    },
  );

  it('preserves source-order floating point sums for unsorted fractional and unsafe volumes', () => {
    const candles = [
      candle(new Date(180_000).toISOString(), 1e20),
      candle(new Date(60_000).toISOString(), -1e20),
      candle(new Date(120_000).toISOString(), 0.1),
    ];
    const geo = { startTime: 0, endTime: 300, startPrice: 1, endPrice: 2 };
    expect(
      withRulerCandleIndex(candles, 'untrusted', () =>
        computeStats(geo, candles),
      ),
    ).toEqual(computeStats(geo, candles));
    expect(computeStats(geo, candles).volumeSum).toBe(0.1);
  });

  it('invalidates a shared prefix for every same-array candle revision', () => {
    const candles = [
      candle('2024-01-01T00:00:00Z', 10),
      candle('2024-01-01T01:00:00Z', 20),
      candle('2024-01-01T03:00:00Z', 30),
    ];
    const t0 = Date.parse(candles[0].timestamp) / 1000;
    const geo = {
      startTime: t0,
      endTime: t0 + 3600,
      startPrice: 1,
      endPrice: 2,
    };
    const run = (revision: number) =>
      withRulerCandleIndex(candles, `revision:${revision}`, () =>
        computeStats(geo, candles),
      );
    expect(run(0)).toMatchObject({ barCount: 2, volumeSum: 30 });
    candles[1].volume = 70;
    expect(run(1)).toMatchObject({ barCount: 2, volumeSum: 80 });
    candles[2].timestamp = candles[0].timestamp;
    expect(run(2)).toMatchObject({ barCount: 3, volumeSum: 110 });
    candles.splice(1, 1);
    expect(run(3)).toMatchObject({ barCount: 2, volumeSum: 40 });
    candles[0].timestamp = 'invalid';
    expect(run(4)).toMatchObject({ barCount: 1, volumeSum: 30 });
  });

  it.each([
    [1e20, 1, 2],
    [Number.MAX_SAFE_INTEGER, 1, 2],
    [0.1, 0.2, 0.3],
    [1e20, -1e20, 2],
    [NaN, 1, 2],
    [Infinity, 1, 2],
    [-Infinity, 1, 2],
  ])(
    'retains direct-scan numeric behavior for unsafe prefix volumes %j',
    (...volumes) => {
      const candles = volumes.map((volume, i) =>
        candle(`2024-01-01T0${i}:00:00Z`, volume),
      );
      const t0 = Date.parse(candles[0].timestamp) / 1000;
      for (const [start, end] of [
        [0, 7200],
        [3600, 7200],
        [3600, 3600],
        [1, 3599],
      ]) {
        const geo = {
          startTime: t0 + start,
          endTime: t0 + end,
          startPrice: 1,
          endPrice: 2,
        };
        expect(
          withRulerCandleIndex(candles, 'fixed', () =>
            computeStats(geo, candles),
          ),
        ).toEqual(computeStats(geo, candles));
      }
    },
  );

  it('matches direct scans for many overlapping sparse, reversed, and duplicate ranges', () => {
    const candles = Array.from({ length: 1000 }, (_, i) =>
      candle(new Date((1000 + ((i * 97) % 300)) * 60000).toISOString(), i),
    );
    const parse = vi.spyOn(Date, 'parse');
    try {
      const signature = candleBatchSignature(candles);
      const geometries = Array.from({ length: 100 }, (_, i) => ({
        startTime: (999 + i) * 60,
        endTime: (1299 - i) * 60,
        startPrice: 5,
        endPrice: 10,
      }));
      const expected = geometries.map(geo => computeStats(geo, candles));
      parse.mockClear();
      expect(
        withRulerCandleIndex(candles, signature, () =>
          geometries.map(geo => computeStats(geo, candles)),
        ),
      ).toEqual(expected);
      expect(parse).toHaveBeenCalledTimes(candles.length);
    } finally {
      parse.mockRestore();
    }
  });

  it('restores nested shared contexts and handles empty or nonfinite endpoints', () => {
    const candles = [candle('2024-01-01T00:00:00Z', 10)];
    const other = [candle('2024-01-01T00:00:00Z', 90)];
    const geo = { startTime: 0, endTime: Infinity, startPrice: 1, endPrice: 2 };
    withRulerCandleIndex(candles, '0', () => {
      expect(computeStats(geo, candles).volumeSum).toBe(10);
      expect(
        withRulerCandleIndex(other, '0', () => computeStats(geo, other))
          .volumeSum,
      ).toBe(90);
      expect(computeStats(geo, candles).volumeSum).toBe(10);
      expect(computeStats({ ...geo, startTime: NaN }, candles)).toMatchObject({
        barCount: 0,
        volumeSum: 0,
      });
    });
    expect(
      withRulerCandleIndex([], 'empty', () => computeStats(geo, [])),
    ).toMatchObject({ barCount: 0, volumeSum: 0 });
  });

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

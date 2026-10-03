import { describe, expect, it, vi } from 'vitest';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import type { OHLCVCandle } from '$lib/core/types';
import {
  buildCoordMap,
  candleUnixSeconds,
  chartTimeAtCoordinate,
  coordinateInvalidator,
} from './coordMap';

function candles(times: number[]): OHLCVCandle[] {
  return times.map(t => ({
    symbol: 'X',
    timestamp: new Date(t * 1000).toISOString(),
    open: 1,
    high: 2,
    low: 1,
    close: 2,
    volume: 10,
  }));
}

function chart(
  times: number[],
  indices = times.map((_, i) => i),
  spacing = 40,
  offset = 100,
): IChartApi {
  return {
    paneSize: () => ({ width: 800, height: 400 }),
    timeScale: () => ({
      timeToIndex: (t: number) =>
        times.includes(t) ? indices[times.indexOf(t)] : null,
      timeToCoordinate: (t: number) =>
        times.includes(t) ? offset + indices[times.indexOf(t)] * spacing : null,
      logicalToCoordinate: (l: number) => offset + l * spacing,
      coordinateToLogical: (x: number) => (x - offset) / spacing,
      coordinateToTime: (x: number) =>
        times[Math.round((x - offset) / spacing)] ?? null,
    }),
  } as unknown as IChartApi;
}
const series = {
  priceToCoordinate: (p: number) => 400 - p,
  coordinateToPrice: (y: number) => 400 - y,
} as ISeriesApi<'Line'>;

describe('logical annotation coordinates', () => {
  it.each([8, 40, 100])(
    'round-trips fractional times inside and outside unequal history gaps at spacing %s',
    spacing => {
      const times = [1000, 1100, 1700, 1900];
      const c = chart(times, [0, 1, 4, 5], spacing);
      const map = buildCoordMap(c, series, 1, candles(times));
      for (const x of [-150, 99, 100, 111.5, 130, 169.2, 250, 400, 650]) {
        const time = map.xToTime(x);
        expect(time).not.toBeNull();
        expect(Math.abs(map.timeToX(time!)! - x)).toBeLessThanOrEqual(1);
        expect(chartTimeAtCoordinate(c, x, candles(times))).toBe(time);
      }
      expect(map.timeToX(1050)).toBeCloseTo(100 + spacing / 2);
    },
  );

  it('keeps a synthetic future anchor mappable after append and prepend', () => {
    for (const times of [
      [1000, 1100],
      [1000, 1100, 1200],
      [900, 1000, 1100, 1200],
    ]) {
      const map = buildCoordMap(chart(times), series, 1, candles(times));
      const x = map.timeToX(1150);
      expect(x).not.toBeNull();
      expect(map.xToTime(x!)).toBeCloseTo(1150);
    }
  });

  it('does not snap an interior pixel to a bar timestamp', () => {
    expect(
      chartTimeAtCoordinate(chart([1000, 1100]), 130, candles([1000, 1100])),
    ).toBe(1075);
  });

  it.each([{ times: [1000] }, { times: [1000, 1100] }])(
    'round-trips short histories %j in both empty margins',
    ({ times }) => {
      const map = buildCoordMap(chart(times), series, 1, candles(times));
      for (const x of [-70, 99, 100, 111.5, 160, 450]) {
        const t = map.xToTime(x);
        expect(t).not.toBeNull();
        expect(Math.abs(map.timeToX(t!)! - x)).toBeLessThanOrEqual(1);
      }
    },
  );

  it('handles missing chart data and preserves price conversions', () => {
    const map = buildCoordMap(chart([]), series, 7);
    expect(map.timeToX(1000)).toBeNull();
    expect(map.xToTime(100)).toBeNull();
    expect(map.priceToY(25)).toBe(375);
    expect(map.yToPrice(375)).toBe(25);
    expect(map.version).toBe(7);
    expect(candleUnixSeconds(candles([1700000123])[0])).toBe(1700000123);
  });
});

describe('price coordinate invalidation lifecycle', () => {
  it('updates throughout scale gestures, settles after release, and leaves no permanent timer', () => {
    const frames = new Map<number, FrameRequestCallback>();
    let id = 0;
    const invalidate = vi.fn();
    const invalidator = coordinateInvalidator(
      invalidate,
      cb => {
        frames.set(++id, cb);
        return id;
      },
      n => {
        frames.delete(n);
      },
    );
    const frame = () => {
      const [n, cb] = [...frames][0];
      frames.delete(n);
      cb(0);
    };
    expect(frames.size).toBe(0);
    invalidator.stop();
    expect(frames.size).toBe(0);
    invalidator.start();
    for (let n = 0; n < 4; n++) frame();
    expect(invalidate).toHaveBeenCalledTimes(4);
    invalidator.stop();
    frame();
    frame();
    expect(invalidate).toHaveBeenCalledTimes(6);
    expect(frames.size).toBe(0);
    invalidator.settle();
    invalidator.settle();
    expect(frames.size).toBe(1);
    frame();
    frame();
    expect(frames.size).toBe(0);
    invalidator.start();
    invalidator.destroy();
    expect(frames.size).toBe(0);
  });
});

import type { OHLCVCandle } from '$lib/core/types';
import type { IChartApi, ISeriesApi, Logical, Time } from 'lightweight-charts';
import type { CoordMap } from './types';

export function candleUnixSeconds(c: OHLCVCandle): number {
  return Math.floor(new Date(c.timestamp).getTime() / 1000);
}

function bracket(
  length: number,
  value: number,
  at: (i: number) => number,
): number {
  let lo = 0;
  let hi = length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (at(mid) <= value) lo = mid;
    else hi = mid - 1;
  }
  return Math.min(lo, length - 2);
}

function interpolate(
  value: number,
  a: number,
  b: number,
  c: number,
  d: number,
): number {
  return c + ((value - a) / (b - a)) * (d - c);
}

/** Interpolate between actual candle logical positions, including unequal boundary gaps. */
function timeMapping(chart: IChartApi, candles: readonly OHLCVCandle[]) {
  const ts = chart.timeScale();
  const time = (i: number) => candleUnixSeconds(candles[i]);
  const logical = (i: number) => ts.timeToIndex(time(i) as Time) as number;
  return {
    timeToX(t: number): number | null {
      if (candles.length === 0) return ts.timeToCoordinate(t as Time);
      if (candles.length === 1) {
        const anchor = logical(0);
        if (anchor == null) return null;
        // Match placement's one-second minimum when no actual bar gap is available.
        return ts.logicalToCoordinate((anchor + t - time(0)) as Logical);
      }
      const i = bracket(candles.length, t, time);
      const a = logical(i);
      const b = logical(i + 1);
      if (a == null || b == null || time(i) === time(i + 1)) return null;
      return ts.logicalToCoordinate(
        interpolate(t, time(i), time(i + 1), a, b) as Logical,
      );
    },
    xToTime(x: number): number | null {
      if (candles.length === 0) {
        const t = ts.coordinateToTime(x);
        return typeof t === 'number' ? t : null;
      }
      const l = ts.coordinateToLogical(x);
      if (l == null) return null;
      if (candles.length === 1) {
        const anchor = logical(0);
        return anchor == null ? null : time(0) + l - anchor;
      }
      const i = bracket(candles.length, l, logical);
      const a = logical(i);
      const b = logical(i + 1);
      if (a == null || b == null || a === b) return null;
      return interpolate(l, a, b, time(i), time(i + 1));
    },
  };
}

export function chartTimeAtCoordinate(
  chart: IChartApi,
  x: number,
  candles: readonly OHLCVCandle[],
): number | null {
  return timeMapping(chart, candles).xToTime(x);
}

export function buildCoordMap(
  chart: IChartApi,
  priceSeries: ISeriesApi<'Candlestick' | 'Line'>,
  version: number,
  candles: readonly OHLCVCandle[] = [],
): CoordMap {
  return {
    version,
    plotWidth: chart.paneSize().width,
    plotHeight: chart.paneSize().height,
    ...timeMapping(chart, candles),
    priceToY: p => priceSeries.priceToCoordinate(p),
    yToPrice: y => priceSeries.coordinateToPrice(y),
  };
}

/** LWC applies scale changes on its next frame; settle for two frames, never poll at rest. */
export function coordinateInvalidator(
  invalidate: () => void,
  request: (cb: FrameRequestCallback) => number = requestAnimationFrame,
  cancel: (id: number) => void = cancelAnimationFrame,
) {
  let frame: number | null = null;
  let active = false;
  let settling = 0;
  function tick() {
    frame = null;
    invalidate();
    if (active || --settling > 0) frame = request(tick);
  }
  function settle() {
    settling = 2;
    if (frame === null) frame = request(tick);
  }
  return {
    settle,
    start() {
      active = true;
      settle();
    },
    stop() {
      if (!active) return;
      active = false;
      settle();
    },
    destroy() {
      active = false;
      settling = 0;
      if (frame !== null) cancel(frame);
      frame = null;
    },
  };
}

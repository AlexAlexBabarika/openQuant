import type { OHLCVCandle } from '$lib/core/types';
import { hasValidOhlcv } from '$lib/core/candles';

export function inspectCandles(
  candles: readonly OHLCVCandle[],
  interval: string,
) {
  const seen = new Set<number>();
  let first: number | null = null,
    last: number | null = null,
    previous: number | null = null;
  let duplicates = 0,
    outOfOrder = 0,
    invalidTimestamps = 0,
    invalidBars = 0,
    longIntervals = 0;
  const match = /^(\d+)(m|h|d|w)$/.exec(interval);
  const duration = match
    ? Number(match[1]) *
      { m: 60, h: 3600, d: 86400, w: 604800 }[
        match[2] as 'm' | 'h' | 'd' | 'w'
      ] *
      1000
    : null;
  for (const c of candles) {
    const t = Date.parse(c.timestamp);
    if (!Number.isFinite(t)) invalidTimestamps++;
    else {
      if (seen.has(t)) duplicates++;
      seen.add(t);
      if (previous !== null) {
        if (t < previous) outOfOrder++;
        if (duration && t - previous > duration * 1.5) longIntervals++;
      }
      first = first === null ? t : Math.min(first, t);
      last = last === null ? t : Math.max(last, t);
      previous = t;
    }
    if (!hasValidOhlcv(c)) invalidBars++;
  }
  return {
    count: candles.length,
    first,
    last,
    duplicates,
    outOfOrder,
    invalidTimestamps,
    invalidBars,
    longIntervals,
    fixedInterval: duration !== null,
  };
}

export function utcTime(value: number | null): string {
  return value === null || !Number.isFinite(value)
    ? 'Not available'
    : new Date(value).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
}

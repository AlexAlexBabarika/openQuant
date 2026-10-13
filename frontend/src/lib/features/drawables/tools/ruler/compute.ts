import type { OHLCVCandle } from '$lib/core/types';
import { formatMarketPrice } from '$lib/features/market/priceFormat';
import { ownedCandleHistory } from '$lib/features/chart/candleFingerprint';

export interface RulerGeometry {
  startTime: number;
  endTime: number;
  startPrice: number;
  endPrice: number;
}

export interface RulerStats {
  priceDelta: number;
  pctDelta: number;
  barCount: number;
  spanLabel: string;
  volumeSum: number;
  isUp: boolean;
}

interface CandleIndex {
  times: number[];
  volumes: number[];
  volumePrefix: number[] | null;
  incremental: boolean;
}

const indexCache = new WeakMap<
  readonly OHLCVCandle[],
  { signature: string; history?: object; index: CandleIndex }
>();
let sharedIndex:
  | { candles: readonly OHLCVCandle[]; signature: string }
  | undefined;

function buildIndex(candles: readonly OHLCVCandle[]): CandleIndex {
  const rows = candles
    .map(c => ({ time: Date.parse(c.timestamp) / 1000, volume: c.volume }))
    .filter(row => Number.isFinite(row.time));
  const incremental =
    rows.length === candles.length &&
    rows.every((row, i) => i === 0 || row.time > rows[i - 1].time);
  const volumePrefix = [0];
  let total = 0;
  let safePrefix = true;
  for (const row of rows) {
    total += row.volume;
    // Exact nonnegative integer sums avoid prefix subtraction losing small ranges.
    if (
      !Number.isSafeInteger(row.volume) ||
      row.volume < 0 ||
      !Number.isSafeInteger(total)
    ) {
      safePrefix = false;
      break;
    }
  }
  if (safePrefix) {
    rows.sort((a, b) => a.time - b.time);
    // Unsafe sums retain original input order.
    for (const row of rows)
      volumePrefix.push(volumePrefix[volumePrefix.length - 1] + row.volume);
  }
  return {
    times: rows.map(row => row.time),
    volumes: rows.map(row => row.volume),
    volumePrefix: safePrefix ? volumePrefix : null,
    incremental,
  };
}

function updateTail(
  index: CandleIndex,
  candles: readonly OHLCVCandle[],
): boolean {
  if (!index.incremental || candles.length < index.times.length) return false;
  const from = Math.max(0, index.times.length - 1);
  if (index.volumePrefix) index.volumePrefix.length = from + 1;
  for (let i = from; i < candles.length; i++) {
    const time = Date.parse(candles[i].timestamp) / 1000;
    if (!Number.isFinite(time) || (i > 0 && time <= index.times[i - 1]))
      return false;
    index.times[i] = time;
    index.volumes[i] = candles[i].volume;
    if (index.volumePrefix) {
      const total = index.volumePrefix[i] + candles[i].volume;
      if (
        !Number.isSafeInteger(candles[i].volume) ||
        candles[i].volume < 0 ||
        !Number.isSafeInteger(total)
      ) {
        index.volumePrefix = null;
      } else index.volumePrefix.push(total);
    }
  }
  return true;
}

/** Share one timestamp index across the synchronous drawable compute pass. */
export function withRulerCandleIndex<T>(
  candles: readonly OHLCVCandle[],
  signature: string,
  compute: () => T,
): T {
  const previous = sharedIndex;
  sharedIndex = { candles, signature };
  try {
    return compute();
  } finally {
    sharedIndex = previous;
  }
}

function bound(
  times: readonly number[],
  time: number,
  inclusive: boolean,
): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid] < time || (inclusive && times[mid] === time)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function formatSpan(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${s}s`;
}

export function computeStats(
  geo: RulerGeometry,
  candles: readonly OHLCVCandle[],
): RulerStats {
  const priceDelta = geo.endPrice - geo.startPrice;
  const pctDelta =
    geo.startPrice !== 0 ? (priceDelta / geo.startPrice) * 100 : 0;
  const tMin = Math.min(geo.startTime, geo.endTime);
  const tMax = Math.max(geo.startTime, geo.endTime);

  let barCount = 0;
  let volumeSum = 0;
  if (
    sharedIndex?.candles === candles &&
    !Number.isNaN(tMin) &&
    !Number.isNaN(tMax)
  ) {
    const signature = sharedIndex.signature;
    const cached = indexCache.get(candles);
    const history = ownedCandleHistory(candles, signature);
    const index =
      cached?.signature === signature && cached.history === history
        ? cached.index
        : history &&
            cached?.history === history &&
            updateTail(cached.index, candles)
          ? cached.index
          : buildIndex(candles);
    indexCache.set(candles, { signature, history, index });
    if (index.volumePrefix) {
      const from = bound(index.times, tMin, false);
      const to = bound(index.times, tMax, true);
      barCount = to - from;
      volumeSum = index.volumePrefix[to] - index.volumePrefix[from];
    } else {
      const from = index.incremental ? bound(index.times, tMin, false) : 0;
      const to = index.incremental
        ? bound(index.times, tMax, true)
        : index.times.length;
      for (let i = from; i < to; i++) {
        if (index.times[i] >= tMin && index.times[i] <= tMax) {
          barCount++;
          volumeSum += index.volumes[i];
        }
      }
    }
  } else {
    for (const c of candles) {
      const t = Date.parse(c.timestamp) / 1000;
      if (t >= tMin && t <= tMax) {
        barCount++;
        volumeSum += c.volume;
      }
    }
  }

  return {
    priceDelta,
    pctDelta,
    barCount,
    spanLabel: formatSpan(tMax - tMin),
    volumeSum,
    isUp: priceDelta >= 0,
  };
}

export function formatPriceDelta(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const sign = n >= 0 ? '+' : '−';
  return `${sign}${formatMarketPrice(Math.abs(n))}`;
}

export function formatPct(n: number): string {
  const sign = n >= 0 ? '+' : '−';
  return `${sign}${Math.abs(n).toFixed(2)}%`;
}

export function formatVolume(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(0);
}

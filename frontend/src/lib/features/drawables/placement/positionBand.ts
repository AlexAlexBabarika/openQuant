import type { ChartPoint, PlacementCtx, PlacementMachine } from '../types';

/** Shared horizontal span + three price levels (TradingView-style band). */
export interface PositionGeo {
  startTime: number;
  endTime: number;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
}

const MIN_TIME_SPAN = 1;
/** Minimum band width in time when extrapolating past the last bar (fraction of one bar). */
const MIN_BAR_SPAN_FACTOR = 0.25;
const DEFAULT_FRAC = 0.008;

function minSpanPastLastBar(ctx: PlacementCtx): number {
  const step = ctx.barStepSeconds;
  if (step != null && step > 0) {
    return Math.max(MIN_TIME_SPAN, Math.floor(step * MIN_BAR_SPAN_FACTOR));
  }
  return MIN_TIME_SPAN;
}

function buildGeo(
  pt: ChartPoint,
  ctx: PlacementCtx,
  side: 'long' | 'short',
): PositionGeo {
  const anchorEnd = ctx.lastCandleTime ?? pt.time;
  let startTime: number;
  let endTime: number;

  if (ctx.lastCandleTime != null && pt.time > ctx.lastCandleTime) {
    endTime = pt.time;
    startTime = anchorEnd;
    const minSpan = minSpanPastLastBar(ctx);
    if (endTime - startTime < minSpan) {
      startTime = endTime - minSpan;
    }
  } else {
    endTime = Math.max(anchorEnd, pt.time);
    startTime = Math.min(pt.time, endTime - minSpanPastLastBar(ctx));
    if (startTime >= endTime) {
      startTime = endTime - MIN_TIME_SPAN;
    }
  }

  const entryPrice = pt.price;
  let stopPrice: number;
  let targetPrice: number;
  if (side === 'long') {
    stopPrice = entryPrice * (1 - DEFAULT_FRAC);
    targetPrice = entryPrice * (1 + DEFAULT_FRAC);
  } else {
    stopPrice = entryPrice * (1 + DEFAULT_FRAC);
    targetPrice = entryPrice * (1 - DEFAULT_FRAC);
  }

  return {
    startTime,
    endTime,
    entryPrice,
    stopPrice,
    targetPrice,
  };
}

/**
 * Single pointer-up completes placement (after optional move for preview).
 * Band is anchored so the right edge aligns with the last candle when provided.
 */
export function positionBandPlacement(
  ctx: PlacementCtx,
  side: 'long' | 'short',
): PlacementMachine<PositionGeo> {
  let hover: ChartPoint | null = null;
  let callback: ((geo: PositionGeo) => void) | null = null;
  let finished = false;

  return {
    onPointerDown(pt: ChartPoint) {
      if (finished) return;
      hover = pt;
    },
    onPointerMove(pt: ChartPoint) {
      if (finished) return;
      hover = pt;
    },
    onPointerUp(pt: ChartPoint) {
      if (finished) return;
      hover = pt;
      finished = true;
      callback?.(buildGeo(pt, ctx, side));
    },
    get preview() {
      if (finished || !hover) return null;
      return { geometry: buildGeo(hover, ctx, side) };
    },
    onComplete(cb) {
      callback = cb;
    },
    cancel() {
      finished = true;
    },
    get done() {
      return finished;
    },
  };
}

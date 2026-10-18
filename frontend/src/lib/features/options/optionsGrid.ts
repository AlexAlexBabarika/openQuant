import type { Domain } from './optionsChart';
import type { OptionsDraft } from './optionsTypes';
import { enabledStrikes, expiryBreakevens } from './optionsPayoff';

const FIT_POINTS = 81;

export function spotGrid(start: number, end: number, count = 81): number[] {
  return Array.from({ length: count }, (_, i) =>
    i === count - 1 ? end : start + ((end - start) * i) / (count - 1),
  );
}

/** Strikes, spot and breakevens plus padding: 35% of their span, at least 6% of spot. */
export function fitPriceDomain(
  spot: number,
  strikes: number[],
  breakevens: number[] = [],
): Domain | null {
  const prices = [spot, ...strikes, ...breakevens].filter(
    p => Number.isFinite(p) && p >= 0,
  );
  if (!prices.length) return null;
  const lo = Math.min(...prices),
    hi = Math.max(...prices);
  const scale = Number.isFinite(spot) && spot > 0 ? spot : hi;
  const pad = Math.max((hi - lo) * 0.35, scale * 0.06) || 1;
  return { min: Math.max(0, lo - pad), max: Math.min(1000000, hi + pad) };
}

export function fittedSpotGrid(draft: OptionsDraft): number[] {
  const domain = fitPriceDomain(
    draft.spot,
    enabledStrikes(draft),
    expiryBreakevens(draft),
  );
  return domain
    ? spotGrid(domain.min, domain.max, FIT_POINTS)
    : draft.spot_grid;
}

/** Refit on a new spot or leg shape, or when a strike, spot or breakeven nears the grid's edge. */
export function needsRefit(before: OptionsDraft, after: OptionsDraft): boolean {
  if (!Object.is(before.spot, after.spot)) return true;
  const previous = before.strategy.legs,
    legs = after.strategy.legs;
  if (
    previous.length !== legs.length ||
    legs.some((leg, i) => leg.kind !== previous[i].kind)
  )
    return true;
  const grid = after.spot_grid;
  if (grid.length < 2) return true;
  const min = grid[0],
    max = grid[grid.length - 1],
    margin = (max - min) * 0.05;
  return [after.spot, ...enabledStrikes(after), ...expiryBreakevens(after)]
    .filter(Number.isFinite)
    .some(p => p < min + margin || p > max - margin);
}

export function sameGrid(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

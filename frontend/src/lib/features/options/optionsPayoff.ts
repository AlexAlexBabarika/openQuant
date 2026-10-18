import type { OptionsDraft } from './optionsTypes';
import { resolvedLegDays } from './optionsValidation';

/**
 * Expiration P&L of a single-expiry draft. It is intrinsic arithmetic, the same
 * piecewise-linear payoff the backend returns as expiry_curve, so it is exact.
 * Null when enabled options expire on different days or an input is nonfinite.
 */
export function expiryPayoff(
  draft: OptionsDraft,
): ((spot: number) => number) | null {
  const legs = draft.strategy.legs.filter(l => l.enabled);
  const fee = draft.strategy.entry_fee_per_contract;
  const days = new Set(
    legs
      .filter(l => l.kind !== 'underlying')
      .map(l => resolvedLegDays(draft.strategy, l)),
  );
  if (
    days.size > 1 ||
    [...days].some(d => !Number.isFinite(d)) ||
    !Number.isFinite(fee) ||
    legs.some(
      l =>
        !Number.isFinite(l.quantity) ||
        !Number.isFinite(l.multiplier) ||
        !Number.isFinite(l.entry_premium) ||
        (l.kind !== 'underlying' && !Number.isFinite(l.strike)),
    )
  )
    return null;
  return spot =>
    legs.reduce((total, l) => {
      const strike = l.strike as number;
      const value =
        l.kind === 'underlying'
          ? spot
          : l.kind === 'call'
            ? Math.max(0, spot - strike)
            : Math.max(0, strike - spot);
      const fees = l.kind === 'underlying' ? 0 : Math.abs(l.quantity) * fee;
      return (
        total + l.quantity * l.multiplier * (value - l.entry_premium) - fees
      );
    }, 0);
}

/** Sorted enabled option strikes: the payoff's only kinks. */
export function enabledStrikes(draft: OptionsDraft): number[] {
  return [
    ...new Set(
      draft.strategy.legs
        .filter(
          l =>
            l.enabled &&
            l.kind !== 'underlying' &&
            Number.isFinite(l.strike) &&
            (l.strike as number) > 0,
        )
        .map(l => l.strike as number),
    ),
  ].sort((a, b) => a - b);
}

/** Isolated expiration breakevens over all nonnegative spots; empty for mixed expiries. */
export function expiryBreakevens(draft: OptionsDraft): number[] {
  const f = expiryPayoff(draft);
  if (!f) return [];
  const xs = [0, ...enabledStrikes(draft)];
  const values = xs.map(f);
  const top = xs[xs.length - 1];
  const slope = f(top + 1) - values[values.length - 1];
  const roots: number[] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const a = values[i],
      b = values[i + 1];
    const next = i + 2 < xs.length ? values[i + 2] : b + slope;
    if (a * b < 0) roots.push(xs[i] - (a * (xs[i + 1] - xs[i])) / (b - a));
    else if (b === 0 && a !== 0 && next !== 0) roots.push(xs[i + 1]);
  }
  const last = values[values.length - 1];
  if (slope !== 0 && last * slope < 0) roots.push(top - last / slope);
  return roots;
}

/** Exact expiration vertices across a price view: its edges plus every enabled strike inside it. */
export function expiryPayoffPoints(
  draft: OptionsDraft,
  domain: { min: number; max: number },
): { spot: number; value: number }[] | null {
  const f = expiryPayoff(draft);
  if (!f) return null;
  const spots = [
    domain.min,
    ...enabledStrikes(draft).filter(k => k > domain.min && k < domain.max),
    domain.max,
  ];
  return spots.map(spot => ({ spot, value: f(spot) }));
}

import type { OptionsAnalysis, OptionsDraft } from './optionsTypes';

/**
 * Model premiums are frontend-only: each leg carries a tag (true = premium follows
 * the model). Tags never reach the wire; the backend prices legs through one
 * ordinary /options/analyze request.
 */

/** Every leg enabled so each gets a model value; a two-point grid keeps the request small. */
export function modelPricingRequest(draft: OptionsDraft): OptionsDraft {
  const request = structuredClone(draft);
  request.strategy.legs.forEach(leg => {
    leg.enabled = true;
  });
  request.spot_grid = [draft.spot * 0.5, Math.min(1000000, draft.spot * 1.5)];
  request.scenarios = [];
  request.surface = null;
  return request;
}

/** Per-unit model price of each leg, in cents; null when the backend returned no finite value. */
export function modelUnitPrices(result: OptionsAnalysis): (number | null)[] {
  const legs = result?.request?.strategy?.legs;
  if (!Array.isArray(legs)) return [];
  return legs.map((leg, i) => {
    const row = result.legs?.[i];
    const units = leg.quantity * leg.multiplier;
    const value = row?.enabled ? row.theoretical_value_today / units : NaN;
    return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  });
}

/** Everything a model price depends on, and which legs follow it; never the premiums themselves. */
export function pricingKey(draft: OptionsDraft, tags: boolean[]): string {
  return JSON.stringify([
    draft.spot,
    draft.volatility,
    draft.rate,
    draft.dividend_yield,
    draft.strategy.days_to_expiry,
    draft.strategy.valuation_date ?? null,
    draft.strategy.expiry_date ?? null,
    draft.strategy.legs.map((l, i) => [
      tags[i] ?? false,
      l.kind,
      l.quantity,
      l.strike,
      l.multiplier,
      l.days_to_expiry ?? null,
      l.expiry_date ?? null,
      l.implied_volatility ?? null,
    ]),
  ]);
}

/**
 * Tags after an arbitrary edit. Same leg count: keep each leg's tag unless its premium
 * was changed (a typed premium is manual). Otherwise follow legs that are unchanged;
 * anything new is manual.
 */
export function carryModelTags(
  before: OptionsDraft,
  after: OptionsDraft,
  tags: boolean[],
): boolean[] {
  const previous = before.strategy.legs,
    legs = after.strategy.legs;
  if (previous.length === legs.length)
    return legs.map(
      (leg, i) =>
        (tags[i] ?? false) &&
        Object.is(leg.entry_premium, previous[i].entry_premium),
    );
  const unused = previous.map((leg, i) => ({ json: JSON.stringify(leg), i }));
  return legs.map(leg => {
    const json = JSON.stringify(leg);
    const match = unused.findIndex(candidate => candidate.json === json);
    if (match < 0) return false;
    const [{ i }] = unused.splice(match, 1);
    return tags[i] ?? false;
  });
}

import { apiJson } from '$lib/core/api';
import { optionsErrors, resolvedLegDays } from './optionsValidation';
import type { OptionsAnalysis, OptionsDraft } from './optionsTypes';

export interface SkewPoint {
  legIndex: number;
  right: 'call' | 'put';
  strike: number;
  days: number;
  expiry: string;
  iv: number;
  inherited: boolean;
}
export interface SkewTransform {
  parallelPP: number;
  twistPP: number;
  curvaturePP: number;
}

export function skewPoints(draft: OptionsDraft): SkewPoint[] {
  return draft.strategy.legs.flatMap((leg, legIndex) => {
    if (!leg.enabled || leg.kind === 'underlying') return [];
    const days = resolvedLegDays(draft.strategy, leg);
    return [
      {
        legIndex,
        right: leg.kind,
        strike: leg.strike as number,
        days,
        expiry:
          leg.expiry_date ??
          (leg.days_to_expiry == null ? draft.strategy.expiry_date : null) ??
          `${days} days`,
        iv: leg.implied_volatility ?? draft.volatility,
        inherited: leg.implied_volatility == null,
      },
    ];
  });
}

export function skewSeries(
  draft: OptionsDraft,
): { key: string; points: SkewPoint[] }[] {
  const groups = new Map<string, SkewPoint[]>();
  for (const point of skewPoints(draft)) {
    const key = `${point.days} days · ${point.right}`;
    groups.set(key, [...(groups.get(key) ?? []), point]);
  }
  return [...groups].map(([key, points]) => ({
    key,
    points: points.sort(
      (a, b) => a.strike - b.strike || a.legIndex - b.legIndex,
    ),
  }));
}

const validIV = (iv: number) => Number.isFinite(iv) && iv >= 0 && iv <= 5;

/** x is strike distance from spot divided by the largest active distance. */
export function transformSkew(
  draft: OptionsDraft,
  transform: SkewTransform,
): OptionsDraft {
  if (
    Object.values(transform).some(v => !Number.isFinite(v) || Math.abs(v) > 500)
  )
    throw new Error(
      'Each transform must be finite and within −500 to +500 IV pp.',
    );
  const points = skewPoints(draft);
  if (!points.length)
    throw new Error('Enable at least one option leg to edit skew.');
  if (
    !validIV(draft.volatility) ||
    !Number.isFinite(draft.spot) ||
    draft.spot <= 0 ||
    points.some(
      p => !validIV(p.iv) || !Number.isFinite(p.strike) || p.strike <= 0,
    )
  )
    throw new Error(
      'Correct base IV, active option IVs, strikes and spot first.',
    );
  const base = draft.volatility + transform.parallelPP / 100;
  const scale = Math.max(...points.map(p => Math.abs(p.strike - draft.spot)));
  const updates = points.map(p => {
    const x = scale === 0 ? 0 : (p.strike - draft.spot) / scale;
    const wing = (transform.twistPP * x + transform.curvaturePP * x * x) / 100;
    return { point: p, iv: p.iv + transform.parallelPP / 100 + wing, wing };
  });
  if (!validIV(base) || updates.some(p => !validIV(p.iv)))
    throw new Error(
      'Nothing applied: declared base and every enabled option IV must stay within 0–500%.',
    );
  const next = structuredClone(draft);
  next.volatility = base;
  for (const { point, iv, wing } of updates) {
    if (!point.inherited || wing !== 0)
      next.strategy.legs[point.legIndex].implied_volatility = iv;
  }
  return next;
}

export function editSkewPoint(
  draft: OptionsDraft,
  legIndex: number,
  iv: number | null,
): void {
  const leg = draft.strategy.legs[legIndex];
  if (!leg?.enabled || leg.kind === 'underlying')
    throw new Error('Choose an enabled option leg.');
  if (iv !== null && !validIV(iv))
    throw new Error(
      'IV must be between 0% and 500%. Blank resets to declared base IV.',
    );
  leg.implied_volatility = iv;
}

export function skewComparisonRequests(draft: OptionsDraft): {
  flat: OptionsDraft;
  skew: OptionsDraft;
} {
  if (!skewPoints(draft).length)
    throw new Error('Enable at least one option leg to compare skew.');
  const skew = structuredClone(draft);
  skew.scenarios = [];
  skew.surface = null;
  const flat = structuredClone(skew);
  for (const leg of flat.strategy.legs) {
    if (leg.enabled && leg.kind !== 'underlying') leg.implied_volatility = null;
  }
  const errors = { ...optionsErrors(skew), ...optionsErrors(flat) };
  if (Object.keys(errors).length)
    throw new Error(
      Object.entries(errors)
        .map(([k, v]) => `${k}: ${v}`)
        .join('; '),
    );
  return { flat, skew };
}

export async function compareSkew(
  draft: OptionsDraft,
  signal: AbortSignal,
): Promise<{ flat: OptionsAnalysis; skew: OptionsAnalysis }> {
  const requests = skewComparisonRequests(draft);
  const analyze = (request: OptionsDraft) =>
    apiJson<OptionsAnalysis>('/options/analyze', {
      method: 'POST',
      body: JSON.stringify(request),
      signal,
    });
  const [flat, skew] = await Promise.all([
    analyze(requests.flat),
    analyze(requests.skew),
  ]);
  return { flat, skew };
}

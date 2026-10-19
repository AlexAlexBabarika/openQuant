import type { OptionsDraft } from './optionsTypes';
import { fittedSpotGrid, spotGrid } from './optionsGrid';
import { addDays, localIsoDate } from './optionsInputs';

type Leg = OptionsDraft['strategy']['legs'][number];
export const OPTIONS_TEMPLATES = [
  ['long_call', 'Long call'],
  ['short_call', 'Short call'],
  ['long_put', 'Long put'],
  ['short_put', 'Short put'],
  ['bull_call', 'Bull call spread'],
  ['bear_call', 'Bear call spread'],
  ['bull_put', 'Bull put spread'],
  ['bear_put', 'Bear put spread'],
  ['straddle', 'Long straddle'],
  ['strangle', 'Long strangle'],
  ['butterfly', 'Call butterfly'],
  ['iron_butterfly', 'Iron butterfly'],
  ['iron_condor', 'Iron condor'],
  ['covered_call', 'Covered call'],
  ['protective_put', 'Protective put'],
] as const;
export type OptionsTemplate = (typeof OPTIONS_TEMPLATES)[number][0];

export { spotGrid } from './optionsGrid';

export function templateStrategy(
  id: OptionsTemplate,
  spot = 100,
  volatility = 0.2,
  days = 30,
): OptionsDraft['strategy'] {
  const s = Math.min(1000000 / 1.2, Math.max(1, spot));
  // Spreads, strangles and wings sit one and two expected moves (spot × IV × √years) from
  // spot, so premiums and risk scale with the market. Unusable inputs use 20% IV over 30
  // days; the move stays within 1–40% of spot and keeps the outer wing under the strike cap.
  const expected = s * volatility * Math.sqrt(days / 365);
  const move = Math.min(
    s * 0.4,
    (1000000 - s) / 2.5,
    Math.max(
      s * 0.01,
      Number.isFinite(expected) ? expected : s * 0.2 * Math.sqrt(30 / 365),
    ),
  );
  // Round, chain-like strikes (not actual listings): the largest 1/2/2.5/5 x 10^n step
  // within 2.5% of spot and half a move, so neighbouring strikes never collapse.
  const limit = Math.min(s * 0.025, move / 2);
  const scale = 10 ** Math.floor(Math.log10(limit));
  const step = [5, 2.5, 2, 1].map(m => m * scale).find(m => m <= limit)!;
  const option = (
    kind: 'call' | 'put',
    quantity: number,
    strike: number,
    entry_premium: number,
  ): Leg => ({
    kind,
    quantity,
    strike: Number((Math.round(strike / step) * step).toPrecision(12)),
    entry_premium: Math.round(entry_premium * 100) / 100,
    multiplier: 100,
    enabled: true,
  });
  const call = (q: number, k: number, p: number) => option('call', q, k, p);
  const put = (q: number, k: number, p: number) => option('put', q, k, p);
  const shares: Leg = {
    kind: 'underlying',
    quantity: 100,
    strike: null,
    entry_premium: spot,
    multiplier: 1,
    enabled: true,
  };
  let template: OptionsDraft['strategy']['template'] = 'custom';
  let legs: Leg[];
  switch (id) {
    case 'long_call':
      template = 'long_call';
      legs = [call(1, s, s * 0.05)];
      break;
    case 'short_call':
      legs = [call(-1, s, s * 0.05)];
      break;
    case 'long_put':
      template = 'long_put';
      legs = [put(1, s, s * 0.05)];
      break;
    case 'short_put':
      legs = [put(-1, s, s * 0.05)];
      break;
    case 'bull_call':
      template = 'call_vertical';
      legs = [call(1, s, s * 0.05), call(-1, s + move, s * 0.02)];
      break;
    case 'bear_call':
      template = 'call_vertical';
      legs = [call(-1, s, s * 0.05), call(1, s + move, s * 0.02)];
      break;
    case 'bull_put':
      template = 'put_vertical';
      legs = [put(1, s - move, s * 0.02), put(-1, s, s * 0.05)];
      break;
    case 'bear_put':
      template = 'put_vertical';
      legs = [put(-1, s - move, s * 0.02), put(1, s, s * 0.05)];
      break;
    case 'straddle':
      template = 'straddle';
      legs = [call(1, s, s * 0.05), put(1, s, s * 0.05)];
      break;
    case 'strangle':
      template = 'strangle';
      legs = [put(1, s - move, s * 0.02), call(1, s + move, s * 0.02)];
      break;
    case 'butterfly':
      legs = [
        call(1, s - move, s * 0.12),
        call(-2, s, s * 0.05),
        call(1, s + move, s * 0.02),
      ];
      break;
    case 'iron_butterfly':
      template = 'iron_butterfly';
      legs = [
        put(1, s - move, s * 0.02),
        put(-1, s, s * 0.05),
        call(-1, s, s * 0.05),
        call(1, s + move, s * 0.02),
      ];
      break;
    case 'iron_condor':
      template = 'iron_condor';
      legs = [
        put(1, s - 2 * move, s * 0.01),
        put(-1, s - move, s * 0.03),
        call(-1, s + move, s * 0.03),
        call(1, s + 2 * move, s * 0.01),
      ];
      break;
    case 'covered_call':
      template = 'covered_call';
      legs = [shares, call(-1, s + move, s * 0.02)];
      break;
    case 'protective_put':
      template = 'protective_put';
      legs = [shares, put(1, s - move, s * 0.02)];
      break;
  }
  return {
    name: OPTIONS_TEMPLATES.find(t => t[0] === id)![1],
    template,
    days_to_expiry: 30,
    currency: 'USD',
    exercise_style: 'european',
    settlement: 'cash',
    entry_fee_per_contract: 0,
    legs,
  };
}

/** Undated (days-only) by default; pass `now` for the workbench's dated draft valued today. */
export function createOptionsDraft(now?: Date): OptionsDraft {
  const valuation = now ? localIsoDate(now) : null;
  const draft: OptionsDraft = {
    strategy: {
      ...templateStrategy('long_call'),
      ...(valuation
        ? { valuation_date: valuation, expiry_date: addDays(valuation, 30) }
        : {}),
    },
    spot: 100,
    volatility: 0.2,
    rate: 0.03,
    dividend_yield: 0,
    spot_grid: spotGrid(50, 150),
    scenarios: [],
  };
  draft.spot_grid = fittedSpotGrid(draft);
  return draft;
}

/** Replace explicit synthetic legs, not common contract or request assumptions. */
export function applyOptionsTemplate(
  draft: OptionsDraft,
  id: OptionsTemplate,
): void {
  const spot =
    Number.isFinite(draft.spot) && draft.spot > 0 && draft.spot <= 1000000
      ? draft.spot
      : 100;
  const { name, template, legs } = templateStrategy(
    id,
    spot,
    draft.volatility,
    draft.strategy.days_to_expiry,
  );
  Object.assign(draft.strategy, { name, template, legs });
}

/** A template's expiry payoff shape as an SVG path in a 100 × 18 box, from its own legs at spot 100. */
export function templateGlyph(id: OptionsTemplate): string {
  const legs = templateStrategy(id).legs;
  const strikes = legs.flatMap(l => (l.strike === null ? [] : [l.strike]));
  const lo = Math.min(100, ...strikes) * 0.85,
    hi = Math.max(100, ...strikes) * 1.15;
  const values = Array.from({ length: 41 }, (_, i) => {
    const spot = lo + ((hi - lo) * i) / 40;
    return legs.reduce((total, l) => {
      const value =
        l.kind === 'underlying'
          ? spot - 100
          : Math.max(
              0,
              l.kind === 'call' ? spot - l.strike! : l.strike! - spot,
            );
      return total + l.quantity * l.multiplier * value;
    }, 0);
  });
  const min = Math.min(...values),
    span = Math.max(...values) - min || 1;
  return (
    'M' +
    values
      .map(
        (v, i) =>
          `${((i / 40) * 100).toFixed(1)},${(16 - ((v - min) / span) * 14).toFixed(1)}`,
      )
      .join('L')
  );
}

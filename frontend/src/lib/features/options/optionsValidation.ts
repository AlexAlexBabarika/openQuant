import type { OptionsDraft } from './optionsTypes';

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
function keys(v: unknown, allowed: string[], required: string[]): boolean {
  return (
    object(v) &&
    Object.keys(v).every(k => allowed.includes(k)) &&
    required.every(k => k in v)
  );
}
const numeric = (v: unknown) => typeof v === 'number';
const boundedText = (v: unknown, max: number) =>
  typeof v === 'string' && v.length <= max;
const optional = (v: unknown, check: (v: unknown) => boolean) =>
  v == null || check(v);
const boundedArray = (
  v: unknown,
  max: number,
  check: (v: unknown) => boolean,
) => Array.isArray(v) && v.length <= max && v.every(check);

/** Structural bounds allow temporarily invalid form numbers/names, not arbitrary JSON. */
export function workingDraftShape(
  v: unknown,
  enforceBounds = true,
): v is OptionsDraft {
  const text = (v: unknown, max: number) =>
    boundedText(v, enforceBounds ? max : Infinity);
  const array = (v: unknown, max: number, check: (v: unknown) => boolean) =>
    boundedArray(v, enforceBounds ? max : Infinity, check);
  if (
    !keys(
      v,
      [
        'strategy',
        'spot',
        'volatility',
        'rate',
        'dividend_yield',
        'spot_grid',
        'scenarios',
        'surface',
      ],
      [
        'strategy',
        'spot',
        'volatility',
        'rate',
        'dividend_yield',
        'spot_grid',
        'scenarios',
      ],
    ) ||
    !object(v)
  )
    return false;
  const s = v.strategy;
  if (
    !keys(
      s,
      [
        'name',
        'template',
        'days_to_expiry',
        'underlying',
        'valuation_date',
        'expiry_date',
        'currency',
        'exercise_style',
        'settlement',
        'entry_fee_per_contract',
        'legs',
      ],
      [
        'name',
        'template',
        'days_to_expiry',
        'currency',
        'exercise_style',
        'settlement',
        'entry_fee_per_contract',
        'legs',
      ],
    ) ||
    !object(s)
  )
    return false;
  if (
    !text(s.name, 120) ||
    !text(s.template, 40) ||
    !text(s.currency, 16) ||
    !text(s.exercise_style, 16) ||
    !text(s.settlement, 16) ||
    !numeric(s.days_to_expiry) ||
    !numeric(s.entry_fee_per_contract) ||
    !optional(s.underlying, x => text(x, 80)) ||
    !optional(s.valuation_date, x => text(x, 10)) ||
    !optional(s.expiry_date, x => text(x, 10))
  )
    return false;
  if (
    !array(
      s.legs,
      16,
      l =>
        keys(
          l,
          [
            'kind',
            'quantity',
            'strike',
            'entry_premium',
            'multiplier',
            'enabled',
            'days_to_expiry',
            'expiry_date',
            'source',
            'implied_volatility',
            'bid',
            'ask',
            'quote_as_of',
          ],
          [
            'kind',
            'quantity',
            'strike',
            'entry_premium',
            'multiplier',
            'enabled',
          ],
        ) &&
        object(l) &&
        text(l.kind, 16) &&
        numeric(l.quantity) &&
        (l.strike === null || numeric(l.strike)) &&
        numeric(l.entry_premium) &&
        numeric(l.multiplier) &&
        typeof l.enabled === 'boolean' &&
        optional(l.days_to_expiry, numeric) &&
        optional(l.expiry_date, x => text(x, 10)) &&
        optional(
          l.source,
          x =>
            keys(
              x,
              [
                'provider',
                'environment',
                'contract_symbol',
                'underlying',
                'fetched_at',
                'bid_as_of',
                'ask_as_of',
                'observed_exercise_style',
                'observed_settlement',
              ],
              [
                'provider',
                'environment',
                'contract_symbol',
                'underlying',
                'fetched_at',
              ],
            ) &&
            object(x) &&
            text(x.provider, 16) &&
            text(x.environment, 16) &&
            text(x.contract_symbol, 80) &&
            text(x.underlying, 80) &&
            text(x.fetched_at, 64) &&
            optional(x.bid_as_of, y => text(y, 64)) &&
            optional(x.ask_as_of, y => text(y, 64)) &&
            optional(x.observed_exercise_style, y => text(y, 16)) &&
            optional(x.observed_settlement, y => text(y, 16)),
        ) &&
        optional(l.implied_volatility, numeric) &&
        optional(l.bid, numeric) &&
        optional(l.ask, numeric) &&
        optional(l.quote_as_of, x => text(x, 64)),
    )
  )
    return false;
  if (
    !['spot', 'volatility', 'rate', 'dividend_yield'].every(k =>
      numeric(v[k]),
    ) ||
    !array(v.spot_grid, 201, numeric) ||
    !array(
      v.scenarios,
      3,
      x =>
        keys(
          x,
          ['name', 'elapsed_days', 'iv_shift_pp'],
          ['name', 'elapsed_days', 'iv_shift_pp'],
        ) &&
        object(x) &&
        text(x.name, 80) &&
        numeric(x.elapsed_days) &&
        numeric(x.iv_shift_pp),
    )
  )
    return false;
  return optional(
    v.surface,
    x =>
      keys(x, ['axis', 'spots', 'steps'], ['axis', 'spots', 'steps']) &&
      object(x) &&
      text(x.axis, 20) &&
      array(x.spots, 41, numeric) &&
      array(x.steps, 21, numeric),
  );
}

/** UTC epoch milliseconds of a strict YYYY-MM-DD calendar date, or null. */
export function calendar(v: unknown): number | null {
  if (
    typeof v !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    v.startsWith('0000')
  )
    return null;
  const value = Date.parse(v + 'T00:00:00Z');
  return Number.isFinite(value) &&
    new Date(value).toISOString().slice(0, 10) === v
    ? value
    : null;
}
function quoteTimestamp(v: unknown): boolean {
  if (
    typeof v !== 'string' ||
    v.length > 64 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      v,
    )
  )
    return false;
  const time = v.slice(11).match(/^(\d{2}):(\d{2})(?::(\d{2}))?/)!;
  const offset = v.match(/[+-](\d{2}):(\d{2})$/);
  return (
    calendar(v.slice(0, 10)) !== null &&
    +time[1] < 24 &&
    +time[2] < 60 &&
    +(time[3] ?? 0) < 60 &&
    (!offset || (+offset[1] < 24 && +offset[2] < 60)) &&
    Number.isFinite(Date.parse(v))
  );
}

/** Mirrors canonical ACT/365 resolution; invalid dates remain NaN, never zero. */
export function resolvedLegDays(
  strategy: OptionsDraft['strategy'],
  leg: OptionsDraft['strategy']['legs'][number],
): number {
  if (leg.expiry_date != null) {
    const start = calendar(strategy.valuation_date),
      end = calendar(leg.expiry_date);
    return start === null || end === null ? NaN : (end - start) / 86400000;
  }
  return leg.days_to_expiry ?? strategy.days_to_expiry;
}

export function firstExpiryDays(draft: OptionsDraft): number {
  const horizons = draft.strategy.legs
    .filter(l => l.enabled && l.kind !== 'underlying')
    .map(l => resolvedLegDays(draft.strategy, l));
  return horizons.length
    ? Math.min(...horizons)
    : draft.strategy.days_to_expiry;
}

export function optionsErrors(d: OptionsDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (Array.isArray(d?.strategy?.legs) && d.strategy.legs.length > 16)
    return { legs: 'Use 1–16 legs.' };
  if (Array.isArray(d?.spot_grid) && d.spot_grid.length > 201)
    return { spot_grid: 'Use 2–201 spots.' };
  if (Array.isArray(d?.scenarios) && d.scenarios.length > 3)
    return { scenarios: 'Use at most 3 scenarios.' };
  if (Array.isArray(d?.surface?.spots) && d.surface.spots.length > 41)
    return { 'surface.spots': 'Use 2–41 spots.' };
  if (Array.isArray(d?.surface?.steps) && d.surface.steps.length > 21)
    return { 'surface.steps': 'Use 2–21 steps.' };
  if (!workingDraftShape(d, false))
    return {
      draft:
        'Incomplete or unsupported draft structure; use only bounded canonical fields.',
    };
  const number = (
    key: string,
    v: number,
    min: number,
    max: number,
    integer = false,
  ) => {
    if (
      !Number.isFinite(v) ||
      v < min ||
      v > max ||
      (integer && !Number.isInteger(v))
    )
      errors[key] =
        `${integer ? 'Integer' : 'Number'} required, ${min === Number.MIN_VALUE ? '>0' : min} to ${max}.`;
  };
  const name = (key: string, v: string, max: number) => {
    if (!v.trim() || v.length > max)
      errors[key] = `Enter a nonblank name (up to ${max} characters).`;
  };
  name('strategy.name', d.strategy.name, 120);
  if (d.strategy.underlying != null)
    name('strategy.underlying', d.strategy.underlying, 80);
  if (
    d.strategy.currency !== 'USD' ||
    d.strategy.exercise_style !== 'european' ||
    d.strategy.settlement !== 'cash'
  )
    errors.strategy = 'Only USD European cash-settled research is supported.';
  if (
    ![
      'custom',
      'long_call',
      'long_put',
      'call_vertical',
      'put_vertical',
      'straddle',
      'strangle',
      'iron_condor',
      'iron_butterfly',
      'covered_call',
      'protective_put',
      'calendar',
      'diagonal',
    ].includes(d.strategy.template)
  )
    errors.strategy = 'Unknown template label.';
  number('strategy.days_to_expiry', d.strategy.days_to_expiry, 0, 3650);
  number(
    'strategy.entry_fee_per_contract',
    d.strategy.entry_fee_per_contract,
    0,
    10000,
  );
  const valuation = d.strategy.valuation_date,
    expiry = d.strategy.expiry_date;
  if (valuation != null || expiry != null) {
    const start = calendar(valuation),
      end = calendar(expiry);
    if (start === null)
      errors['strategy.valuation_date'] =
        'Supply paired valid YYYY-MM-DD calendar dates.';
    if (
      valuation != null &&
      expiry == null &&
      !d.strategy.legs.some(l => l.expiry_date != null)
    )
      errors['strategy.expiry_date'] =
        'Valuation date requires a common or per-leg expiry date.';
    if (expiry != null && end === null)
      errors['strategy.expiry_date'] =
        'Supply paired valid YYYY-MM-DD calendar dates.';
    if (
      start !== null &&
      end !== null &&
      (end < start || (end - start) / 86400000 !== d.strategy.days_to_expiry)
    )
      errors['strategy.expiry_date'] =
        'Dates must exactly match the nonnegative common days to expiry.';
  }
  number('spot', d.spot, Number.MIN_VALUE, 1000000);
  number('volatility', d.volatility, 0, 5);
  number('rate', d.rate, -1, 1);
  number('dividend_yield', d.dividend_yield, -1, 1);
  if (!d.strategy.legs.length || !d.strategy.legs.some(l => l.enabled))
    errors.legs = 'Use 1–16 legs, with at least one enabled.';
  d.strategy.legs.forEach((l, i) => {
    const key = `legs.${i}`;
    if (!['call', 'put', 'underlying'].includes(l.kind))
      errors[`${key}.kind`] = 'Choose call, put or underlying.';
    number(
      `${key}.quantity`,
      l.quantity,
      l.kind === 'underlying' ? -1000000 : -10000,
      l.kind === 'underlying' ? 1000000 : 10000,
      true,
    );
    if (l.quantity === 0)
      errors[`${key}.quantity`] =
        'Quantity cannot be zero; use positive buy or negative sell.';
    number(`${key}.entry_premium`, l.entry_premium, 0, 1000000);
    number(`${key}.multiplier`, l.multiplier, 1, 1000, true);
    if (l.kind === 'underlying') {
      if (l.days_to_expiry != null || l.expiry_date != null || l.source != null)
        errors[`${key}.expiry_date`] =
          'Underlying has no expiry override or option contract source.';
      if (l.strike !== null || l.multiplier !== 1)
        errors[`${key}.multiplier`] =
          'Underlying uses no strike and multiplier 1.';
      if (
        [l.implied_volatility, l.bid, l.ask, l.quote_as_of].some(v => v != null)
      )
        errors[`${key}.implied_volatility`] =
          'Underlying legs cannot carry option IV or quote metadata.';
    } else
      number(`${key}.strike`, l.strike as number, Number.MIN_VALUE, 1000000);
    if (l.days_to_expiry != null)
      number(`${key}.days_to_expiry`, l.days_to_expiry, 0, 3650);
    if (l.kind !== 'underlying') {
      const days = resolvedLegDays(d.strategy, l);
      number(`${key}.expiry_date`, days, 0, 3650);
      if (
        l.expiry_date != null &&
        l.days_to_expiry != null &&
        days !== l.days_to_expiry
      )
        errors[`${key}.expiry_date`] =
          'Leg dates must exactly match its days override.';
    }
    if (l.source != null) {
      const s = l.source;
      if (
        s.provider !== 'tradier' ||
        !['production', 'sandbox'].includes(s.environment) ||
        !s.contract_symbol.trim() ||
        s.contract_symbol.length > 80 ||
        !s.underlying.trim() ||
        s.underlying.length > 80 ||
        !quoteTimestamp(s.fetched_at) ||
        (s.bid_as_of != null && !quoteTimestamp(s.bid_as_of)) ||
        (s.ask_as_of != null && !quoteTimestamp(s.ask_as_of)) ||
        (s.observed_exercise_style !== undefined &&
          !['american', 'european', 'unknown'].includes(
            s.observed_exercise_style,
          )) ||
        (s.observed_settlement !== undefined &&
          !['cash', 'physical', 'unknown'].includes(s.observed_settlement))
      )
        errors[`${key}.source`] =
          'Invalid bounded contract identity/provenance; unknown classification stays unknown.';
    }
    if (l.implied_volatility != null)
      number(`${key}.implied_volatility`, l.implied_volatility, 0, 5);
    if (l.bid != null) number(`${key}.bid`, l.bid, 0, 1000000);
    if (l.ask != null) number(`${key}.ask`, l.ask, 0, 1000000);
    if (
      (l.bid == null) !== (l.ask == null) ||
      (l.bid != null && (l.bid > l.ask! || l.quote_as_of == null))
    )
      errors[`${key}.bid`] =
        'Pair bid/ask, bid ≤ ask, with an explicit timezone-aware quote timestamp.';
    if (l.quote_as_of != null && !quoteTimestamp(l.quote_as_of))
      errors[`${key}.quote_as_of`] =
        'Use a valid ISO timestamp with T and Z or ±HH:MM timezone.';
  });
  const increasing = (
    key: string,
    values: number[],
    maxLength: number,
    min: number,
    max: number,
  ) => {
    if (
      values.length < 2 ||
      values.length > maxLength ||
      values.some(
        (v, i) =>
          !Number.isFinite(v) ||
          v < min ||
          v > max ||
          (i > 0 && v <= values[i - 1]),
      )
    )
      errors[key] =
        `Use 2–${maxLength} strictly increasing values, ${min} to ${max}.`;
  };
  increasing('spot_grid', d.spot_grid, 201, 0, 1000000);
  const ivs = [
    d.volatility,
    ...d.strategy.legs
      .filter(l => l.enabled && l.kind !== 'underlying')
      .map(l => l.implied_volatility ?? d.volatility),
  ];
  const shift = (key: string, value: number) => {
    number(key, value, -100, 100);
    if (
      ivs.some(
        iv =>
          !Number.isFinite(iv + value / 100) ||
          iv + value / 100 < 0 ||
          iv + value / 100 > 5,
      )
    )
      errors[key] =
        'Every shifted enabled option IV and declared IV must stay between 0% and 500%.';
  };
  const names = new Set<string>();
  d.scenarios.forEach((s, i) => {
    const key = `scenarios.${i}`;
    name(`${key}.name`, s.name, 80);
    if (names.has(s.name))
      errors[`${key}.name`] = 'Scenario names must be unique.';
    names.add(s.name);
    number(`${key}.elapsed_days`, s.elapsed_days, 0, firstExpiryDays(d));
    shift(`${key}.iv_shift_pp`, s.iv_shift_pp);
  });
  if (d.surface != null) {
    const s = d.surface;
    if (!['elapsed_days', 'iv_shift_pp'].includes(s.axis))
      errors['surface.axis'] = 'Choose elapsed_days or iv_shift_pp.';
    increasing('surface.spots', s.spots, 41, 0, 1000000);
    increasing(
      'surface.steps',
      s.steps,
      21,
      s.axis === 'elapsed_days' ? 0 : -100,
      s.axis === 'elapsed_days' ? firstExpiryDays(d) : 100,
    );
    if (s.axis === 'iv_shift_pp')
      s.steps.forEach(v => shift('surface.steps', v));
  }
  return errors;
}

import type { GreekKey, OptionsAnalysis } from './optionsTypes';

export interface Domain {
  min: number;
  max: number;
}
export interface ChartPoint {
  spot: number;
  value: number;
}
export interface ChartSeries {
  id: string;
  label: string;
  tone: 'expiry' | 'today' | 'scenario1' | 'scenario2' | 'scenario3';
  dash: string;
  spots: number[];
  values: (number | null)[];
  /** Exact piecewise-linear vertices: values between them are linear, not estimated. */
  exactPolyline?: boolean;
}
export interface PriceMarker {
  spot: number;
  label: string;
  kind: 'strike' | 'spot' | 'breakeven';
}

export const GREEK_KEYS: GreekKey[] = [
  'delta',
  'gamma',
  'theta',
  'vega',
  'rho',
];

export function finiteValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function priceDomain(grid: number[]): Domain | null {
  const finite = grid.filter(s => finiteValue(s) && s >= 0);
  if (finite.length < 2) return null;
  const min = Math.min(...finite),
    max = Math.max(...finite);
  return min < max ? { min, max } : null;
}

export function validateDomain(
  min: number,
  max: number,
  full: Domain,
): Domain | null {
  return finiteValue(min) &&
    finiteValue(max) &&
    min >= full.min &&
    max <= full.max &&
    min < max
    ? { min, max }
    : null;
}

/** A user's zoom survives a new analysis while the new price grid still covers it. */
export function keepView(
  view: Domain | null,
  full: Domain | null,
): Domain | null {
  return view && full && view.min >= full.min && view.max <= full.max
    ? view
    : null;
}

export function zoomDomain(
  domain: Domain,
  full: Domain,
  factor: number,
  anchor?: number,
): Domain {
  if (!finiteValue(factor) || factor <= 0) return domain;
  const center = finiteValue(anchor)
    ? Math.max(domain.min, Math.min(domain.max, anchor))
    : (domain.min + domain.max) / 2;
  const width = Math.min(
    full.max - full.min,
    Math.max((full.max - full.min) / 1000, (domain.max - domain.min) * factor),
  );
  const min = Math.max(
    full.min,
    Math.min(full.max - width, center - width / 2),
  );
  return { min, max: min + width };
}

/** Straight segments join supplied values only; gaps break paths. */
export function seriesPoints(
  grid: number[],
  values: (number | null)[],
): (ChartPoint | null)[] {
  return grid.map((spot, i) =>
    finiteValue(spot) && spot >= 0 && finiteValue(values[i])
      ? { spot, value: values[i] as number }
      : null,
  );
}

export function optionsSeries(result: OptionsAnalysis): ChartSeries[] {
  const scenarios: ChartSeries['tone'][] = [
    'scenario1',
    'scenario2',
    'scenario3',
  ];
  return [
    ...(result.horizon?.kind === 'mixed_expiry' &&
    result.horizon_pnl?.length === result.spot_grid.length
      ? [
          {
            id: 'horizon',
            label: `First expiry · day ${result.horizon.first_expiry_days} · later legs model-marked`,
            tone: 'expiry' as const,
            dash: '4 3',
            spots: result.spot_grid,
            values: result.horizon_pnl,
          },
        ]
      : []),
    ...(!expiryTraceError(result)
      ? [
          {
            id: 'expiry',
            label: 'Expiration',
            tone: 'expiry' as const,
            dash: '',
            spots: result.expiry_curve!.map(p => p.spot),
            values: result.expiry_curve!.map(p => p.pnl),
            exactPolyline: true,
          },
        ]
      : []),
    {
      id: 'today',
      label: 'Today',
      tone: 'today',
      dash: '7 4',
      spots: result.spot_grid,
      values: result.today_pnl,
    },
    ...result.scenarios.map((s, i) => ({
      id: `scenario-${i}`,
      label: s.name,
      tone: scenarios[i % 3],
      dash: ['2 4', '10 3 2 3', '12 5'][i % 3],
      spots: result.spot_grid,
      values: s.pnl,
    })),
  ];
}

export function greekSeries(
  result: OptionsAnalysis,
  greek: GreekKey,
): ChartSeries[] {
  return [
    {
      id: `greek-${greek}`,
      label: `Today ${greek}`,
      tone: 'today',
      dash: '7 4',
      spots: result.spot_grid,
      values: (result.greeks_grid ?? []).map(g => g[greek]),
    },
  ];
}

export function greekPlotError(
  result: OptionsAnalysis,
  greek: GreekKey,
): string | null {
  if (
    !Array.isArray(result.greeks_grid) ||
    result.greeks_grid.length !== result.spot_grid.length
  ) {
    return 'Greek curve unavailable: the backend must return greeks_grid aligned with spot_grid.';
  }
  if (!result.greeks_grid.some(g => finiteValue(g[greek]))) {
    return `${greek} unavailable across this grid (expiry, zero IV or numerical singularity). Undefined Greeks are not zero.`;
  }
  return null;
}

export function plotError(result: OptionsAnalysis): string | null {
  if (!priceDomain(result.spot_grid))
    return 'No usable price domain: at least two distinct finite nonnegative spots are required.';
  if (
    result.spot_grid.some(
      (s, i, grid) => !finiteValue(s) || s < 0 || (i > 0 && s <= grid[i - 1]),
    )
  ) {
    return 'The returned price grid is invalid or not strictly increasing.';
  }
  if (optionsSeries(result).some(s => s.values.length !== s.spots.length)) {
    return 'Returned P&L series do not align with the price grid.';
  }
  if (!optionsSeries(result).some(s => s.values.some(finiteValue)))
    return 'No finite P&L values were returned.';
  return null;
}

export function expiryTraceError(result: OptionsAnalysis): string | null {
  if (
    result.horizon?.kind === 'mixed_expiry' ||
    result.horizon?.exact_terminal_available === false
  )
    return 'Mixed-expiry horizon: no exact terminal trace, maxima or breakevens. First-expiry values mark later legs; use lifecycle research for settlement transitions.';
  const curve = result.expiry_curve;
  const full = priceDomain(result.spot_grid);
  const unavailable =
    'Exact expiry trace unavailable: canonical expiry_curve vertices are required; sampled expiry values are not a safe fallback across strikes.';
  if (!full || !Array.isArray(curve) || curve.length < 2) return unavailable;
  if (
    Array.from(curve).some(
      (p, i) =>
        !p ||
        !finiteValue(p.spot) ||
        !finiteValue(p.pnl) ||
        p.spot < full.min ||
        p.spot > full.max ||
        (i > 0 && p.spot <= curve[i - 1].spot),
    ) ||
    curve[0].spot !== full.min ||
    curve[curve.length - 1].spot !== full.max
  )
    return unavailable;
  const required = [
    ...result.request.strategy.legs
      .filter(l => l.enabled && l.kind !== 'underlying')
      .map(l => l.strike),
    ...result.summary.breakevens,
  ].filter(
    (s): s is number => finiteValue(s) && s >= full.min && s <= full.max,
  );
  return required.some(s => !curve.some(p => p.spot === s))
    ? unavailable
    : null;
}

/** Exact lookup, plus linear values between the vertices of an exact polyline; never extrapolates. */
export function seriesValue(
  series: ChartSeries,
  spot: number,
): number | null | undefined {
  const index = series.spots.indexOf(spot);
  if (index >= 0 || !series.exactPolyline) return series.values[index];
  const next = series.spots.findIndex(s => s > spot);
  if (next <= 0) return undefined;
  const a = series.values[next - 1],
    b = series.values[next];
  if (!finiteValue(a) || !finiteValue(b)) return undefined;
  const x0 = series.spots[next - 1],
    x1 = series.spots[next];
  return a + ((b - a) * (spot - x0)) / (x1 - x0);
}

export function inspectionGrid(result: OptionsAnalysis): number[] {
  return [...new Set(optionsSeries(result).flatMap(s => s.spots))].sort(
    (a, b) => a - b,
  );
}

export function legBreakdownError(result: OptionsAnalysis): string | null {
  return !Array.isArray(result.legs) ||
    result.legs.length !== result.request.strategy.legs.length ||
    Array.from(result.legs).some(
      (l, i) =>
        !l ||
        l.leg_index !== i ||
        l.enabled !== result.request.strategy.legs[i].enabled,
    )
    ? 'Per-leg breakdown unavailable: backend leg identities must match the submitted strategy.'
    : null;
}

export function priceMarkers(result: OptionsAnalysis): PriceMarker[] {
  const strikes = [
    ...new Set(
      result.request.strategy.legs
        .filter(
          l => l.enabled && l.kind !== 'underlying' && finiteValue(l.strike),
        )
        .map(l => l.strike as number),
    ),
  ];
  return [
    ...strikes.map(spot => ({
      spot,
      label: `Strike ${exactValue(spot)} USD`,
      kind: 'strike' as const,
    })),
    {
      spot: result.request.spot,
      label: `Submitted spot ${exactValue(result.request.spot)} USD`,
      kind: 'spot' as const,
    },
    ...(result.horizon?.exact_terminal_available === false
      ? []
      : result.summary.breakevens
    ).map(spot => ({
      spot,
      label: `Expiration breakeven ${exactValue(spot)} USD`,
      kind: 'breakeven' as const,
    })),
  ].filter(m => finiteValue(m.spot) && m.spot >= 0);
}

/** Submitted spot and enabled strikes the visible price range does not show. */
export function outsideView(
  result: OptionsAnalysis,
  domain: Domain,
): { spot: boolean; strikes: number[] } {
  const out = (price: number) => price < domain.min || price > domain.max;
  return {
    spot: finiteValue(result.request.spot) && out(result.request.spot),
    strikes: priceMarkers(result)
      .filter(m => m.kind === 'strike' && out(m.spot))
      .map(m => m.spot),
  };
}

export function scaleValue(
  value: number,
  domain: Domain,
  start: number,
  end: number,
): number {
  const span = domain.max - domain.min;
  const fraction = Number.isFinite(span)
    ? (value - domain.min) / span
    : (value / 2 - domain.min / 2) / (domain.max / 2 - domain.min / 2);
  return start + fraction * (end - start);
}

/** Include adjacent segment endpoints for clipping at numeric zoom boundaries. */
export function sampledYDomain(
  series: (ChartPoint | null)[][],
  domain: Domain,
): Domain {
  const values = [0];
  for (const points of series) {
    points.forEach((p, i) => {
      if (!p) return;
      const prev = points[i - 1],
        next = points[i + 1];
      if (
        (p.spot >= domain.min && p.spot <= domain.max) ||
        (prev && prev.spot < domain.max && p.spot > domain.min) ||
        (next && p.spot < domain.max && next.spot > domain.min)
      )
        values.push(p.value);
    });
  }
  const min = Math.min(...values),
    max = Math.max(...values);
  const pad = Math.max(Number.MIN_VALUE, max * 0.12 - min * 0.12 || 0.12);
  return {
    min: Math.max(-Number.MAX_VALUE, min - pad),
    max: Math.min(Number.MAX_VALUE, max + pad),
  };
}

export function svgPath(
  points: (ChartPoint | null)[],
  x: Domain,
  y: Domain,
  width: number,
  top: number,
  bottom: number,
): string {
  let connected = false;
  return points
    .map(p => {
      if (!p) {
        connected = false;
        return '';
      }
      const command = connected ? 'L' : 'M';
      connected = true;
      return `${command}${scaleValue(p.spot, x, 0, width).toFixed(3)},${scaleValue(p.value, y, bottom, top).toFixed(3)}`;
    })
    .filter(Boolean)
    .join(' ');
}

/** Ticks on round 1/2/2.5/5 × 10ⁿ steps inside the domain; zero is one whenever it is in range. */
export function niceTicks(domain: Domain, count: number): number[] {
  const span = domain.max - domain.min;
  if (!finiteValue(span) || span <= 0 || count < 1) return [];
  const magnitude = 10 ** Math.floor(Math.log10(span / count));
  const step =
    [1, 2, 2.5, 5, 10].map(m => m * magnitude).find(s => span / s <= count) ??
    10 * magnitude;
  const ticks: number[] = [];
  for (
    let i = Math.ceil(domain.min / step);
    i * step <= domain.max + step * 1e-9;
    i++
  )
    ticks.push(Number((i * step).toPrecision(12)) || 0);
  return ticks;
}

/** A polyline closed against the zero line, for profit and loss fills; '' when it has gaps. */
export function fillPath(
  points: (ChartPoint | null)[],
  x: Domain,
  y: Domain,
  width: number,
  top: number,
  bottom: number,
): string {
  if (points.length < 2 || points.some(p => !p)) return '';
  const first = points[0]!,
    last = points[points.length - 1]!;
  const zero = scaleValue(0, y, bottom, top).toFixed(3);
  return `${svgPath(points, x, y, width, top, bottom)} L${scaleValue(last.spot, x, 0, width).toFixed(3)},${zero} L${scaleValue(first.spot, x, 0, width).toFixed(3)},${zero} Z`;
}

export function domainTicks(domain: Domain, count = 3): number[] {
  return Array.from({ length: count }, (_, i) => {
    const fraction = i / (count - 1);
    return domain.min * (1 - fraction) + domain.max * fraction;
  });
}

export function nearestIndex(
  grid: number[],
  spot: number,
  domain: Domain,
): number | null {
  let nearest: number | null = null,
    distance = Infinity;
  grid.forEach((s, i) => {
    if (!finiteValue(s) || s < domain.min || s > domain.max) return;
    const d = Math.abs(s - spot);
    if (d < distance) {
      nearest = i;
      distance = d;
    }
  });
  return nearest;
}

export function keyboardIndex(
  grid: number[],
  domain: Domain,
  current: number | null,
  key: string,
): number | null | undefined {
  if (key === 'Escape') return null;
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key))
    return undefined;
  const indices = grid
    .map((s, i) =>
      finiteValue(s) && s >= domain.min && s <= domain.max ? i : -1,
    )
    .filter(i => i >= 0);
  if (!indices.length) return null;
  if (key === 'Home') return indices[0];
  if (key === 'End') return indices[indices.length - 1];
  const position = current == null ? -1 : indices.indexOf(current);
  if (position < 0)
    return key === 'ArrowLeft' ? indices[indices.length - 1] : indices[0];
  return indices[
    Math.max(
      0,
      Math.min(indices.length - 1, position + (key === 'ArrowLeft' ? -1 : 1)),
    )
  ];
}

export function exactValue(
  value: number | null | undefined,
  signed = false,
): string {
  if (!finiteValue(value)) return 'Unavailable';
  return signed && value > 0 ? `+${value}` : String(value);
}

/** `span` is the axis range: values within 1e-9 of it from zero print as 0, not 4.1e-57. */
export function axisValue(value: number, span?: number): string {
  if (!finiteValue(value)) return '—';
  if (finiteValue(span) && Math.abs(value) < Math.abs(span) * 1e-9) return '0';
  if (value !== 0 && (Math.abs(value) < 0.01 || Math.abs(value) >= 10000))
    return value.toExponential(1);
  return Number(value.toPrecision(4)).toString();
}

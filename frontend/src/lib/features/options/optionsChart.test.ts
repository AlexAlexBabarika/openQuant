import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import OptionsCharts from '../../../components/options/OptionsCharts.svelte';
import {
  axisValue,
  domainTicks,
  exactValue,
  greekPlotError,
  greekSeries,
  keyboardIndex,
  nearestIndex,
  optionsSeries,
  plotError,
  priceDomain,
  priceMarkers,
  sampledYDomain,
  scaleValue,
  seriesPoints,
  svgPath,
  validateDomain,
  zoomDomain,
  expiryTraceError,
  inspectionGrid,
  seriesValue,
  legBreakdownError,
  outsideView,
} from './optionsChart';
import type { OptionsAnalysis } from './optionsTypes';

const greeks = { delta: 12.5, gamma: 0.25, theta: -0.001, vega: 4, rho: null };
const result: OptionsAnalysis = {
  request: {
    strategy: {
      name: 'Call',
      template: 'long_call',
      days_to_expiry: 30,
      currency: 'USD',
      exercise_style: 'european',
      settlement: 'cash',
      entry_fee_per_contract: 1,
      legs: [
        {
          kind: 'call',
          quantity: 1,
          strike: 100,
          entry_premium: 5,
          multiplier: 100,
          enabled: true,
        },
        {
          kind: 'put',
          quantity: 1,
          strike: 70,
          entry_premium: 0,
          multiplier: 100,
          enabled: false,
        },
        {
          kind: 'underlying',
          quantity: 100,
          strike: null,
          entry_premium: 100,
          multiplier: 1,
          enabled: true,
        },
      ],
    },
    spot: 100,
    volatility: 0.2,
    rate: 0.03,
    dividend_yield: 0,
    spot_grid: [80, 100, 120],
    scenarios: [{ name: 'Later', elapsed_days: 5, iv_shift_pp: 5 }],
  },
  model: {
    name: 'black_scholes_merton',
    version: '1',
    input_source: 'manual',
    exercise_style: 'european',
    settlement: 'cash',
    day_basis: 'ACT/365',
  },
  summary: {
    gross_entry_cost: 500,
    entry_fees: 1,
    net_entry_cost: 501,
    entry_debit: 501,
    entry_credit: 0,
    theoretical_value_today: 600,
    pnl_today: 99,
    max_profit: null,
    max_loss: 501,
    profit_unbounded: true,
    loss_unbounded: false,
    breakevens: [105.01, 150],
    zero_intervals: [],
  },
  spot_grid: [80, 100, 120],
  today_pnl: [-490.1, 99, 1600.55],
  expiry_pnl: [-501, -501, 1499],
  expiry_curve: [
    { spot: 80, pnl: -501 },
    { spot: 100, pnl: -501 },
    { spot: 105.01, pnl: 0 },
    { spot: 120, pnl: 1499 },
  ],
  scenarios: [
    {
      name: 'Later',
      elapsed_days: 5,
      remaining_days: 25,
      volatility: 0.25,
      pnl: [-480, 120, 1700],
      greeks,
    },
  ],
  greeks,
  greeks_grid: [{ ...greeks, delta: 2 }, greeks, { ...greeks, delta: 90 }],
  greek_units: {
    delta: 'USD per USD spot (equivalent shares)',
    gamma: 'delta per USD spot',
    theta: 'USD per calendar day elapsed',
    vega: 'USD per 1 volatility percentage point',
    rho: 'USD per 1 rate percentage point',
  },
  warnings: [],
};

describe('options numeric price-domain renderer', () => {
  it('uses a finite price domain, not times, and rejects empty/constant domains', () => {
    expect(priceDomain([NaN, -1, 0, 80, 200, Infinity])).toEqual({
      min: 0,
      max: 200,
    });
    expect(priceDomain([100, 100])).toBeNull();
    expect(priceDomain([])).toBeNull();
    expect(priceDomain([NaN, 10])).toBeNull();
    expect(scaleValue(100, { min: 80, max: 120 }, 0, 240)).toBe(120);
  });
  it('keeps exact Python arrays and labels/dashes distinct without changing values', () => {
    const s = optionsSeries(result);
    expect(s.map(v => v.label)).toEqual(['Expiration', 'Today', 'Later']);
    expect(new Set(s.map(v => v.dash)).size).toBe(3);
    expect(s[0].values).toEqual(result.expiry_curve!.map(p => p.pnl));
    expect(s[0].spots).toEqual([80, 100, 105.01, 120]);
    expect(s[1].values).toBe(result.today_pnl);
    expect(s[2].values).toBe(result.scenarios[0].pnl);
  });
  it('renders gaps rather than connecting undefined, nonfinite or missing values', () => {
    const p = seriesPoints(
      [0, 10, 20, 30, 40, 50],
      [1, null, NaN, Infinity, 4],
    );
    expect(p).toEqual([
      { spot: 0, value: 1 },
      null,
      null,
      null,
      { spot: 40, value: 4 },
      null,
    ]);
    const path = svgPath(
      p,
      { min: 0, max: 50 },
      { min: 0, max: 5 },
      250,
      0,
      100,
    );
    expect(path).toBe('M0.000,80.000 M200.000,20.000');
    expect(path).not.toMatch(/NaN|Infinity/);
  });
  it('validates wire array alignment and grid ordering before plotting', () => {
    expect(plotError(result)).toBeNull();
    expect(plotError({ ...result, today_pnl: [1] })).toContain('align');
    expect(plotError({ ...result, spot_grid: [100, 80, 120] })).toContain(
      'increasing',
    );
    expect(plotError({ ...result, spot_grid: [] })).toContain('domain');
    expect(
      plotError({
        ...result,
        today_pnl: [NaN, NaN, NaN],
        expiry_pnl: [Infinity, Infinity, Infinity],
        expiry_curve: undefined,
        scenarios: [],
      }),
    ).toContain('finite');
  });
  it('only displays enabled option strikes and returned spot/true expiry roots', () => {
    expect(priceMarkers(result).map(v => [v.kind, v.spot])).toEqual([
      ['strike', 100],
      ['spot', 100],
      ['breakeven', 105.01],
      ['breakeven', 150],
    ]);
    expect(result.summary.max_profit).toBeNull();
    expect(priceMarkers(result).find(m => m.spot === 150)).toBeTruthy();
  });
  it('uses only returned today Greek grid; nulls remain unavailable, including expiry', () => {
    expect(greekSeries(result, 'delta')[0].values).toEqual([2, 12.5, 90]);
    expect(greekSeries(result, 'rho')[0].values).toEqual([null, null, null]);
    expect(greekPlotError(result, 'rho')).toContain('not zero');
    expect(greekPlotError(result, 'delta')).toBeNull();
    expect(greekPlotError({ ...result, greeks_grid: [] }, 'delta')).toContain(
      'aligned',
    );
    const legacy = { ...result };
    delete (legacy as Partial<OptionsAnalysis>).greeks_grid;
    expect(greekPlotError(legacy, 'delta')).toContain('backend');
    expect(greekSeries(legacy, 'delta')[0].values).toEqual([]);
  });
  it('padded sample bounds include zero and adjacent clipped segments, not risk limits', () => {
    const y = sampledYDomain(
      [seriesPoints([0, 10, 20, 30], [-100, 0, 100, 0])],
      { min: 12, max: 18 },
    );
    expect(y.min).toBeLessThan(0);
    expect(y.max).toBeGreaterThanOrEqual(100);
    expect(sampledYDomain([[null]], { min: 0, max: 1 })).toEqual({
      min: -0.12,
      max: 0.12,
    });
    expect(
      sampledYDomain([seriesPoints([0, 1], [1e-9, 2e-9])], { min: 0, max: 1 })
        .max,
    ).toBeCloseTo(2.24e-9, 16);
  });
  it('clips by SVG coordinates without extrapolating new financial values', () => {
    const path = svgPath(
      seriesPoints([0, 20], [-10, 10]),
      { min: 5, max: 15 },
      { min: -10, max: 10 },
      200,
      0,
      100,
    );
    expect(path).toBe('M-100.000,100.000 L300.000,0.000');
    expect(domainTicks({ min: 5, max: 15 })).toEqual([5, 10, 15]);
  });
  it('requires ordered bounded numeric zoom fields and clamps zoom/reset to supplied grid', () => {
    const full = { min: 0, max: 200 };
    expect(validateDomain(50, 150, full)).toEqual({ min: 50, max: 150 });
    for (const [a, b] of [
      [100, 100],
      [150, 50],
      [-1, 100],
      [0, 201],
      [NaN, 100],
    ])
      expect(validateDomain(a, b, full)).toBeNull();
    expect(zoomDomain(full, full, 0.5, 0)).toEqual({ min: 0, max: 100 });
    expect(zoomDomain({ min: 50, max: 150 }, full, 2)).toEqual(full);
    expect(zoomDomain(full, full, 0)).toEqual(full);
    expect(
      zoomDomain(full, full, 1e-9).max - zoomDomain(full, full, 1e-9).min,
    ).toBeCloseTo(0.2);
  });
  it('hover snaps to supplied samples only inside view and returns no sample for gaps', () => {
    expect(nearestIndex([0, 10, 20], 8, { min: 0, max: 20 })).toBe(1);
    expect(nearestIndex([0, 10, 20], 8, { min: 12, max: 18 })).toBeNull();
    expect(nearestIndex([NaN, 10, 20], 0, { min: 0, max: 20 })).toBe(1);
  });
  it('keyboard selection respects zoom and Home/End/Escape without intercepting other keys', () => {
    const grid = [0, 10, 20, 30],
      domain = { min: 10, max: 20 };
    expect(keyboardIndex(grid, domain, null, 'ArrowRight')).toBe(1);
    expect(keyboardIndex(grid, domain, null, 'ArrowLeft')).toBe(2);
    expect(keyboardIndex(grid, domain, 1, 'ArrowRight')).toBe(2);
    expect(keyboardIndex(grid, domain, 1, 'ArrowLeft')).toBe(1);
    expect(keyboardIndex(grid, domain, 1, 'End')).toBe(2);
    expect(keyboardIndex(grid, domain, 2, 'Home')).toBe(1);
    expect(keyboardIndex(grid, domain, 2, 'Escape')).toBeNull();
    expect(keyboardIndex(grid, domain, 2, 'Tab')).toBeUndefined();
    expect(keyboardIndex(grid, { min: 12, max: 18 }, 1, 'Home')).toBeNull();
  });
  it('keeps raw exact signed readouts and never rounds tiny nonzero values to zero', () => {
    expect(exactValue(0.123456789, true)).toBe('+0.123456789');
    expect(exactValue(-1e-15, true)).toBe('-1e-15');
    expect(exactValue(null)).toBe('Unavailable');
    expect(exactValue(NaN)).toBe('Unavailable');
    expect(exactValue(0, true)).toBe('0');
    expect(axisValue(1e-15)).toBe('1.0e-15');
    expect(axisValue(123456)).toBe('1.2e+5');
    expect(axisValue(0)).toBe('0');
  });
  it('keeps extreme finite Greek scales and coordinates finite', () => {
    const pts = seriesPoints([0, 1], [-Number.MAX_VALUE, Number.MAX_VALUE]);
    const domain = sampledYDomain([pts], { min: 0, max: 1 });
    expect(Number.isFinite(domain.min)).toBe(true);
    expect(Number.isFinite(domain.max)).toBe(true);
    expect(domainTicks(domain)).toEqual([
      -Number.MAX_VALUE,
      0,
      Number.MAX_VALUE,
    ]);
    expect(svgPath(pts, { min: 0, max: 1 }, domain, 200, 0, 100)).not.toMatch(
      /NaN|Infinity/,
    );
  });
});

describe('options chart markup (shell SSR, not browser validation)', () => {
  const markup = (analysis: OptionsAnalysis | null, spot?: number) =>
    render(OptionsCharts, { props: { result: analysis, spot } }).body;

  it('provides empty and misaligned-data feedback rather than empty chart success', () => {
    expect(markup(null)).toContain('Analyze manual inputs');
    expect(markup({ ...result, today_pnl: [] })).toContain(
      'Chart data unavailable',
    );
  });
  it('exposes labelled price/Greek axes, named series, clips, zoom and keyboard controls', () => {
    const html = markup(result);
    expect(html).toContain('Underlying price (USD)');
    expect(html).toContain('Greek exposure by price');
    expect(html).toContain('USD per USD spot (equivalent shares)');
    expect(html).toContain('Apply view');
    expect(html).toContain('Zoom in price domain');
    expect(html).toContain('Reset');
    expect(html.match(/role="slider"/g)).toHaveLength(2);
    expect(html.match(/clipPath /g)).toHaveLength(2);
    expect(html).not.toMatch(/(?:d|cx|cy|x|y)="(?:NaN|Infinity)/);
  });
  it('keeps out-of-view true roots/unbounded geometry and all raw samples in data equivalent', () => {
    const html = markup(result);
    expect(html).toContain('Unbounded');
    expect(html).toContain('105.01, 150');
    expect(html).toContain('+1600.55');
    expect(html).toContain('Exact-value data');
    expect(html).toContain('Sampled chart bounds are not risk limits');
  });
  it('makes unavailable Greek extension and null curves explicit without zeros', () => {
    const legacy = { ...result };
    delete (legacy as Partial<OptionsAnalysis>).greeks_grid;
    expect(markup(legacy)).toContain('backend must return greeks_grid');
    expect(
      markup({
        ...result,
        greeks_grid: result.greeks_grid.map(g => ({ ...g, delta: null })),
      }),
    ).toContain('Undefined Greeks are not zero');
  });
  it('flags optional draft spot drift without changing the submitted evidence context', () => {
    const html = markup(result, 999);
    expect(html).toContain('Draft spot changed');
    expect(html).toContain('submitted spot 100 USD');
    expect(html).not.toContain('submitted spot 999 USD');
  });
  it('renders missing P&L values as unavailable and keeps raw signed Greek precision', () => {
    const html = markup({ ...result, today_pnl: [NaN, 99, 1600.55] });
    expect(html).toContain('Paths break at missing/nonfinite values');
    expect(html).toContain('Unavailable');
    expect(html).toContain('-0.001');
  });
  it('shows all draft drift without relabelling or changing result data', () => {
    const draft = structuredClone(result.request);
    draft.strategy.days_to_expiry = 90;
    draft.strategy.legs[0].implied_volatility = 0.8;
    const html = render(OptionsCharts, { props: { result, draft } }).body;
    expect(html).toContain('Inputs changed');
    expect(html).toContain('30 calendar days');
    expect(html).not.toContain('90 calendar days');
  });
  it('omits legacy expiry paths with explicit unavailability, retaining today/scenario arrays', () => {
    const html = markup({ ...result, expiry_curve: undefined });
    expect(html).toContain('Exact expiry trace unavailable');
    expect(html).not.toMatch(/class="curve expiry/);
    expect(html).toMatch(/class="curve today/);
    expect(html).toContain('+1700');
  });
  it('displays signed backend per-leg totals in original order; disabled zeros and active nulls differ', () => {
    const analysis: OptionsAnalysis = {
      ...result,
      legs: result.request.strategy.legs.map((leg, i) => ({
        leg_index: i,
        enabled: leg.enabled,
        resolved_implied_volatility: leg.kind === 'underlying' ? null : 0.2,
        gross_entry_cost: leg.enabled ? -500 : 0,
        entry_fees: leg.enabled ? 1 : 0,
        net_entry_cost: leg.enabled ? -499 : 0,
        theoretical_value_today: leg.enabled ? -700.123456789 : 0,
        pnl_today: leg.enabled ? -201.123456789 : 0,
        greeks: leg.enabled
          ? greeks
          : { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 },
      })),
    };
    const html = markup(analysis);
    expect(html).toContain('original leg order');
    expect(html).toContain('Disabled · zero contribution');
    expect(html).toContain('-201.123456789');
    expect(html).toContain('Not applicable · shares');
    expect(html).toContain('USD per 1 volatility percentage point');
    expect(html).toContain(
      'active undefined Greeks are unavailable, never zero',
    );
    expect(html).toContain('Unavailable');
    expect(html.indexOf('Leg 1 · call')).toBeLessThan(
      html.indexOf('Leg 2 · put'),
    );
    const invalid = {
      ...analysis,
      legs: analysis.legs!.map(l => ({ ...l, leg_index: 0 })),
    };
    expect(markup(invalid)).toContain('backend leg identities must match');
    expect(markup(result)).toContain('Per-leg breakdown unavailable');
  });
});

describe('canonical expiry vertices and per-series exact inspection', () => {
  const sparse: OptionsAnalysis = {
    ...result,
    request: {
      ...result.request,
      strategy: {
        ...result.request.strategy,
        legs: [result.request.strategy.legs[0]],
      },
    },
    spot_grid: [50, 150],
    today_pnl: [-490, 4500],
    expiry_pnl: [-500, 4500],
    scenarios: [],
    summary: { ...result.summary, breakevens: [105] },
    expiry_curve: [
      { spot: 50, pnl: -500 },
      { spot: 100, pnl: -500 },
      { spot: 105, pnl: 0 },
      { spot: 150, pnl: 4500 },
    ],
    greeks_grid: [greeks, greeks],
  };
  it('rejects null or sparse malformed vertex entries without sampled fallback', () => {
    const r = { ...sparse, expiry_curve: [...sparse.expiry_curve!] };
    r.expiry_curve[1] = null as unknown as NonNullable<
      OptionsAnalysis['expiry_curve']
    >[number];
    expect(expiryTraceError(r)).toContain('Exact expiry trace unavailable');
    expect(optionsSeries(r).map(s => s.id)).toEqual(['today']);
    delete r.expiry_curve[1];
    expect(expiryTraceError(r)).toContain('Exact expiry trace unavailable');
    expect(render(OptionsCharts, { props: { result: r } }).body).toContain(
      'Exact expiry trace unavailable',
    );
  });
  it('preserves the kink and isolated root for sparse [50,150] grids without TS valuation', () => {
    expect(expiryTraceError(sparse)).toBeNull();
    const series = optionsSeries(sparse)[0];
    expect(series.spots).toEqual([50, 100, 105, 150]);
    expect(series.values).toEqual([-500, -500, 0, 4500]);
    expect(
      svgPath(
        seriesPoints(series.spots, series.values),
        { min: 50, max: 150 },
        { min: -500, max: 4500 },
        200,
        0,
        100,
      ),
    ).toBe('M0.000,100.000 L100.000,100.000 L110.000,90.000 L200.000,0.000');
    expect(inspectionGrid(sparse)).toEqual([50, 100, 105, 150]);
    expect(seriesValue(series, 105)).toBe(0);
    expect(seriesValue(series, 102)).toBe(-300);
    expect(seriesValue(series, 104)).toBe(-100);
    expect(seriesValue(optionsSeries(sparse)[1], 100)).toBeUndefined();
    expect(seriesValue(optionsSeries(sparse)[1], 150)).toBe(4500);
    const html = render(OptionsCharts, { props: { result: sparse } }).body;
    expect(html).toMatch(/class="curve expiry/);
    expect(html).toContain('preserving strike kinks');
    expect(html).toContain(
      'Expiration values between exact vertices are linear',
    );
  });
  it.each([
    undefined,
    [],
    [
      { spot: 50, pnl: -500 },
      { spot: 150, pnl: 4500 },
    ],
    [
      { spot: 50, pnl: -500 },
      { spot: 105, pnl: 0 },
      { spot: 150, pnl: 4500 },
    ],
    [
      { spot: 50, pnl: -500 },
      { spot: 100, pnl: -500 },
      { spot: 150, pnl: 4500 },
    ],
    [
      { spot: 50, pnl: -500 },
      { spot: 100, pnl: NaN },
      { spot: 105, pnl: 0 },
      { spot: 150, pnl: 4500 },
    ],
    [
      { spot: 50, pnl: -500 },
      { spot: 105, pnl: 0 },
      { spot: 100, pnl: -500 },
      { spot: 150, pnl: 4500 },
    ],
    [
      { spot: 40, pnl: -500 },
      { spot: 100, pnl: -500 },
      { spot: 105, pnl: 0 },
      { spot: 150, pnl: 4500 },
    ],
  ])(
    'refuses incomplete/nonfinite/unsorted expiry vertices, never falling back to sparse expiry_pnl (%j)',
    curve => {
      const analysis = { ...sparse, expiry_curve: curve };
      expect(expiryTraceError(analysis)).toContain(
        'Exact expiry trace unavailable',
      );
      expect(optionsSeries(analysis).map(s => s.id)).toEqual(['today']);
      expect(plotError(analysis)).toBeNull();
    },
  );
  it('retains disabled/out-of-domain strike semantics and zero intervals without fabricating new points', () => {
    const analysis = {
      ...sparse,
      request: {
        ...sparse.request,
        strategy: {
          ...sparse.request.strategy,
          legs: [
            ...sparse.request.strategy.legs,
            { ...sparse.request.strategy.legs[0], strike: 110, enabled: false },
            { ...sparse.request.strategy.legs[0], strike: 200 },
          ],
        },
      },
      summary: {
        ...sparse.summary,
        zero_intervals: [{ start: 105, end: null }],
        breakevens: [105, 200],
      },
    };
    expect(expiryTraceError(analysis)).toBeNull();
    expect(optionsSeries(analysis)[0].spots).toEqual([50, 100, 105, 150]);
    expect(legBreakdownError(analysis)).toContain('unavailable');
  });
});

describe('positions outside the visible price range', () => {
  it('lists the submitted spot and enabled strikes outside the view', () => {
    expect(outsideView(result, { min: 80, max: 120 })).toEqual({
      spot: false,
      strikes: [],
    });
    expect(outsideView(result, { min: 101, max: 120 })).toEqual({
      spot: true,
      strikes: [100],
    });
  });

  it('warns with a Fit action when the submitted spot is off-screen', () => {
    const request = structuredClone(result.request);
    request.spot = 343.46;
    const html = render(OptionsCharts, {
      props: { result: { ...result, request } },
    }).body;
    expect(html).toContain('Outside this view: spot 343.46 USD');
    expect(html).toMatch(/<button[^>]*>Fit<\/button>/);
  });
});

describe('hover values on the exact expiry polyline', () => {
  const curves = optionsSeries(result);
  const expiry = curves.find(s => s.id === 'expiry')!;
  const today = curves.find(s => s.id === 'today')!;

  it('interpolates expiry between exact vertices, which is exact for a piecewise-linear payoff', () => {
    expect(seriesValue(expiry, 110)).toBeCloseTo((1499 * 4.99) / 14.99, 9);
    expect(seriesValue(expiry, 90)).toBe(-501);
    expect(seriesValue(expiry, 100)).toBe(-501);
  });

  it('never interpolates sampled series or extrapolates past the vertices', () => {
    expect(seriesValue(today, 110)).toBeUndefined();
    expect(seriesValue(expiry, 79)).toBeUndefined();
  });
});

describe('chart readouts for people', () => {
  it('formats the submitted spot and aggregate Greeks, keeping exact titles', () => {
    const request = structuredClone(result.request);
    request.spot = 343.4567891;
    const html = render(OptionsCharts, {
      props: {
        result: {
          ...result,
          request,
          greeks: { ...result.greeks, delta: 99.99630519765367 },
        },
      },
    }).body;
    expect(html).toContain('343.46 USD');
    expect(html).toContain('title="343.4567891"');
    expect(html).toMatch(/>\+100 · USD per USD spot/);
  });
});

describe('live expiry payoff while editing', () => {
  it('ghosts the submitted curves and draws the draft expiry when inputs changed', () => {
    const draft = structuredClone(result.request);
    draft.strategy.legs[0].strike = 110;
    const html = render(OptionsCharts, {
      props: { result, draft, onEdit: () => {}, documentKey: 'k' },
    }).body;
    expect(html).toMatch(/class="curve expiry live/);
    expect(html).toMatch(/class="curve today ghosted/);
  });

  it('has no separate proposal preview step', () => {
    const html = render(OptionsCharts, {
      props: {
        result,
        draft: result.request,
        onEdit: () => {},
        documentKey: 'k',
      },
    }).body;
    expect(html).not.toContain('Preview proposal');
    expect(html).not.toContain('PROPOSED');
    expect(html).not.toMatch(/class="curve [a-z0-9]+ ghosted/);
  });
});

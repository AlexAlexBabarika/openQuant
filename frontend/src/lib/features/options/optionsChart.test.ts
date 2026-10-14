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
    expect(s[0].values).toBe(result.expiry_pnl);
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
});

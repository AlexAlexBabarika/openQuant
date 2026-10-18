import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import OptionsScenarioLab from '../../../components/options/OptionsScenarioLab.svelte';
import { createOptionsDraft } from './optionsTemplates';
import type {
  OptionsAnalysis,
  OptionsDraft,
  OptionsSurfaceAnalysis,
} from './optionsTypes';
import {
  buildSurface,
  ivShiftBounds,
  requestChanged,
  scenarioInputError,
  scenarioNameError,
  surfaceCellLabel,
  surfaceDataError,
  surfaceKeyboardCell,
  surfaceSettings,
  surfaceSettingsErrors,
  surfaceValue,
} from './optionsScenario';
import { heatmapColor, heatmapLegend, heatmapScale } from '../sweep/heatmap';

const draft = (): OptionsDraft => ({
  ...createOptionsDraft(),
  scenarios: [{ name: 'Later', elapsed_days: 5, iv_shift_pp: 5 }],
});
const greeks = { delta: 1, gamma: null, theta: -0.001, vega: 2, rho: null };
const surface: OptionsSurfaceAnalysis = {
  axis: 'elapsed_days',
  spots: [80, 120],
  steps: [0, 30],
  pnl: [
    [-123.123456789, 2],
    [-500, 1499.25],
  ],
};
function analysis(): OptionsAnalysis {
  const request = draft();
  request.strategy.name = 'Submitted call';
  request.surface = {
    axis: surface.axis,
    spots: [...surface.spots],
    steps: [...surface.steps],
  };
  return {
    request,
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
      entry_fees: 0,
      net_entry_cost: 500,
      entry_debit: 500,
      entry_credit: 0,
      theoretical_value_today: 600,
      pnl_today: 100,
      max_profit: null,
      max_loss: 500,
      profit_unbounded: true,
      loss_unbounded: false,
      breakevens: [105],
      zero_intervals: [],
    },
    spot_grid: [80, 120],
    today_pnl: [1, 2],
    expiry_pnl: [-500, 1499.25],
    greeks,
    greeks_grid: [greeks, greeks],
    greek_units: {
      delta: 'USD per USD spot (equivalent shares)',
      gamma: 'delta per USD spot',
      theta: 'USD per calendar day elapsed',
      vega: 'USD per 1 volatility percentage point',
      rho: 'USD per 1 rate percentage point',
    },
    scenarios: [
      {
        name: 'Submitted later',
        elapsed_days: 5,
        remaining_days: 25,
        volatility: 0.25,
        pnl: [1, 2],
        greeks,
      },
    ],
    surface: structuredClone(surface),
    warnings: [],
  };
}

it('renders submitted Python heatmaps without editor draft controls or callbacks', () => {
  const result = analysis();
  const onEdit = vi.fn();
  const html = render(OptionsScenarioLab, {
    props: { draft: result.request, result, onEdit, readOnly: true },
  }).body;
  expect(html).toContain('Canonical heatmap');
  expect(html).toContain('-123.123456789');
  expect(html).not.toContain('Analyze draft');
  expect(html).not.toContain('Apply heatmap grid');
  expect(onEdit).not.toHaveBeenCalled();
});

it.each([
  { common: 30, legDays: [7, 30], first: 7 },
  { common: 0, legDays: [60, 60], first: 60 },
])(
  'bounds the scenario slider by the first active expiry ($first days), not the common default',
  ({ common, legDays, first }) => {
    const d = draft();
    d.strategy.days_to_expiry = common;
    d.strategy.legs = legDays.map(days => ({
      ...d.strategy.legs[0],
      days_to_expiry: days,
    }));
    const html = render(OptionsScenarioLab, {
      props: { draft: d, result: null, onEdit: vi.fn() },
    }).body;
    const slider = html.match(/<input[^>]*type="range"[^>]*>/)![0];
    expect(slider).toContain(`max="${first}"`);
    expect(slider).not.toMatch(/\sdisabled/);
    expect(html).toContain(`Elapsed days: 0–${first}.`);
  },
);

describe('explicit scenario and bounded surface input helpers', () => {
  it('requires unique nonblank bounded scenario names without changing inputs', () => {
    const d = draft();
    expect(scenarioNameError(d, 0)).toBeNull();
    d.scenarios.push({ ...d.scenarios[0] });
    expect(scenarioNameError(d, 0)).toContain('unique nonblank');
    d.scenarios[1].name = 'Distinct';
    d.scenarios[0].name = ' ';
    expect(scenarioNameError(d, 0)).toContain('unique nonblank');
    d.scenarios[0].name = 'x'.repeat(81);
    expect(scenarioNameError(d, 0)).toContain('80');
  });
  it('rejects grid precision collapse instead of submitting duplicate coordinates', () => {
    const d = draft();
    const spots = {
      ...surfaceSettings(d),
      spotStart: 100,
      spotEnd: 100 + Number.EPSILON * 100,
      spotCount: 41,
    };
    expect(surfaceSettingsErrors(d, spots).spots).toContain('distinct');
    expect(buildSurface(d, spots)).toBeNull();
    const steps = {
      ...surfaceSettings(d),
      stepStart: 1,
      stepEnd: 1 + Number.EPSILON,
      stepCount: 21,
    };
    expect(surfaceSettingsErrors(d, steps).steps).toContain('distinct');
    expect(buildSurface(d, steps)).toBeNull();
  });
  it('intersects declared base and enabled resolved per-leg IV limits; excludes disabled and shares', () => {
    const d = draft();
    d.volatility = 0.3;
    d.strategy.legs = [
      { ...d.strategy.legs[0], implied_volatility: 0.05 },
      { ...d.strategy.legs[0], implied_volatility: 4.9 },
      { ...d.strategy.legs[0], implied_volatility: NaN, enabled: false },
      {
        ...d.strategy.legs[0],
        kind: 'underlying',
        strike: null,
        multiplier: 1,
        implied_volatility: NaN,
      },
    ];
    const b = ivShiftBounds(d)!;
    expect(b.min).toBe(-5);
    expect(b.max).toBeCloseTo(10);
    expect(scenarioInputError(d, 30, 5)).toBeNull();
    expect(scenarioInputError(d, 0, -5)).toBeNull();
    expect(scenarioInputError(d, 0, -5.01)).toContain('every enabled');
    expect(scenarioInputError(d, 0, 10.01)).toContain('IV shift');
    expect(scenarioInputError(d, 30.01, 0)).toContain('common');
    d.strategy.legs[0].implied_volatility = 0.8;
    d.strategy.legs[1].implied_volatility = 0.8;
    expect(ivShiftBounds(d)).toEqual({ min: -30, max: 100 });
  });
  it.each([NaN, Infinity, -0.1, 5.01])(
    'rejects invalid IV inputs instead of clamping %s',
    iv => {
      const d = draft();
      d.volatility = iv;
      expect(ivShiftBounds(d)).toBeNull();
      expect(scenarioInputError(d, 0, 0)).toContain('IV shift');
    },
  );
  it('uses null IV fallback, permits zero IV, and never alters scenarios or leg IVs', () => {
    const d = draft();
    d.strategy.legs[0].implied_volatility = null;
    d.volatility = 0;
    const before = structuredClone(d);
    expect(ivShiftBounds(d)).toEqual({ min: 0, max: 100 });
    expect(scenarioInputError(d, 0, 0)).toBeNull();
    expect(d).toEqual(before);
  });
  it.each([-1, 3651, NaN, Infinity])(
    'rejects invalid common horizons %s',
    horizon => {
      const d = draft();
      d.strategy.days_to_expiry = horizon;
      expect(scenarioInputError(d, 0, 0)).toContain('Elapsed');
      expect(
        buildSurface(d, {
          ...surfaceSettings(d),
          axis: 'elapsed_days',
          stepStart: 0,
          stepEnd: 1,
        }),
      ).toBeNull();
    },
  );
  it('builds only bounded sorted coordinate inputs with both axes, never prices or executes', () => {
    const d = draft();
    for (const axis of ['elapsed_days', 'iv_shift_pp'] as const) {
      const settings = {
        ...surfaceSettings(d),
        axis,
        spotStart: 50,
        spotEnd: 150,
        spotCount: 41,
        stepStart: axis === 'elapsed_days' ? 0 : -10,
        stepEnd: axis === 'elapsed_days' ? 30 : 10,
        stepCount: 21,
      };
      const before = structuredClone(d);
      const request = buildSurface(d, settings)!;
      expect(request.axis).toBe(axis);
      expect(request.spots).toHaveLength(41);
      expect(request.steps).toHaveLength(21);
      expect(request.spots[0]).toBe(50);
      expect(request.spots[40]).toBe(150);
      expect(request.steps[20]).toBe(settings.stepEnd);
      expect(
        request.spots.every((v, i, arr) => i === 0 || v > arr[i - 1]),
      ).toBe(true);
      expect(
        request.steps.every((v, i, arr) => i === 0 || v > arr[i - 1]),
      ).toBe(true);
      expect(request).not.toHaveProperty('pnl');
      expect(d).toEqual(before);
    }
  });
  it.each([
    { spotStart: -1 },
    { spotEnd: 1000001 },
    { spotStart: 120, spotEnd: 80 },
    { spotEnd: NaN },
    { spotCount: 1 },
    { spotCount: 42 },
    { spotCount: 2.5 },
    { stepCount: 1 },
    { stepCount: 22 },
    { stepCount: 3.5 },
    { stepStart: -1 },
    { stepEnd: 31 },
    { stepStart: 30, stepEnd: 30 },
    { stepEnd: Infinity },
  ])('rejects invalid configuration without silently fixing it %j', update => {
    const d = draft();
    const settings = { ...surfaceSettings(d), ...update };
    expect(
      Object.keys(surfaceSettingsErrors(d, settings)).length,
    ).toBeGreaterThan(0);
    expect(buildSurface(d, settings)).toBeNull();
  });
  it('seeds persisted nonuniform grid endpoints/count without modifying it; zero horizon has no time surface', () => {
    const d = draft();
    d.surface = { axis: 'iv_shift_pp', spots: [1, 2, 10], steps: [-5, -1, 9] };
    expect(surfaceSettings(d)).toEqual({
      axis: 'iv_shift_pp',
      spotStart: 1,
      spotEnd: 10,
      spotCount: 3,
      stepStart: -5,
      stepEnd: 9,
      stepCount: 3,
    });
    expect(d.surface.spots).toEqual([1, 2, 10]);
    d.surface = null;
    d.strategy.days_to_expiry = 0;
    expect(surfaceSettings(d).axis).toBe('iv_shift_pp');
    expect(
      buildSurface(d, {
        ...surfaceSettings(d),
        axis: 'elapsed_days',
        stepStart: 0,
        stepEnd: 0,
      }),
    ).toBeNull();
    expect(buildSurface(d, surfaceSettings(d))).not.toBeNull();
    expect(scenarioInputError(d, 0, 0)).toBeNull();
  });
  it('prevents IV surfaces when resolved enabled IVs admit no distinct common shift', () => {
    const d = draft();
    d.strategy.legs = [
      { ...d.strategy.legs[0], implied_volatility: 0 },
      { ...d.strategy.legs[0], implied_volatility: 5 },
    ];
    expect(ivShiftBounds(d)).toEqual({ min: 0, max: 0 });
    expect(
      buildSurface(d, {
        ...surfaceSettings(d),
        axis: 'iv_shift_pp',
        stepStart: -1,
        stepEnd: 1,
      }),
    ).toBeNull();
  });
});

describe('canonical heatmap data and keyboard exact readouts', () => {
  it('reads raw backend cells and coordinates only, distinguishing zero from unavailable', () => {
    const s = { ...surface, pnl: [[0, NaN], [-1e-15]] };
    expect(surfaceDataError(s)).toBeNull();
    expect(surfaceValue(s, 0, 0)).toBe(0);
    expect(surfaceValue(s, 0, 1)).toBeNull();
    expect(surfaceValue(s, 1, 1)).toBeNull();
    expect(surfaceCellLabel(s, 0, 0)).toBe(
      'P&L: 0 USD; spot 80 USD; elapsed calendar days 0',
    );
    expect(surfaceCellLabel(s, 0, 1)).toContain('Unavailable (no result)');
    expect(surfaceCellLabel(s, 1, 0)).toContain('-1e-15 USD');
    expect(
      surfaceCellLabel({ ...s, axis: 'iv_shift_pp', steps: [-5, 5] }, 1, 0),
    ).toContain('IV shift pp +5');
    expect(surfaceValue({ ...surface, pnl: [] }, 0, 0)).toBeNull();
  });
  it('allows missing cells as unavailable but rejects invalid axes/order/oversized matrices', () => {
    for (const s of [
      { ...surface, spots: [120, 80] },
      { ...surface, spots: [80, Infinity] },
      { ...surface, spots: [1] },
      { ...surface, spots: Array.from({ length: 42 }, (_, i) => i) },
      { ...surface, steps: [0, 0] },
      { ...surface, steps: [0, 3651] },
      { ...surface, steps: Array.from({ length: 22 }, (_, i) => i) },
      { ...surface, pnl: [[1, 2, 3]] },
      { ...surface, pnl: [[1], [2], [3]] },
      { ...surface, axis: 'iv_shift_pp' as const, steps: [-101, 100] },
    ])
      expect(surfaceDataError(s)).toContain('unavailable');
    expect(surfaceDataError(surface)).toBeNull();
    expect(surfaceDataError({ ...surface, pnl: [[Infinity], []] })).toBeNull();
  });
  it('navigates bounded returned coordinates and leaves unhandled typing/tab shortcuts alone', () => {
    expect(surfaceKeyboardCell(0, 0, 21, 41, 'ArrowLeft')).toEqual({
      row: 0,
      column: 0,
    });
    expect(surfaceKeyboardCell(0, 0, 21, 41, 'ArrowUp')).toEqual({
      row: 0,
      column: 0,
    });
    expect(surfaceKeyboardCell(20, 40, 21, 41, 'ArrowRight')).toEqual({
      row: 20,
      column: 40,
    });
    expect(surfaceKeyboardCell(20, 40, 21, 41, 'ArrowDown')).toEqual({
      row: 20,
      column: 40,
    });
    expect(surfaceKeyboardCell(3, 4, 21, 41, 'ArrowDown')).toEqual({
      row: 4,
      column: 4,
    });
    expect(surfaceKeyboardCell(3, 4, 21, 41, 'ArrowRight')).toEqual({
      row: 3,
      column: 5,
    });
    expect(surfaceKeyboardCell(3, 4, 21, 41, 'Home')).toEqual({
      row: 3,
      column: 0,
    });
    expect(surfaceKeyboardCell(3, 4, 21, 41, 'End')).toEqual({
      row: 3,
      column: 40,
    });
    expect(surfaceKeyboardCell(3, 4, 21, 41, 'Home', true)).toEqual({
      row: 0,
      column: 0,
    });
    expect(surfaceKeyboardCell(3, 4, 21, 41, 'End', true)).toEqual({
      row: 20,
      column: 40,
    });
    for (const key of ['Tab', 'Escape', 'a', 'Enter'])
      expect(surfaceKeyboardCell(0, 0, 2, 2, key)).toBeUndefined();
  });
  it('reuses the same low-to-high mapping for cells/legend, with midpoint constant and missing states', () => {
    const scale = heatmapScale(surface.pnl);
    const legend = heatmapLegend(scale);
    expect(legend.map(item => item.position)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    for (const swatch of legend)
      expect(swatch.color).toBe(heatmapColor(swatch.value, scale));
    const constant = heatmapScale([[1, 1]]);
    expect(heatmapLegend(constant)).toEqual([
      { position: 0.5, value: 1, color: heatmapColor(1, constant) },
    ]);
    expect(heatmapLegend(heatmapScale([[null, NaN]]))).toEqual([]);
  });
});

describe('submitted versus edited request context', () => {
  it('normalizes optional legacy null metadata/default surface and object property order', () => {
    const d = draft();
    const submitted = structuredClone(d);
    submitted.surface = null;
    submitted.strategy.underlying = null;
    submitted.strategy.valuation_date = null;
    submitted.strategy.expiry_date = null;
    Object.assign(submitted.strategy.legs[0], {
      implied_volatility: null,
      bid: null,
      ask: null,
      quote_as_of: null,
    });
    expect(requestChanged(d, submitted)).toBe(false);
    const reordered = Object.fromEntries(
      Object.entries(submitted).reverse(),
    ) as unknown as OptionsDraft;
    expect(requestChanged(d, reordered)).toBe(false);
  });
  it('marks changed scenarios, dates, fees, enabled leg IV, grid or surface stale without repricing', () => {
    const d = draft();
    for (const change of [
      (v: OptionsDraft) => {
        v.scenarios[0].elapsed_days = 9;
      },
      (v: OptionsDraft) => {
        v.strategy.valuation_date = '2026-10-14';
      },
      (v: OptionsDraft) => {
        v.strategy.entry_fee_per_contract += 1;
      },
      (v: OptionsDraft) => {
        v.strategy.legs[0].implied_volatility = 0.8;
      },
      (v: OptionsDraft) => {
        v.strategy.legs[0].enabled = false;
      },
      (v: OptionsDraft) => {
        v.spot_grid[0] += 1;
      },
      (v: OptionsDraft) => {
        v.surface = { axis: 'iv_shift_pp', spots: [80, 120], steps: [-5, 5] };
      },
    ]) {
      const current = structuredClone(d);
      change(current);
      expect(requestChanged(current, d)).toBe(true);
    }
  });
});

describe('scenario lab markup (shell SSR only; not browser/UI validation)', () => {
  const markup = (current: OptionsDraft, result: OptionsAnalysis | null) => {
    const onEdit = vi.fn();
    const html = render(OptionsScenarioLab, {
      props: { draft: current, result, onEdit },
    }).body;
    expect(onEdit).not.toHaveBeenCalled();
    return html;
  };
  it('offers apply, labelled sliders and empty states, with analysis following edits', () => {
    const html = markup(draft(), null);
    expect(html).not.toContain('Analyze draft');
    expect(html).toContain('Apply heatmap grid');
    expect(html).toContain('No analysis yet');
    expect(html).toContain('no automatic Python execution');
    expect(html.match(/type="range"/g)).toHaveLength(
      draft().scenarios.length * 2,
    );
    expect(html).toContain('IV shift · draft');
    expect(html).toContain('Elapsed calendar days · draft');
  });
  it('never relabels old results with staged axis/spot/slider inputs and exposes stale submitted context', () => {
    const result = analysis(),
      current = structuredClone(result.request);
    current.strategy.name = 'Edited label';
    current.spot = 900;
    current.scenarios[0].elapsed_days = 20;
    current.surface = {
      axis: 'iv_shift_pp',
      spots: [800, 900],
      steps: [-10, 10],
    };
    const html = markup(current, result);
    expect(html).toContain(
      'The results below update when the new analysis returns',
    );
    expect(html).toContain('Submitted Submitted call · spot 100 USD');
    expect(html).toContain('Returned axis: elapsed calendar days');
    expect(html).toContain(
      'P&amp;L: -123.123456789 USD; spot 80 USD; elapsed calendar days 0',
    );
    expect(html).toContain('Submitted later: 5 calendar days elapsed');
    expect(html).not.toContain('Submitted Edited label');
    expect(html).not.toContain('P&amp;L: -123.123456789 USD; spot 800 USD');
  });
  it('has exact signed USD labels, bounded scroll region, one roving cell tab stop and keyboard instructions', () => {
    const result = analysis(),
      html = markup(result.request, result);
    expect(html).toContain('aria-label="Canonical options P&amp;L heatmap"');
    expect(html).toContain(
      'P&amp;L: +1499.25 USD; spot 120 USD; elapsed calendar days 30',
    );
    expect(html).toContain('Ctrl+Home/End');
    expect(html.match(/data-cell="[^"]+" tabindex="0"/g)).toHaveLength(1);
    expect(html.match(/data-cell="[^"]+" tabindex="-1"/g)).toHaveLength(3);
    expect(html).not.toContain(
      'The results below update when the new analysis returns',
    );
  });
  it('renders missing/nonfinite cells distinctly from zero, including IV axis and constant legend', () => {
    const result = analysis();
    result.surface = {
      axis: 'iv_shift_pp',
      spots: [80, 120],
      steps: [-5, 5],
      pnl: [[0, NaN], [0]],
    };
    const html = markup(result.request, result);
    expect(html).toContain('Some backend cells are missing or nonfinite');
    expect(html).toContain(
      'P&amp;L: Unavailable (no result); spot 120 USD; IV shift pp +5',
    );
    expect(html).toContain('P&amp;L: 0 USD; spot 80 USD; IV shift pp -5');
    expect(html).toContain('Constant results use one midpoint swatch');
  });
  it('shows unavailable legacy surface and invalid matrix instead of zero/success', () => {
    const result = analysis();
    result.surface = undefined;
    expect(markup(result.request, result)).toContain('no canonical surface');
    result.surface = { ...surface, steps: [0, 0] };
    const html = markup(result.request, result);
    expect(html).toContain('returned axes or matrix bounds are invalid');
    expect(html).not.toContain('data-cell=');
  });
  it('keeps draft controls editable (an edit cancels any pending update) and retains evidence', () => {
    const result = analysis(),
      html = markup(result.request, result);
    expect(html).not.toContain('Analyzing…</button>');
    expect(html).not.toMatch(/<fieldset disabled/);
    expect(html).toContain('-123.123456789');
  });
  it('renders all 861 backend cells without dropping precision, axes or keyboard access', () => {
    const result = analysis();
    result.surface = {
      axis: 'elapsed_days',
      spots: Array.from({ length: 41 }, (_, i) => i),
      steps: Array.from({ length: 21 }, (_, i) => i),
      pnl: Array.from({ length: 21 }, (_, row) =>
        Array.from({ length: 41 }, (_, column) =>
          row === 20 && column === 40 ? 1e-15 : row * 41 + column,
        ),
      ),
    };
    const html = markup(result.request, result);
    expect(html.match(/data-cell=/g)).toHaveLength(861);
    expect(html.match(/data-cell="[^"]+" tabindex="0"/g)).toHaveLength(1);
    expect(html).toContain(
      'P&amp;L: +1e-15 USD; spot 40 USD; elapsed calendar days 20',
    );
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import OptionsCharts from '../../../components/options/OptionsCharts.svelte';
import { clearAccessToken, setAccessToken } from '$lib/core/api';
import {
  MAX_STRIKE,
  STRIKE_STEPS,
  validStrike,
  snapStrike,
  strikeAtClientX,
  applyStrikeEdit,
  moveStrikeDrag,
  finishStrikeDrag,
  isolatedLegRequest,
  canonicalOverlay,
  requestChartAnalysis,
  ChartRequestGate,
  chartContextKey,
} from './optionsChartEditing';
import type { StrikeDrag } from './optionsChartEditing';
import { createOptionsDraft } from './optionsTemplates';
import type { OptionsAnalysis } from './optionsTypes';
import { seriesValue } from './optionsChart';

// Supplied canonical evidence, deliberately not calculated by the frontend.
function evidence(): OptionsAnalysis {
  const request = createOptionsDraft();
  request.spot_grid = [80, 120];
  request.scenarios = [];
  request.strategy.legs = [
    { ...request.strategy.legs[0], strike: 100, entry_premium: 5 },
  ];
  const greeks = { delta: 12, gamma: 0, theta: null, vega: 2, rho: null };
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
      theoretical_value_today: 510,
      pnl_today: 10,
      max_profit: null,
      max_loss: 500,
      profit_unbounded: true,
      loss_unbounded: false,
      breakevens: [105],
      zero_intervals: [],
    },
    spot_grid: [80, 120],
    today_pnl: [-490, 1510],
    expiry_pnl: [-500, 1500],
    expiry_curve: [
      { spot: 80, pnl: -500 },
      { spot: 100, pnl: -500 },
      { spot: 105, pnl: 0 },
      { spot: 120, pnl: 1500 },
    ],
    scenarios: [],
    greeks,
    greeks_grid: [greeks, greeks],
    greek_units: {
      delta: 'USD per USD spot (equivalent shares)',
      gamma: 'delta per USD spot',
      theta: 'USD per calendar day elapsed',
      vega: 'USD per 1 volatility percentage point',
      rho: 'USD per 1 rate percentage point',
    },
    warnings: [],
  };
}

afterEach(() => {
  clearAccessToken();
  vi.unstubAllGlobals();
});

describe('bounded strike coordinate proposals, never pricing', () => {
  const domain = { min: 80, max: 120 };
  const coordinate = (
    x: number,
    bounds = { left: 10, width: 360 },
    view = domain,
    step = 1,
  ) => strikeAtClientX(x, bounds, 360, 64, 278, view, step);
  it('converts SVG viewBox pixels including margins and clamps out-of-bounds pointers', () => {
    expect(coordinate(74)).toBe(80);
    expect(coordinate(213)).toBe(100);
    expect(coordinate(352)).toBe(120);
    expect(coordinate(-10000)).toBe(80);
    expect(coordinate(10000)).toBe(120);
  });
  it('uses current bounds for resize, CSS/browser zoom and scrolled offsets', () => {
    expect(coordinate(10 + 203 * 2, { left: 10, width: 720 })).toBe(100);
    expect(coordinate(-120 + 203 / 2, { left: -120, width: 180 })).toBe(100);
    expect(
      coordinate(213, { left: 10, width: 360 }, { min: 95, max: 105 }),
    ).toBe(100);
    expect(
      coordinate(74, { left: 10, width: 360 }, { min: 95, max: 105 }),
    ).toBe(95);
  });
  it('snaps within numeric bounds without crossing the visible domain', () => {
    expect(coordinate(-100, undefined, { min: 0, max: 10 }, 0.01)).toBe(0.01);
    expect(coordinate(-100, undefined, { min: 80.03, max: 82.98 }, 0.1)).toBe(
      80.1,
    );
    expect(coordinate(10000, undefined, { min: 80.03, max: 82.98 }, 0.1)).toBe(
      82.9,
    );
    expect(
      coordinate(10000, undefined, { min: 999999, max: 1000001 }, 0.01),
    ).toBe(MAX_STRIKE);
    expect(
      coordinate(200, undefined, { min: 80.01, max: 80.02 }, 1),
    ).toBeNull();
    expect(snapStrike(100.235, 0.01)).toBe(100.24);
    expect(snapStrike(1e20, 5)).toBe(MAX_STRIKE);
    expect(snapStrike(-1, 1)).toBe(1);
    expect(snapStrike(100, 0)).toBeNull();
    expect(STRIKE_STEPS).toEqual([0.01, 0.1, 1, 5]);
  });
  it('rejects nonfinite or collapsed geometry and distinguishes zero/null from positive strike', () => {
    for (const value of [null, undefined, 0, -1, NaN, Infinity, 1000001, '100'])
      expect(validStrike(value)).toBe(false);
    expect(validStrike(0.000000001)).toBe(true);
    expect(coordinate(NaN)).toBeNull();
    expect(coordinate(10, { left: 0, width: 0 })).toBeNull();
    expect(coordinate(10, { left: Infinity, width: 100 })).toBeNull();
    expect(coordinate(10, undefined, { min: 100, max: 100 })).toBeNull();
    expect(coordinate(10, undefined, { min: -1, max: 100 })).toBeNull();
  });
});

describe('one controlled history edit per gesture', () => {
  const start = (): StrikeDrag => ({
    pointerId: 7,
    legIndex: 0,
    original: 100,
    proposed: 100,
    context: 'guest:document-a',
  });
  it('keeps every pointermove local and commits the release once with no premium changes', () => {
    const draft = createOptionsDraft();
    draft.strategy.legs[0] = {
      ...draft.strategy.legs[0],
      strike: 100,
      quantity: -3,
      multiplier: 50,
      entry_premium: 0,
      bid: 0,
      ask: 0.5,
      quote_as_of: '2026-10-15T00:00:00Z',
      source: {
        provider: 'tradier',
        environment: 'sandbox',
        contract_symbol: 'XYZ-original',
        underlying: 'XYZ',
        fetched_at: '2026-10-15T00:00:00Z',
        bid_as_of: null,
        ask_as_of: '2026-10-15T00:00:00Z',
      },
    };
    const before = structuredClone(draft);
    let drag: StrikeDrag | null = start();
    for (const value of [101, 102, 99, 106.25])
      drag = moveStrikeDrag(drag!, 7, value);
    expect(draft).toEqual(before);
    const done = finishStrikeDrag(drag, 7, 'guest:document-a');
    expect(done?.proposed).toBe(106.25);
    const onEdit = vi.fn((edit: (d: typeof draft) => void) => edit(draft));
    if (done)
      onEdit(d => {
        applyStrikeEdit(d, done.legIndex, done.proposed, done.original);
      });
    drag = null;
    expect(finishStrikeDrag(drag, 7, 'guest:document-a')).toBeNull();
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(draft.strategy.legs[0]).toEqual({
      ...before.strategy.legs[0],
      strike: 106.25,
    });
    expect(draft.strategy.template).toBe('custom');
  });
  it.each([
    'pointercancel',
    'lostpointercapture',
    'Escape',
    'blur',
    'unmount',
    'zoom',
  ])('cancels %s without applying a draft/history edit', () => {
    const drag = moveStrikeDrag(start(), 7, 110);
    expect(finishStrikeDrag(drag, 7, 'guest:document-a', true)).toBeNull();
  });
  it('fences a different pointer/document and ignores invalid moves, no-ops and stale original strikes', () => {
    const drag = start();
    expect(moveStrikeDrag(drag, 8, 110)).toBe(drag);
    expect(moveStrikeDrag(drag, 7, null)).toBe(drag);
    expect(finishStrikeDrag(drag, 7, drag.context)).toBeNull();
    const moved = moveStrikeDrag(drag, 7, 110);
    expect(finishStrikeDrag(moved, 8, drag.context)).toBeNull();
    expect(finishStrikeDrag(moved, 7, 'account:other')).toBeNull();
    const d = createOptionsDraft();
    d.strategy.legs[0].strike = 102;
    expect(applyStrikeEdit(d, 0, 110, 100)).toBe(false);
    expect(applyStrikeEdit(d, 0, NaN, 102)).toBe(false);
    expect(applyStrikeEdit(d, 0, 0, 102)).toBe(false);
    expect(applyStrikeEdit(d, 0, 102, 102)).toBe(false);
    d.strategy.legs[0].enabled = false;
    expect(applyStrikeEdit(d, 0, 110, 102)).toBe(false);
    expect(applyStrikeEdit(d, 99, 110, 100)).toBe(false);
    d.strategy.legs[0] = {
      kind: 'underlying',
      quantity: 1,
      multiplier: 1,
      entry_premium: 100,
      strike: null,
      enabled: true,
    };
    expect(applyStrikeEdit(d, 0, 110, 100)).toBe(false);
  });
});

describe('canonical isolated-leg and proposed evidence', () => {
  it('uses only returned exact vertices and sampled values without filling missing points', () => {
    const result = evidence();
    const before = structuredClone(result);
    const curves = canonicalOverlay(result, result.request);
    expect(curves[0].spots).toEqual([80, 100, 105, 120]);
    expect(curves[0].values).toEqual([-500, -500, 0, 1500]);
    expect(curves[1].values).toBe(result.today_pnl);
    expect(seriesValue(curves[1], 100)).toBeUndefined();
    expect(seriesValue(curves[0], 105)).toBe(0);
    expect(result).toEqual(before);
  });
  it('rejects mismatched echoed requests and never falls back to sampled expiry geometry', () => {
    const result = evidence();
    const changed = structuredClone(result.request);
    changed.strategy.legs[0].strike = 101;
    expect(() => canonicalOverlay(result, changed)).toThrow(/match/);
    result.expiry_curve = undefined;
    expect(canonicalOverlay(result, result.request).map(s => s.id)).toEqual([
      'today',
    ]);
    result.spot_grid = [100, 100];
    expect(() => canonicalOverlay(result, result.request)).toThrow();
  });
  it('withholds exact terminal overlays for mixed expiry even with accidentally populated vertices', () => {
    const result = evidence();
    result.horizon = {
      kind: 'mixed_expiry',
      first_expiry_days: 10,
      last_expiry_days: 60,
      elapsed_days: 10,
      exact_terminal_available: false,
      legs: [],
    };
    expect(canonicalOverlay(result, result.request).map(s => s.id)).toEqual([
      'today',
    ]);
    delete result.horizon;
    expect(
      canonicalOverlay(result, result.request, true).map(s => s.id),
    ).toEqual(['today']);
  });
  it('isolates with backend enable flags, retaining signed units, source metadata, IV, dates and zero/null', () => {
    const result = evidence();
    const leg = result.request.strategy.legs[0];
    leg.quantity = -2;
    leg.entry_premium = 0;
    leg.implied_volatility = 0;
    leg.bid = null;
    leg.ask = null;
    leg.days_to_expiry = null;
    leg.expiry_date = '2026-12-18';
    result.request.strategy.valuation_date = '2026-10-15';
    result.request.strategy.legs.push({
      ...leg,
      days_to_expiry: 1,
      expiry_date: null,
    });
    result.request.scenarios = [
      { name: 'First expiry', elapsed_days: 1, iv_shift_pp: 0 },
    ];
    result.request.surface = {
      axis: 'elapsed_days',
      spots: [80, 120],
      steps: [0, 1],
    };
    const before = structuredClone(result);
    const request = isolatedLegRequest(result, 0)!;
    expect(request.strategy.legs[0]).toEqual(leg);
    expect(request.strategy.legs[1]).toEqual({
      ...before.request.strategy.legs[1],
      enabled: false,
    });
    expect(request.spot_grid).toEqual(result.spot_grid);
    expect(request.scenarios).toEqual([]);
    expect(request.surface).toBeNull();
    expect(request.strategy.valuation_date).toBe('2026-10-15');
    request.strategy.legs[0].strike = 200;
    expect(result).toEqual(before);
    result.request.strategy.legs[0].enabled = false;
    expect(isolatedLegRequest(result, 0)).toBeNull();
    expect(isolatedLegRequest(result, 99)).toBeNull();
  });
  it('snapshots proxied submitted requests without mutating reactive state', () => {
    const result = evidence();
    const original = structuredClone(result.request);
    result.request = new Proxy(result.request, {});
    result.request.strategy = new Proxy(result.request.strategy, {});
    result.request.strategy.legs[0] = new Proxy(
      result.request.strategy.legs[0],
      {},
    );
    const request = isolatedLegRequest(result, 0)!;
    expect(request.strategy.legs[0]).toEqual(original.strategy.legs[0]);
    request.strategy.legs[0].strike = 999;
    expect(result.request).toEqual(original);
  });
  it('uses guest canonical /options/analyze JSON and AbortSignal, not Python or provider endpoints', async () => {
    const result = evidence();
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(result)));
    vi.stubGlobal('fetch', fetch);
    setAccessToken('test-only-placeholder');
    const controller = new AbortController();
    expect(
      await requestChartAnalysis(result.request, controller.signal),
    ).toEqual(result);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toContain('/options/analyze');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual(result.request);
    expect(init.signal).toBe(controller.signal);
    expect(init.headers.has('Authorization')).toBe(false);
  });
});

describe('request generation, privacy and replacement fences', () => {
  it('fences document/account, draft, source-mode and result replacement before effect cleanup', () => {
    const result = evidence(),
      draft = structuredClone(result.request);
    const key = chartContextKey('guest:a', draft, result, false, true);
    const gate = new ChartRequestGate();
    const flight = gate.begin(key, result);
    expect(flight.current(key, result)).toBe(true);
    expect(
      flight.current(
        chartContextKey('account:b', draft, result, false, true),
        result,
      ),
    ).toBe(false);
    expect(
      flight.current(
        chartContextKey('guest:a', draft, result, true, false),
        result,
      ),
    ).toBe(false);
    expect(flight.current(key, structuredClone(result))).toBe(false);
    draft.strategy.legs[0].strike = 101;
    expect(
      flight.current(
        chartContextKey('guest:a', draft, result, false, true),
        result,
      ),
    ).toBe(false);
    gate.cancel();
    expect(flight.signal.aborted).toBe(true);
    expect(flight.current(key, result)).toBe(false);
  });
  it.each(['success', 'error', 'finally'])(
    'discards obsolete %s after replacement even if transport ignores abort',
    async phase => {
      const result = evidence(),
        gate = new ChartRequestGate();
      let release!: () => void;
      const delayed = new Promise<void>(resolve => {
        release = resolve;
      });
      const old = gate.begin('old', result),
        publish = vi.fn();
      const work = delayed.then(() => {
        if (old.current('old', result)) publish(phase);
      });
      const current = gate.begin('new', result);
      release();
      await work;
      expect(old.signal.aborted).toBe(true);
      expect(publish).not.toHaveBeenCalled();
      expect(current.current('new', result)).toBe(true);
      gate.cancel();
      expect(current.current('new', result)).toBe(false);
    },
  );
});

describe('native controlled chart rendering', () => {
  it('keeps legacy rendering read-only with exact submitted paths and working inspection', () => {
    const result = evidence();
    const { body } = render(OptionsCharts, { props: { result } });
    expect(body).toContain('Read-only chart');
    expect(body).not.toContain('>Preview proposal</button>');
    expect(body).toContain('role="slider"');
    expect(body).toContain('L1 submitted call strike 100 USD');
    expect(body).toContain(
      'including every in-domain strike and isolated breakeven',
    );
  });
  it('exposes explicit preview, numeric/keyboard alternatives, precision and unpriced warnings only with full parent contract', () => {
    const result = evidence(),
      draft = structuredClone(result.request);
    draft.strategy.legs[0].strike = 103.125;
    const onEdit = vi.fn();
    const { body } = render(OptionsCharts, {
      props: { result, draft, onEdit, documentKey: 'guest:research-a' },
    });
    expect(body).toContain('Preview proposal');
    expect(body).toContain('Apply strike');
    expect(body).toContain('Strike −');
    expect(body).toContain('Strike +');
    expect(body).toContain('Unpriced draft strike 103.125 USD');
    expect(body).toContain('never change entry premiums');
    expect(body).toContain('not payoff evidence');
    expect(onEdit).not.toHaveBeenCalled();
    for (const props of [
      { readOnly: true, documentKey: 'guest:a', onEdit },
      { onEdit },
      { documentKey: 'guest:a' },
    ]) {
      const html = render(OptionsCharts, {
        props: { result, draft, ...props },
      }).body;
      expect(html).toContain('Read-only chart');
      expect(html).not.toContain('>Preview proposal</button>');
    }
  });
});

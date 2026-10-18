import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { clearAccessToken, setAccessToken } from '$lib/core/api';
import OptionsProbabilityLab from '../../../components/options/OptionsProbabilityLab.svelte';
import { createOptionsDraft } from './optionsTemplates';
import type {
  DistributionRequest,
  DistributionResponse,
} from './optionsResearchTypes';
import {
  ProbabilityRunner,
  emptyProbabilityState,
  probabilityBars,
  tallestProbability,
  probabilityBinLabel,
  probabilityDataError,
  probabilityErrors,
  probabilityKey,
  probabilityPercent,
  probabilityRequest,
  probabilitySettings,
  terminalProbabilityError,
  terminalProbabilityPlot,
} from './optionsProbability';

const request = (): DistributionRequest =>
  probabilityRequest(createOptionsDraft(), probabilitySettings())!;
const response = (input = request()): DistributionResponse => ({
  request: input,
  provenance: {
    version: '1',
    model: 'black_scholes_merton',
    currency: 'USD',
    day_basis: 'ACT/365',
    exercise_style: 'european',
    settlement: 'cash',
    input_source: 'manual_or_synthetic',
  },
  resolved_annual_drift: 0.03,
  horizon_days: 30,
  terminal_log_sigma: 0,
  deterministic: true,
  bins: [{ lower_pnl: 0, upper_pnl: 0, probability: 1 }],
  terminal_price_bins: [
    {
      lower_spot: 100,
      upper_spot: 100,
      representative_spot: 100,
      probability: 1,
    },
  ],
  terminal_payoff_curve: [{ spot: 100, pnl: 0 }],
  probability_positive_pnl: 0,
  expected_pnl: 0,
  quantiles: [{ probability: 0.05, pnl: 0 }],
  confidence: 0.95,
  value_at_risk: 0,
  expected_shortfall: 0,
  integration_method: 'deterministic',
  integration_points: 1,
  truncated_probability: 0,
  normalization_mass: 1,
  numerical_error_estimate: null,
  warnings: [],
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('probability assumptions and snapshots', () => {
  it('uses bounded frozen defaults and omits drift in risk-neutral mode', () => {
    expect(
      probabilityErrors(createOptionsDraft(), probabilitySettings()),
    ).toEqual({});
    expect(request()).not.toHaveProperty('annual_drift');
    expect(request()).toMatchObject({
      confidence: 0.95,
      bins: 40,
      integration_points: 4096,
      tail_probability: 1e-6,
    });
  });
  it('keeps zero drift, signed quantities, zero fees and heterogeneous leg IVs', () => {
    const draft = createOptionsDraft();
    draft.strategy.legs[0].quantity = -2;
    draft.strategy.legs[0].implied_volatility = 0;
    draft.strategy.entry_fee_per_contract = 0;
    const settings = {
      ...probabilitySettings(),
      measure: 'user_drift' as const,
      annualDrift: 0,
    };
    const snapshot = probabilityRequest(draft, settings)!;
    draft.strategy.legs[0].quantity = 10;
    settings.annualDrift = 1;
    expect(snapshot.annual_drift).toBe(0);
    expect(snapshot.analysis.strategy.legs[0]).toMatchObject({
      quantity: -2,
      implied_volatility: 0,
    });
    expect(snapshot.analysis.strategy.entry_fee_per_contract).toBe(0);
  });
  it.each([
    ['annualDrift', undefined, 'user_drift'],
    ['annualDrift', NaN, 'user_drift'],
    ['annualDrift', -1.01, 'user_drift'],
    ['annualDrift', 1.01, 'user_drift'],
    ['confidence', 0.5],
    ['confidence', 1],
    ['confidence', undefined],
    ['bins', 9],
    ['bins', 101],
    ['bins', 12.5],
    ['bins', undefined],
    ['integrationPoints', 255],
    ['integrationPoints', 16385],
    ['integrationPoints', Infinity],
    ['tailProbability', 0],
    ['tailProbability', 0.011],
    ['tailProbability', undefined],
  ])(
    'rejects invalid/blank %s=%s without treating it as zero',
    (field, value, measure = undefined) => {
      const settings = {
        ...probabilitySettings(),
        [field]: value,
        ...(measure ? { measure } : {}),
      };
      expect(
        probabilityErrors(
          createOptionsDraft(),
          settings as ReturnType<typeof probabilitySettings>,
        ),
      ).toHaveProperty(field);
      expect(
        probabilityRequest(
          createOptionsDraft(),
          settings as ReturnType<typeof probabilitySettings>,
        ),
      ).toBeNull();
    },
  );
  it('accepts exact bounded numerical endpoints', () => {
    const settings = {
      ...probabilitySettings(),
      measure: 'user_drift' as const,
      annualDrift: -1,
      bins: 10,
      integrationPoints: 256,
      tailProbability: 1e-9,
    };
    expect(probabilityErrors(createOptionsDraft(), settings)).toEqual({});
    expect(
      probabilityErrors(createOptionsDraft(), {
        ...settings,
        annualDrift: 1,
        bins: 100,
        integrationPoints: 16384,
        tailProbability: 0.01,
      }),
    ).toEqual({});
  });
  it('blocks mixed enabled expiries, but ignores disabled and underlying horizons', () => {
    const draft = createOptionsDraft();
    draft.strategy.legs.push({ ...draft.strategy.legs[0], days_to_expiry: 60 });
    expect(probabilityErrors(draft, probabilitySettings()).horizon).toMatch(
      /lifecycle lab/,
    );
    draft.strategy.legs[1].enabled = false;
    expect(
      probabilityErrors(draft, probabilitySettings()).horizon,
    ).toBeUndefined();
  });
  it('resolves date-only expiries with the foundation resolver', () => {
    const draft = createOptionsDraft();
    draft.strategy.valuation_date = '2026-10-01';
    draft.strategy.legs[0].expiry_date = '2026-10-31';
    draft.strategy.legs.push({
      ...draft.strategy.legs[0],
      expiry_date: null,
      days_to_expiry: 30,
    });
    expect(probabilityErrors(draft, probabilitySettings())).toEqual({});
    draft.strategy.legs[1].days_to_expiry = 60;
    expect(probabilityRequest(draft, probabilitySettings())).toBeNull();
  });
  it('fences every draft and settings change, including nonfinite form values', () => {
    const draft = createOptionsDraft(),
      settings = probabilitySettings();
    const key = probabilityKey(draft, settings);
    draft.strategy.legs[0].entry_premium = 0;
    expect(probabilityKey(draft, settings)).not.toBe(key);
    expect(probabilityKey(draft, { ...settings, annualDrift: NaN })).not.toBe(
      probabilityKey(draft, { ...settings, annualDrift: undefined }),
    );
  });
});

describe('probability presentation, not financial computation', () => {
  it('preserves zero, negative P&L, tiny probability and unknown error values', () => {
    expect(probabilityPercent(0)).toBe('0%');
    expect(probabilityPercent(1e-12)).not.toBe('0%');
    expect(probabilityPercent(null)).toBe('Unavailable');
    expect(probabilityPercent(NaN)).toBe('Unavailable');
    expect(
      probabilityBinLabel({ lower_pnl: -25, upper_pnl: -25, probability: 1 }),
    ).toBe('Point mass at -25 USD');
    expect(probabilityDataError(response())).toBeNull();
  });
  it('draws a deterministic atom without division by zero or a density claim', () => {
    expect(probabilityBars(response().bins)).toEqual([
      {
        bin: response().bins[0],
        atom: true,
        x: 300,
        width: 0,
        y: 0,
        height: 160,
      },
    ]);
    const bins = [
      { lower_pnl: -100, upper_pnl: 0, probability: 0.75 },
      { lower_pnl: 0, upper_pnl: 200, probability: 0.25 },
    ];
    expect(probabilityBars(bins).map(b => b.width)).toEqual([200, 400]);
    const heights = probabilityBars(bins).map(b => b.height);
    expect(heights[0]).toBe(160);
    expect(heights[1]).toBeCloseTo(160 / 3, 9);
  });
  it('scales bars to the tallest bin so small masses stay visible', () => {
    const bins = Array.from({ length: 36 }, (_, i) => ({
      lower_pnl: i,
      upper_pnl: i + 1,
      probability: i === 18 ? 0.031 : 0.0275,
    }));
    const bars = probabilityBars(bins);
    expect(Math.max(...bars.map(b => b.height))).toBe(160);
    expect(tallestProbability(bins)).toBe(0.031);
    expect(
      probabilityBars([
        { lower_pnl: 0, upper_pnl: 1, probability: 0 },
        { lower_pnl: 1, upper_pnl: 2, probability: 0 },
      ]).map(b => b.height),
    ).toEqual([0, 0]);
  });
  it('distinguishes empty/invalid evidence from zero risk', () => {
    expect(probabilityDataError({ ...response(), bins: [] })).toMatch(
      /empty evidence/,
    );
    expect(
      probabilityBars([{ lower_pnl: 1, upper_pnl: 0, probability: 1 }]),
    ).toEqual([]);
    expect(
      probabilityBars([{ lower_pnl: 0, upper_pnl: 0, probability: NaN }]),
    ).toEqual([]);
    expect(
      probabilityBars(Array.from({ length: 101 }, () => response().bins[0])),
    ).toEqual([]);
  });
  it('draws terminal-price atoms without a false density spike or payoff extrapolation', () => {
    const plot = terminalProbabilityPlot(response(), 300)!;
    expect(plot.atom).toBe(true);
    expect(plot.bins[0]).toMatchObject({ x: 150, width: 0, height: 100 });
    expect(plot.points).toEqual([
      { point: { spot: 100, pnl: 0 }, x: 150, y: 275 },
    ]);
    expect(plot.payoffPath).not.toContain('NaN');
    expect(plot.lower).toBe(100);
    expect(plot.upper).toBe(100);
  });
  it('centers large deterministic atoms whose ULP exceeds a one-dollar pad', () => {
    expect(
      probabilityBars(
        [{ lower_pnl: 1e24, upper_pnl: 1e24, probability: 1 }],
        300,
      )[0],
    ).toMatchObject({ x: 150, width: 0 });
    const result = response();
    result.terminal_price_bins = [
      {
        lower_spot: 1e24,
        upper_spot: 1e24,
        representative_spot: 1e24,
        probability: 1,
      },
    ];
    result.terminal_payoff_curve = [{ spot: 1e24, pnl: -1e24 }];
    expect(terminalProbabilityPlot(result, 300)?.points[0].x).toBe(150);
    expect(terminalProbabilityPlot(result, 300)?.points[0].y).not.toBeNaN();
  });
  it('retains exact returned strike vertices and unequal price-bin widths', () => {
    const result = response();
    result.terminal_price_bins = [
      {
        lower_spot: 80,
        upper_spot: 100,
        representative_spot: 90,
        probability: 0.6,
      },
      {
        lower_spot: 100,
        upper_spot: 160,
        representative_spot: 120,
        probability: 0.4,
      },
    ];
    result.terminal_payoff_curve = [
      { spot: 80, pnl: -500 },
      { spot: 100, pnl: -500 },
      { spot: 160, pnl: 5500 },
    ];
    const plot = terminalProbabilityPlot(result, 400)!;
    expect(plot.bins.map(b => b.width)).toEqual([100, 300]);
    expect(plot.bins[0].height).toBe(100);
    expect(plot.bins[1].height).toBeCloseTo(200 / 3, 9);
    expect(plot.maxProbability).toBe(0.6);
    expect(plot.points.map(p => p.x)).toEqual([0, 100, 400]);
    expect(plot.points.map(p => p.point.pnl)).toEqual([-500, -500, 5500]);
    expect(plot.payoffPath.match(/L/g)).toHaveLength(2);
    result.terminal_payoff_curve.pop();
    expect(terminalProbabilityError(result)).toMatch(/cover/);
    expect(terminalProbabilityPlot(result)).toBeNull();
  });
  it('rejects missing, nonfinite and misaligned terminal price data without a fallback', () => {
    const result = response();
    result.terminal_price_bins = [];
    expect(terminalProbabilityError(result)).toMatch(/missing/);
    result.terminal_price_bins = [
      { lower_spot: 0, upper_spot: 5, representative_spot: 6, probability: 1 },
    ];
    expect(terminalProbabilityError(result)).toMatch(/invalid/);
  });
  it('accepts the 35 payoff vertices of a 16-leg strategy with 17 breakevens', () => {
    const result = response();
    const curve = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        spot: 1 + (i * 34) / (n - 1),
        pnl: i % 2 ? 100 : -100,
      }));
    result.terminal_price_bins = [
      {
        lower_spot: 1,
        upper_spot: 35,
        representative_spot: 18,
        probability: 1,
      },
    ];
    result.terminal_payoff_curve = curve(35);
    expect(terminalProbabilityError(result)).toBeNull();
    result.terminal_payoff_curve = curve(36);
    expect(terminalProbabilityError(result)).toMatch(/missing/);
  });
});

describe('explicit request lifecycle and privacy fencing', () => {
  it('does not compute when constructed or contexts change', () => {
    const compute = vi.fn();
    const runner = new ProbabilityRunner(compute, vi.fn());
    runner.context('guest:1', 'draft');
    runner.context('account:2', 'draft');
    expect(compute).not.toHaveBeenCalled();
  });
  it('isolates submitted inputs and keeps previous evidence during a refresh', async () => {
    let state = emptyProbabilityState();
    const refresh = deferred<DistributionResponse>();
    const compute = vi
      .fn()
      .mockResolvedValueOnce(response())
      .mockReturnValueOnce(refresh.promise);
    const runner = new ProbabilityRunner(compute, next => {
      state = next;
    });
    const input = request();
    await runner.run('doc', 'one', input);
    const task = runner.run('doc', 'two', input);
    input.analysis.spot = 50;
    expect(state.result).not.toBeNull();
    expect(state.pending).toBe(true);
    expect(compute.mock.calls[1][0].analysis.spot).toBe(100);
    refresh.resolve(response());
    await task;
    expect(state.submitted?.analysis.spot).toBe(100);
    expect(Object.isFrozen(state.submitted?.analysis.strategy.legs[0])).toBe(
      true,
    );
    expect(state.resultKey).toBe('two');
  });
  it('clears private evidence on document/account transition and ignores late success', async () => {
    let state = emptyProbabilityState();
    const late = deferred<DistributionResponse>();
    let signal!: AbortSignal;
    const runner = new ProbabilityRunner(
      (_, s) => {
        signal = s;
        return late.promise;
      },
      next => {
        state = next;
      },
    );
    const task = runner.run('guest:1', 'key', request());
    runner.context('account:2', 'key');
    expect(signal.aborted).toBe(true);
    late.resolve(response());
    await task;
    expect(state).toEqual({
      ...emptyProbabilityState(),
      documentKey: 'account:2',
    });
  });
  it.each(['cancel', 'draft', 'dispose', 'replace'])(
    'fences late success/error/finally after %s',
    async action => {
      let state = emptyProbabilityState();
      const first = deferred<DistributionResponse>(),
        second = deferred<DistributionResponse>();
      const signals: AbortSignal[] = [];
      const runner = new ProbabilityRunner(
        (_, signal) => {
          signals.push(signal);
          return signals.length === 1 ? first.promise : second.promise;
        },
        next => {
          state = next;
        },
      );
      const task = runner.run('doc', 'one', request());
      let replacement: Promise<void> | undefined;
      if (action === 'cancel') runner.cancel();
      if (action === 'draft') runner.context('doc', 'two');
      if (action === 'dispose') runner.dispose();
      if (action === 'replace')
        replacement = runner.run('doc', 'two', request());
      const before = state;
      first.reject(new Error('secret raw server content'));
      await task;
      expect(signals[0].aborted).toBe(true);
      expect(state).toBe(before);
      expect(state.error).toBeNull();
      if (replacement) {
        second.resolve(response());
        await replacement;
        expect(state.resultKey).toBe('two');
      }
    },
  );
  it('shows a retryable error without exposing raw server content', async () => {
    let state = emptyProbabilityState();
    const runner = new ProbabilityRunner(
      async () => {
        throw new Error('raw secret');
      },
      next => {
        state = next;
      },
    );
    await runner.run('doc', 'one', request());
    expect(state.pending).toBe(false);
    expect(state.error).toMatch(/retry explicitly/);
    expect(state.error).not.toMatch(/raw secret/);
  });
  it('bounds client pending time and rejects a non-cooperative timed-out success', async () => {
    vi.useFakeTimers();
    try {
      let state = emptyProbabilityState();
      const delayed = deferred<DistributionResponse>();
      let signal!: AbortSignal;
      const runner = new ProbabilityRunner(
        (_, s) => {
          signal = s;
          return delayed.promise;
        },
        next => {
          state = next;
        },
      );
      const task = runner.run('doc', 'one', request());
      await vi.advanceTimersByTimeAsync(15000);
      expect(state.pending).toBe(false);
      expect(signal.aborted).toBe(true);
      expect(state.error).toMatch(/timed out/);
      const before = state;
      delayed.resolve(response());
      await task;
      expect(state).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });
  it('preserves previous successful evidence when refresh returns empty bins', async () => {
    let state = emptyProbabilityState();
    let next = response();
    const runner = new ProbabilityRunner(
      async () => next,
      value => {
        state = value;
      },
    );
    await runner.run('doc', 'one', request());
    const previous = state.result;
    next = { ...response(), bins: [] };
    await runner.run('doc', 'two', request());
    expect(state.result).toBe(previous);
    expect(state.resultKey).toBe('one');
    expect(state.error).toMatch(/empty evidence/);
  });
  it('discards a late successful reply after same-document draft edits', async () => {
    let state = emptyProbabilityState();
    const delayed = deferred<DistributionResponse>();
    const runner = new ProbabilityRunner(
      () => delayed.promise,
      next => {
        state = next;
      },
    );
    const task = runner.run('doc', 'one', request());
    runner.context('doc', 'two');
    delayed.resolve(response());
    await task;
    expect(state.result).toBeNull();
    expect(state.cancelled).toBe(true);
  });
  it('discards a reply that lands after the account session changes', async () => {
    let state = emptyProbabilityState();
    const late = deferred<DistributionResponse>();
    const runner = new ProbabilityRunner(
      () => late.promise,
      next => {
        state = next;
      },
    );
    const task = runner.run('doc', 'key', request());
    try {
      setAccessToken('test-only');
      late.resolve(response());
      await task;
    } finally {
      clearAccessToken();
    }
    expect(state.result).toBeNull();
  });
});

describe('probability lab server-rendered accessibility contract', () => {
  it('renders explicit action, assumptions and labels without computing on mount', () => {
    const html = render(OptionsProbabilityLab, {
      props: { draft: createOptionsDraft(), documentKey: 'guest:1' },
    }).body;
    expect(html).toContain('Compute distribution');
    expect(html).toContain('not calibrated real-world forecasts');
    expect(html).toContain('No completed distribution');
    expect(html).toContain('Risk-neutral');
    expect(html).toContain('User drift');
    expect(html).toContain('type="submit"');
    expect(html).not.toContain('NaN');
  });
  it('accepts optional onEdit, explains read-only authoring, and blocks mixed expiries', () => {
    const draft = createOptionsDraft();
    draft.strategy.legs.push({ ...draft.strategy.legs[0], days_to_expiry: 90 });
    const onEdit = vi.fn();
    const html = render(OptionsProbabilityLab, {
      props: { draft, documentKey: 'account:2', readOnly: true, onEdit },
    }).body;
    expect(html).toContain('Read-only strategy');
    expect(html).toContain('Mixed-expiry probability is unsupported');
    expect(html).toContain('disabled');
    expect(onEdit).not.toHaveBeenCalled();
  });
});

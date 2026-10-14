import { describe, expect, it } from 'vitest';
import {
  comparisonContext,
  comparisonCurve,
  comparisonSnapshot,
  optionsResultCsv,
  optionsResultReport,
} from './optionsComparison';
import { createOptionsDraft } from './optionsTemplates';
import type { OptionsAnalysis } from './optionsTypes';

function result(): OptionsAnalysis {
  const request = createOptionsDraft();
  request.spot_grid = [50, 150];
  request.strategy.underlying = 'Manual index';
  Object.assign(request.strategy, {
    valuation_date: '2026-01-01',
    expiry_date: '2026-01-31',
    entry_fee_per_contract: 1,
  });
  request.strategy.legs[0].implied_volatility = 0.3;
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
      entry_fees: 1,
      net_entry_cost: 501,
      entry_debit: 501,
      entry_credit: 0,
      theoretical_value_today: 520,
      pnl_today: 19,
      max_profit: null,
      max_loss: 501,
      profit_unbounded: true,
      loss_unbounded: false,
      breakevens: [105.01],
      zero_intervals: [],
    },
    spot_grid: [50, 150],
    today_pnl: [-501, 4499],
    expiry_pnl: [-501, 4499],
    expiry_curve: [
      { spot: 50, pnl: -501 },
      { spot: 100, pnl: -501 },
      { spot: 105.01, pnl: 0 },
      { spot: 150, pnl: 4499 },
    ],
    greeks: { delta: 50, gamma: 0.1, theta: null, vega: 1e-12, rho: -0.5 },
    greeks_grid: [],
    greek_units: {
      delta: 'USD per USD spot (equivalent shares)',
      gamma: 'delta per USD spot',
      theta: 'USD per calendar day elapsed',
      vega: 'USD per 1 volatility percentage point',
      rho: 'USD per 1 rate percentage point',
    },
    scenarios: [],
    warnings: ['Manual inputs.'],
    surface: {
      axis: 'elapsed_days',
      spots: [50, 150],
      steps: [0, 30],
      pnl: [
        [-500, 4500],
        [-501, 4499],
      ],
    },
  };
}
describe('submitted comparison and reproducibility helpers', () => {
  it('clones/deep-freezes canonical evidence/source and labels every material assumption', () => {
    const r = result();
    const snapshot = comparisonSnapshot('pin', r, '# custom Python');
    r.request.strategy.legs[0].implied_volatility = 0.9;
    expect(snapshot.result.request.strategy.legs[0].implied_volatility).toBe(
      0.3,
    );
    expect(snapshot.source).toBe('# custom Python');
    expect(Object.isFrozen(snapshot.result.surface!.pnl[0])).toBe(true);
    const context = comparisonContext(snapshot).join('\n');
    for (const label of [
      'Manual index',
      '100 USD',
      '20%',
      'leg 1: 0.3',
      '1 USD/option contract',
      'total 1 USD',
      '30 calendar days',
      '2026-01-01',
      '2026-01-31',
      'black_scholes_merton v1',
      'ACT/365',
      'manual',
      'european',
      'cash',
      'USD',
    ])
      expect(context).toContain(label);
  });
  it('uses exact canonical vertices, never reconstructs strike/breakeven values from sparse arrays', () => {
    const r = result();
    const snapshot = comparisonSnapshot('pin', r, null);
    expect(comparisonCurve(snapshot)).toEqual(r.expiry_curve);
    delete r.expiry_curve;
    expect(comparisonCurve(comparisonSnapshot('old', r, null))).toBeNull();
    r.expiry_curve = [
      { spot: 50, pnl: -1 },
      { spot: 50, pnl: 1 },
    ];
    expect(comparisonCurve(comparisonSnapshot('bad', r, null))).toBeNull();
    r.expiry_curve = [
      { spot: 50, pnl: NaN },
      { spot: 150, pnl: 1 },
    ];
    expect(comparisonCurve(comparisonSnapshot('bad', r, null))).toBeNull();
  });
  it('exports exact canonical paths/units/undefined Greeks and report source without zero substitution', () => {
    const r = result();
    r.request.strategy.name = '=HYPERLINK("private")';
    const csv = optionsResultCsv(r);
    expect(csv).toContain('"greeks.theta","null"');
    expect(csv).toContain('1e-12');
    expect(csv).toContain('surface.pnl.1.1');
    expect(csv).toContain('request.strategy.legs.0.implied_volatility');
    expect(csv).toContain('""=HYPERLINK(');
    expect(csv.endsWith('\r\n')).toBe(true);
    const report = JSON.parse(
      optionsResultReport(r, '# authored source', 'printed output'),
    );
    expect(report.result).toEqual(r);
    expect(report.submittedSource).toBe('# authored source');
    expect(report.stdout).toBe('printed output');
    expect(report.provenance).toContain('Not provider verified');
  });
  it.each([
    'negative',
    'missing strike',
    'missing breakeven',
    'wrong domain',
    'oversized',
  ])('rejects %s expiry vertices instead of drawing altered evidence', kind => {
    const r = result();
    if (kind === 'negative') r.expiry_curve![0].spot = -1;
    if (kind === 'missing strike') r.expiry_curve!.splice(1, 1);
    if (kind === 'missing breakeven') r.expiry_curve!.splice(2, 1);
    if (kind === 'wrong domain') r.request.spot_grid = [60, 140];
    if (kind === 'oversized')
      r.expiry_curve = Array.from({ length: 36 }, (_, i) => ({
        spot: 50 + i,
        pnl: 0,
      }));
    expect(comparisonCurve(comparisonSnapshot('bad', r, null))).toBeNull();
  });
});

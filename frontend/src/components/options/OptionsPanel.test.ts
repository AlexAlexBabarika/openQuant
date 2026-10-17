import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { readFileSync } from 'node:fs';
import { OptionsState } from '$lib/features/options/optionsState.svelte';
import type { OptionsAnalysis } from '$lib/features/options/optionsTypes';
import {
  optionsSeries,
  expiryTraceError,
} from '$lib/features/options/optionsChart';
import {
  comparisonCurve,
  comparisonSnapshot,
  optionsResultCsv,
  optionsResultReport,
} from '$lib/features/options/optionsComparison';
import OptionsPanel from './OptionsPanel.svelte';
import OptionsSummary from './OptionsSummary.svelte';
import OptionsCharts from './OptionsCharts.svelte';
import OptionsResearchTools from './OptionsResearchTools.svelte';

vi.mock('$lib/features/options/optionsState.svelte', async importOriginal => ({
  ...(await importOriginal<
    typeof import('$lib/features/options/optionsState.svelte')
  >()),
  OptionsState: vi.fn(),
}));

let state: OptionsState;
beforeEach(async () => {
  const actual = await vi.importActual<
    typeof import('$lib/features/options/optionsState.svelte')
  >('$lib/features/options/optionsState.svelte');
  state = new actual.OptionsState();
  vi.mocked(OptionsState).mockImplementation(function () {
    return state;
  });
});

function result(mixed = false): OptionsAnalysis {
  const greeks = { delta: 0, gamma: 0, theta: null, vega: 0, rho: 0 };
  return {
    request: structuredClone(state.draft),
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
      theoretical_value_today: 500,
      pnl_today: 0,
      max_profit: null,
      max_loss: mixed ? null : 500,
      profit_unbounded: mixed ? null : true,
      loss_unbounded: mixed ? null : false,
      breakevens: mixed ? [] : [105],
      zero_intervals: [],
    },
    spot_grid: [80, 100, 120],
    today_pnl: [-500, -300, 1500],
    expiry_pnl: mixed ? [] : [-500, -500, 1500],
    expiry_curve: mixed
      ? []
      : [
          { spot: 80, pnl: -500 },
          { spot: 100, pnl: -500 },
          { spot: 105, pnl: 0 },
          { spot: 120, pnl: 1500 },
        ],
    horizon: {
      kind: mixed ? 'mixed_expiry' : 'single_expiry',
      first_expiry_days: 30,
      last_expiry_days: mixed ? 60 : 30,
      elapsed_days: 0,
      exact_terminal_available: !mixed,
      legs: [],
    },
    horizon_pnl: [-300, -100, 1700],
    greeks,
    greeks_grid: [greeks, greeks, greeks],
    scenarios: [],
    warnings: [],
    greek_units: {
      delta: 'USD per USD spot (equivalent shares)',
      gamma: 'delta per USD spot',
      theta: 'USD per calendar day elapsed',
      vega: 'USD per 1 volatility percentage point',
      rho: 'USD per 1 rate percentage point',
    },
  };
}

describe('integrated options workbench', () => {
  it('renders compact research navigation without submitting or editing', () => {
    const onEdit = vi.fn();
    const html = render(OptionsResearchTools, {
      props: {
        draft: new Proxy(state.draft, {}),
        onEdit,
        documentKey: 'guest:1:editor',
      },
    }).body;
    for (const label of [
      'Volatility skew',
      'Hypothetical event stress',
      'Constrained strategy finder',
      'Read-only provider chain',
      'Multi-expiry lifecycle',
      'Delta-hedging path',
      'Probability &amp; tail risk',
    ])
      expect(html).toContain(label);
    expect(html).not.toContain('Search strategies');
    expect(html).not.toContain('Simulate hedge path');
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('mounts editor expiry authoring and research without requiring results', () => {
    const html = render(OptionsPanel).body;
    expect(html).toContain('calendar / diagonal');
    expect(html).toContain('Research tools');
    expect(html).toContain('US exercise and physical delivery are not modeled');
    expect(html).not.toContain('One common expiry, ACT/365');
    expect(html).toContain('Common expiry is the default');
    expect(html).not.toContain('One common expiry; no per-leg dates.');
  });

  it('never offers visual-draft research in Python mode without submitted evidence', () => {
    state.mode = 'python';
    const html = render(OptionsPanel).body;
    expect(html).toContain(
      'Research tools never use the visual draft in Python mode',
    );
    expect(html).not.toContain('aria-label="Research tools"');
    expect(html).not.toContain(
      'Per-leg expiries · calendar / diagonal construction',
    );
  });

  it('inspects submitted Python read-only, hiding tools on custom-source divergence', () => {
    state.mode = 'python';
    state.source = '# submitted python';
    state.submittedSource = state.source;
    state.result = result();
    let html = render(OptionsPanel).body;
    expect(html).toContain('aria-label="Research tools"');
    expect(html).toContain('read-only');
    state.source = '# changed custom python';
    html = render(OptionsPanel).body;
    expect(html).not.toContain('aria-label="Research tools"');
    expect(html).toContain('Research tools never use the visual draft');
  });

  it('fences controlled authoring by auth generation, document and mode, not ordinary edit revisions', () => {
    const panel = readFileSync(
      new URL('./OptionsPanel.svelte', import.meta.url),
      'utf8',
    );
    expect(panel).toContain('getSessionGeneration()');
    expect(panel).toContain(
      '${sessionKey}:${options.documentKey}:${options.mode}',
    );
    expect(panel).toContain('{#key toolKey}');
    expect(panel).toContain(
      "draft={options.mode === 'editor' ? options.draft : undefined}",
    );
    expect(panel).toContain('onEdit={update => options.editDraft(update)}');
    expect(panel).toContain('draft={result.request}');
    const tools = readFileSync(
      new URL('./OptionsResearchTools.svelte', import.meta.url),
      'utf8',
    );
    expect(tools).toContain('{#key documentKey}');
    expect(tools).toContain('{:else if selected');
  });

  it('discloses mixed-expiry marks in charts, risk strip, comparison and exports', () => {
    const r = result(true);
    r.request.strategy.legs[0].days_to_expiry = 0;
    r.request.strategy.legs[0].source = {
      provider: 'tradier',
      environment: 'sandbox',
      contract_symbol: 'SPY260116C00100000',
      underlying: 'SPY',
      fetched_at: '2026-01-01T12:00:00Z',
      bid_as_of: null,
      ask_as_of: null,
    };
    state.result = r;
    const panel = render(OptionsPanel).body;
    expect(panel).toContain('0 days');
    expect(panel).toContain('SPY260116C00100000');
    expect(panel).toContain('Hypothetical conversion only');
    const html = render(OptionsCharts, { props: { result: r } }).body;
    expect(html).toContain('First-expiry model marks');
    expect(html).toContain('no common-expiry payoff, extrema, breakevens');
    expect(optionsSeries(r).find(s => s.id === 'horizon')?.values).toEqual(
      r.horizon_pnl,
    );
    expect(expiryTraceError(r)).toContain('no exact terminal trace');
    expect(render(OptionsSummary, { props: { result: r } }).body).toContain(
      'Unavailable · mixed expiry',
    );
    expect(comparisonCurve(comparisonSnapshot('mixed', r, null))).toBeNull();
    const report = JSON.parse(optionsResultReport(r, null, null));
    expect(report.horizonDisclosure).toContain('no exact terminal curve');
    const csv = optionsResultCsv(r);
    expect(csv).toContain('exact_terminal_available');
    expect(csv).toContain('"false"');
    expect(csv).toContain('"expiry_curve","[]"');
    expect(csv).toContain('"summary.max_loss","null"');
  });
});

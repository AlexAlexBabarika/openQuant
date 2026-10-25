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
import OptionsChainPicker from './OptionsChainPicker.svelte';
import OptionsLibrary from './OptionsLibrary.svelte';

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

/** Text a person sees: closed <details> show only their summary; hidden and sr-only text is skipped. */
function visibleText(html: string): string {
  const out: string[] = [];
  const stack: number[] = [];
  let hidden = 0;
  const source = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|title|desc)\b[\s\S]*?<\/\1>/g, '');
  for (const [, tag, text] of source.matchAll(/(<[^>]+>)|([^<]+)/g)) {
    if (text) {
      if (hidden <= 0) out.push(text);
      continue;
    }
    const name = /^<\/?([a-z0-9-]+)/i.exec(tag)?.[1]?.toLowerCase();
    if (
      !name ||
      tag.endsWith('/>') ||
      ['input', 'img', 'br', 'hr', 'path', 'line', 'rect', 'circle'].includes(
        name,
      )
    )
      continue;
    if (tag.startsWith('</')) {
      hidden -= stack.pop() ?? 0;
      continue;
    }
    const parentHidesDetails =
      stack[stack.length - 1] === 1 && name === 'summary';
    const delta = parentHidesDetails
      ? -1
      : / hidden(=|\s|>)/.test(tag) ||
          /class="[^"]*\bsr-only\b/.test(tag) ||
          (name === 'details' && !/ open(=|\s|>)/.test(tag))
        ? 1
        : 0;
    stack.push(delta);
    hidden += delta;
  }
  return out
    .join(' ')
    .replace(/&amp;/g, '&')
    .replace(/&[a-z#0-9]+;/gi, ' ');
}
const words = (html: string) =>
  visibleText(html)
    .split(/\s+/)
    .filter(w => /[A-Za-z0-9]/.test(w)).length;

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
    expect(html.match(/role="tab"/g)).toHaveLength(8);
    expect(html.slice(0, html.indexOf('role="tabpanel"'))).not.toContain(
      '<select',
    );
    for (const label of [
      'Scenarios',
      'Skew',
      'Stress',
      'Probability',
      'Lifecycle',
      'Hedging',
      'Find a trade',
      'Live chain',
    ])
      expect(html).toMatch(new RegExp(`role="tab"[^>]*>${label}</button>`));
    expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>Scenarios/);
    expect(html).not.toContain('Search strategies');
    expect(html).not.toContain('Simulate hedge path');
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('mounts editor expiry authoring and research without requiring results', () => {
    const html = render(OptionsPanel).body;
    expect(html).toContain('calendar / diagonal');
    expect(html).toContain('Research tools');
    expect(html).toContain('physical delivery are not modeled');
    expect(html).not.toContain('One common expiry, ACT/365');
    expect(html).toContain('set per-leg expiries below');
    expect(html).not.toContain('One common expiry; no per-leg dates.');
  });

  it('formats risk totals for people and keeps exact values in titles', () => {
    const r = result();
    r.summary.pnl_today = 2024.6332556364023;
    r.summary.entry_debit = 259.04;
    const html = render(OptionsSummary, { props: { result: r } }).body;
    expect(html).toContain('+$2,024.63');
    expect(html).toContain('title="2024.6332556364023"');
    expect(html).toContain('$259.04');
  });

  it('formats Greeks and breakevens in the evidence column', () => {
    const r = result();
    r.greeks = { ...r.greeks, delta: 99.99630519765367 };
    r.summary.breakevens = [105.01234];
    state.result = r;
    const html = render(OptionsPanel).body;
    expect(html).toMatch(/<dt[^>]*>delta<\/dt><dd[^>]*>\+100<\/dd>/);
    expect(html).toContain('USD spot:</strong> 105.01.');
  });

  it('opens the chain picker on the draft underlying without an error', () => {
    const draft = structuredClone(state.draft);
    draft.strategy.underlying = null;
    const props = { onEdit: vi.fn(), documentKey: 'guest:1:editor' };
    const blank = render(OptionsChainPicker, {
      props: { ...props, draft },
    }).body;
    expect(blank).not.toContain('Enter a symbol of 1–32');
    draft.strategy.underlying = 'AAPL';
    const aapl = render(OptionsChainPicker, {
      props: { ...props, draft },
    }).body;
    expect(aapl).toContain('value="AAPL"');
  });

  it('edits IV, rate and yield as percentages and expiry as one date', () => {
    state.draft.volatility = 0.283;
    state.draft.rate = 0.04;
    const html = render(OptionsPanel).body;
    expect(html).toContain('IV · %');
    expect(html).toContain('value="28.3"');
    expect(html).toContain('value="4"');
    expect(html).not.toContain('fraction (0–5)');
    expect(html).toMatch(/Expiry<\/span><input type="date"/);
    expect(html).toContain('30 days');
    expect(html).toContain('Pricing assumptions');
  });

  it('shows analysis status instead of an Analyze button in editor mode', () => {
    let html = render(OptionsPanel).body;
    expect(html).not.toMatch(/>\s*Analyze\s*<\/button>/);
    expect(html).toContain('role="status"');
    expect(html).toContain('Updating…');
    state.error = 'Options analysis timed out.';
    html = render(OptionsPanel).body;
    expect(html).toContain('Analysis failed');
  });

  it('picks templates from chips that show their payoff shape', () => {
    const html = render(OptionsPanel).body;
    expect(html).not.toContain('Replace legs');
    expect(html).toMatch(
      /<button[^>]*aria-pressed="true"[^>]*>\s*<svg[^>]*>.*?<\/svg>\s*Long call/s,
    );
    expect(html).toMatch(
      /<button[^>]*aria-pressed="false"[^>]*>\s*<svg[^>]*>.*?<\/svg>\s*Iron condor/s,
    );
  });

  it('tags each premium as model-priced or manual', () => {
    let html = render(OptionsPanel).body;
    expect(html).toMatch(/class="premium-source[^"]*"[^>]*>\s*Model price/);
    state.editDraft(d => {
      d.strategy.legs[0].entry_premium = 3;
    });
    html = render(OptionsPanel).body;
    expect(html).toMatch(/class="premium-source[^"]*"[^>]*>\s*Manual/);
    expect(html).toMatch(/<button[^>]*>Use model price<\/button>/);
  });

  it('puts the research tools under the chart, labelled with the analysis they read', () => {
    state.result = result();
    const html = render(OptionsPanel).body;
    const charts = html.indexOf('options-charts');
    const tools = html.indexOf('aria-label="Research tools"');
    expect(tools).toBeGreaterThan(charts);
    expect(html.indexOf('evidence-column')).toBeLessThan(charts);
    expect(html).toMatch(/Analysis of Long call · (up to date|updating)/);
    expect(html.match(/aria-label="Options scenario lab"/g)).toHaveLength(1);
  });

  it('states the model once, with what it leaves out, in under 300 words before analysis', () => {
    const html = render(OptionsPanel).body;
    const text = visibleText(html);

    expect(
      text.match(/Black-Scholes values for European, cash-settled options/g),
    ).toHaveLength(1);
    expect(html.match(/What the model leaves out/g)).toHaveLength(1);
    expect(words(html)).toBeLessThan(300);
  });

  it('says inputs changed once, not once per section', () => {
    state.result = result();
    state.editDraft(d => {
      d.spot = 101;
    });
    const html = render(OptionsPanel).body;
    expect(visibleText(html).match(/Inputs changed/g)).toHaveLength(1);
  });

  it('offers a save retry only after a failed save, and shows recovery time for people', () => {
    let html = render(OptionsLibrary, { props: { state } }).body;
    expect(html).not.toContain('Retry working save');
    state.recovery = {
      draft: structuredClone(state.draft),
      mode: 'editor',
      source: state.source,
      updatedAt: '2026-10-18T09:00:00.000Z',
    };
    state.storageError = 'Options draft was not saved.';
    html = render(OptionsLibrary, { props: { state } }).body;
    expect(html).toContain('Retry working save');
    expect(html).not.toContain('2026-10-18T09:00:00.000Z');
    expect(html).toMatch(/>Discard recovery…<\/button>/);
  });

  it('shows the risk totals in the evidence column, above the chart', () => {
    state.result = result();
    const html = render(OptionsPanel).body;
    const evidence = html.indexOf('evidence-column');
    const summary = html.indexOf('risk-summary');
    const charts = html.indexOf('options-charts');
    expect(evidence).toBeGreaterThan(-1);
    expect(summary).toBeGreaterThan(evidence);
    expect(charts).toBeGreaterThan(summary);
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

  it('inspects submitted Python read-only, hiding tools on custom-source divergence', async () => {
    const actual = await vi.importActual<
      typeof import('$lib/features/options/optionsState.svelte')
    >('$lib/features/options/optionsState.svelte');
    state = new actual.OptionsState(null, async () => result());
    state.setMode('python');
    state.setSource('# submitted python');
    await state.run();
    let html = render(OptionsPanel).body;
    expect(html).toContain('aria-label="Research tools"');
    expect(html).toContain('Read-only in Python mode');
    state.setSource('# changed custom python');
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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { clearAccessToken, setAccessToken } from '$lib/core/api';
import StrategyTrial from './StrategyTrial.svelte';
import ReportContext from './ReportContext.svelte';
import type { TrialReport } from '../trial-report/types';
import ReportActions from '../trial-report/ReportActions.svelte';
import {
  generateTrialReportHtml,
  trialReportFilename,
} from '../trial-report/export';
import { formatMoney } from './evidence';
import {
  isWorkspaceReport,
  parseParameterOverrides,
  runWorkspaceChecks,
  workspaceFingerprint,
  type WorkspaceContext,
  type WorkspaceReport,
  type WorkspaceSettings,
} from './workspace';

const context: WorkspaceContext = {
  code: 'def on_bar(ctx):\n    pass\n',
  name: 'My draft',
  symbol: 'MSFT',
  provider: 'yfinance',
  period: '1y',
  interval: '1d',
};
const settings: WorkspaceSettings = {
  starting_cash: 25_000,
  commission_bps: 2,
  slippage_bps: 8,
  holdout_fraction: 0.3,
  params: { fast: 10 },
  sensitivity_parameter: 'fast',
};

function fixture(): WorkspaceReport {
  const run = {
    total_return: 0.12,
    max_drawdown: -0.08,
    trade_count: 1,
    total_cost: 4,
    equity: [
      { t: 1735689600, value: 25_000 },
      { t: 1735776000, value: 28_000 },
    ],
  };
  return {
    schema_version: 1,
    source: 'workspace',
    report_id: 'report-hash',
    code_hash: 'source-hash',
    engine_version: 'engine-version',
    strategy: {
      id: 'workspace',
      name: 'My draft',
      description: 'Current editor source',
      lesson: 'No optimization',
    },
    dataset: {
      id: 'yfinance:MSFT',
      label: 'MSFT · yfinance · 1y / 1d',
      version: 'bars-hash',
      synthetic: false,
      start: '2025-01-01',
      end: '2025-04-01',
      split_date: '2025-03-01',
      training_bars: 70,
      holdout_bars: 30,
    },
    config: { ...settings, strategy_id: 'workspace', seed: 0 },
    baseline: run,
    realistic: run,
    benchmark: run,
    holdout: { strategy: run, benchmark: run },
    sensitivity: [
      { parameter_value: 10, total_return: 0.12, max_drawdown: -0.08 },
    ],
    selected_parameter: { name: 'fast', value: 10 },
    findings: [],
    assumptions: ['Fresh strategy state'],
    limitations: ['No proof of unseen dates'],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearAccessToken();
});

describe('workspace robustness inputs and boundary', () => {
  it('uses the current editor/context with authenticated POST, never a code-bearing URL', async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify(fixture()), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetch);
    setAccessToken('test-access-token');
    const controller = new AbortController();
    const report = await runWorkspaceChecks(
      context,
      settings,
      controller.signal,
    );
    expect(isWorkspaceReport(report)).toBe(true);
    const [url, options] = fetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('/backtests/robustness');
    expect(options.method).toBe('POST');
    expect(options.signal).toBe(controller.signal);
    expect(new Headers(options.headers).get('Authorization')).toBe(
      'Bearer test-access-token',
    );
    expect(JSON.parse(options.body as string)).toEqual({
      ...context,
      ...settings,
      seed: 0,
    });
  });

  it('surfaces server validation/authentication failures rather than fabricating evidence', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ detail: 'Sign in required' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    await expect(
      runWorkspaceChecks(context, settings, new AbortController().signal),
    ).rejects.toThrow('Sign in required');
  });

  it('accepts finite scalar overrides and rejects malformed, nested or excessive parameters', () => {
    expect(parseParameterOverrides('{}')).toEqual({});
    expect(parseParameterOverrides('{"qty": 3, "side": "long"}')).toEqual({
      qty: 3,
      side: 'long',
    });
    for (const bad of [
      'null',
      '[]',
      '{"qty": true}',
      '{"qty": []}',
      '{"qty": 1e999}',
      'invalid',
      JSON.stringify(
        Object.fromEntries(Array.from({ length: 17 }, (_, i) => [i, 1])),
      ),
    ]) {
      expect(() => parseParameterOverrides(bad)).toThrow();
    }
  });

  it('marks source, data-context or configuration changes as a different completed-run fingerprint', () => {
    const original = workspaceFingerprint(context, settings);
    expect(workspaceFingerprint({ ...context }, { ...settings })).toBe(
      original,
    );
    for (const changed of [
      { code: context.code + '\n' },
      { name: 'Other draft' },
      { symbol: 'AAPL' },
      { provider: 'binance' as const },
      { period: '5y' },
      { interval: '1h' },
    ]) {
      expect(
        workspaceFingerprint({ ...context, ...changed }, settings),
      ).not.toBe(original);
    }
    expect(
      workspaceFingerprint(context, { ...settings, params: { fast: 20 } }),
    ).not.toBe(original);
    expect(
      workspaceFingerprint(context, { ...settings, commission_bps: 5 }),
    ).not.toBe(original);
  });

  it('renders a workspace-first configuration, not an automatic synthetic result', () => {
    const html = render(StrategyTrial, {
      props: { workspace: context, embedded: true },
    }).body;
    for (const label of [
      'Current workspace strategy',
      'My draft',
      'MSFT',
      'Parameter overrides (JSON)',
      'Starting cash',
      'Chronological holdout (%)',
      'Edit strategy',
      'Sign in',
      'No results yet',
    ])
      expect(html).toContain(label);
    expect(html).not.toContain('Example strategy');
    expect(html).not.toContain('EXAMPLE DATA');
    expect(html).not.toContain('value="workspace" selected disabled');
  });
});

describe('private workspace evidence export', () => {
  it('renders completed context from the report, including the original market and source identity', () => {
    const report = fixture();
    const receivedAt = '2026-10-04T18:30:00.000Z';
    const html = render(ReportContext, { props: { report, receivedAt } }).body;
    for (const value of [
      'Completed report',
      'MSFT · yfinance · 1y / 1d',
      '25,000.00 currency units',
      'source-hash',
      'bars-hash',
      'engine-version',
      'Report received (UTC)',
      receivedAt,
      'My draft',
    ])
      expect(html).toContain(value);
    expect(html).not.toContain(context.code);
    expect(html).not.toContain('$10,000');
    expect(html).not.toContain('synthetic example');
    const changedInputs = {
      ...context,
      name: 'Different draft',
      symbol: 'AAPL',
      period: '5y',
    };
    expect(workspaceFingerprint(changedInputs, settings)).not.toBe(
      workspaceFingerprint(context, settings),
    );
    expect(
      render(ReportContext, { props: { report, receivedAt } }).body,
    ).not.toContain('Different draft');
    expect(
      render(ReportContext, { props: { report, receivedAt } }).body,
    ).not.toContain('AAPL');
  });

  it('keeps synthetic provenance distinct from workspace source and cash', () => {
    const workspaceReport = fixture();
    const report: TrialReport = {
      schema_version: 1,
      report_id: 'example-report',
      strategy: { ...workspaceReport.strategy, id: 'boring-benchmark' },
      dataset: {
        ...workspaceReport.dataset,
        label: 'Synthetic scenario',
        synthetic: true,
      },
      config: {
        strategy_id: 'boring-benchmark',
        commission_bps: 1,
        slippage_bps: 5,
      },
      baseline: workspaceReport.baseline,
      realistic: workspaceReport.realistic,
      benchmark: workspaceReport.benchmark,
      holdout: workspaceReport.holdout,
      sensitivity: [],
      selected_parameter: null,
      findings: [],
      assumptions: [],
      limitations: [],
    };
    const html = render(ReportContext, {
      props: { report, receivedAt: '2026-10-04T18:30:00.000Z' },
    }).body;
    expect(html).toContain('synthetic example');
    expect(html).toContain('$10,000');
    expect(html).not.toContain('Source SHA-256');
    expect(html).not.toContain('Engine / seed');
    expect(html).not.toContain('25,000.00');
  });

  it('exports actual cash and provenance without demo/untouched-holdout claims or source', () => {
    const report = fixture();
    const html = generateTrialReportHtml(report);
    for (const value of [
      '25000 currency units',
      'source-hash',
      'bars-hash',
      'engine-version',
      '&quot;fast&quot;:10',
      'fast = 10 (fixed, not optimized)',
      'Fresh strategy state',
      'No proof of unseen dates',
    ])
      expect(html).toContain(value);
    expect(html).not.toContain('10,000 currency units');
    expect(html).not.toContain('Synthetic educational');
    expect(html).not.toContain('Untouched chronological');
    expect(html).not.toContain('selected using training only');
    expect(html).not.toContain(context.code);
    expect(html).not.toMatch(/<script|<iframe|<img|<link/i);
    expect(trialReportFilename(report)).toBe(
      'openquant-robustness-workspace-report-hash.html',
    );
    const actions = render(ReportActions, { props: { report } }).body;
    expect(actions).toContain('Download HTML snapshot');
    expect(actions).not.toContain('Copy demo configuration link');
    expect(actions).not.toContain('type="url"');
    expect(formatMoney(25_000, true)).toBe('25,000.00');
  });

  it('escapes user-controlled labels and string Choice parameters', () => {
    const report = fixture();
    report.strategy.name = '<script>unsafe()</script>';
    report.selected_parameter = {
      name: '<name>',
      value: '<img src=x onerror=unsafe()>',
    };
    report.sensitivity[0].parameter_value = '<svg onload=unsafe()>';
    const html = generateTrialReportHtml(report);
    expect(html).toContain('&lt;script&gt;unsafe()&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=unsafe()&gt;');
    expect(html).toContain('&lt;svg onload=unsafe()&gt;');
    expect(html).not.toContain('<script>unsafe()');
    expect(html).not.toContain('<img src=x');
  });
});

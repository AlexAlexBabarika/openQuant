import { afterEach, describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import { componentDeclarations } from '$lib/features/chart/reactiveTestSupport';
import { render } from 'svelte/server';
import {
  validWorkspaceReport,
  loadLatestReview,
  saveLatestReview,
  latestReviewKey,
  type SavedReview,
} from './recovery';
import { clearAccessToken, setAccessToken } from '$lib/core/api';
import StrategyTrial from './StrategyTrial.svelte';
import ReportContext from './ReportContext.svelte';
import ResearchReview from './ResearchReview.svelte';
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

function chronologyFixture(): WorkspaceReport {
  const report = fixture();
  report.suite_version = '3';
  report.walk_forward = {
    status: 'measured',
    assumption:
      'Fixed resolved parameters; fresh validation funding. No fitting.',
    limitation:
      'Windows overlap the single holdout; not independent confirmations.',
    folds: [1, 2, 3].map(id => ({
      id: id as 1 | 2 | 3,
      status: 'measured',
      train_start: '2025-01-01T00:00:00Z',
      train_end: `2025-0${id + 1}-28T00:00:00Z`,
      training_bars: 60 + (id - 1) * 20,
      validation_start: `2025-0${id + 2}-01T00:00:00Z`,
      validation_end: `2025-0${id + 2}-20T00:00:00Z`,
      validation_bars: 20,
      strategy: { ...report.realistic, total_return: id * 0.02 },
      benchmark: { ...report.benchmark, total_return: -0.01 },
    })),
  };
  report.regimes = {
    status: 'measured',
    method: 'validation-close-return-v1',
    threshold: 0.05,
    observations: [
      { fold_id: 1, label: 'rising', market_return: 0.1 },
      { fold_id: 2, label: 'falling', market_return: -0.1 },
      { fold_id: 3, label: 'sideways', market_return: 0.02 },
    ],
    assumption:
      'Observed first-to-last close return at fixed +/-5% thresholds.',
    limitation:
      'Retrospective labels use future closes; not forecasts. Sideways is not low volatility.',
  };
  return report;
}

function renderReview(report: WorkspaceReport) {
  return render(ResearchReview, {
    props: {
      report,
      review: { decision: 'unreviewed', reason: '' },
      onreview: () => {},
    },
  }).body;
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearAccessToken();
});

describe('workspace robustness inputs and boundary', () => {
  it.each(['pending', 'failed', 'completed'] as const)(
    'clears old-owner workspace status even when the request is %s',
    phase => {
      const controller = new AbortController();
      const state = {
        reportAccount: 'a',
        mode: 'workspace',
        running: phase === 'pending',
        report: phase === 'completed' ? fixture() : null,
        dataQuality: { old: true },
        receipt: { old: true },
        restored: true,
        storageMessage: 'Old owner storage',
        runError: 'Old owner error',
        statusMessage: 'Running Old owner draft on MSFT…',
        completedFingerprint: 'old',
        receivedAt: 'old',
        runController: controller as AbortController | null,
        runSequence: 4,
      };
      const invalidate = vi.fn();
      const reload = vi.fn();
      const production = ts.transpileModule(
        componentDeclarations(
          new URL('./StrategyTrial.svelte', import.meta.url),
          ['syncReportAccount', 'cancelRun'],
        ),
        { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
      ).outputText;
      const sync = new Function(
        'state',
        'untrack',
        'reviewFence',
        'reloadRecovery',
        'isWorkspaceReport',
        `with (state) { ${production}; return syncReportAccount; }`,
      )(
        state,
        (fn: () => void) => fn(),
        { invalidate },
        reload,
        isWorkspaceReport,
      ) as (owner: string | null) => void;
      sync('a');
      expect(controller.signal.aborted).toBe(false);
      expect(state.runSequence).toBe(4);
      sync(null);
      expect(controller.signal.aborted).toBe(true);
      expect(state).toMatchObject({
        running: false,
        report: null,
        dataQuality: null,
        receipt: null,
        restored: false,
        storageMessage: '',
        runError: '',
        completedFingerprint: '',
        receivedAt: '',
        runController: null,
        statusMessage: 'Account changed. Run checks for the current workspace.',
      });
      sync('b');
      expect(state.reportAccount).toBe('b');
      expect(state.statusMessage).not.toContain('Old owner');
      expect(invalidate).toHaveBeenCalledTimes(4);
      expect(reload).toHaveBeenCalledTimes(2);
    },
  );

  it('namespaces controls when workspace and guided synthetic trials coexist', () => {
    const Pair = ((payload: unknown) => {
      const child = StrategyTrial as unknown as (
        payload: unknown,
        props: unknown,
      ) => void;
      child(payload, { embedded: true, workspace: context });
      child(payload, { embedded: true });
    }) as unknown as typeof StrategyTrial;
    const { body } = render(Pair);
    const ids = Array.from(body.matchAll(/\bid="([^"]+)"/g), match => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    const forms = ids.filter(id => id.endsWith('-run-form'));
    expect(forms).toHaveLength(2);
    for (const form of forms) expect(body).toContain(`form="${form}"`);
  });
  it('uses the current editor/context with authenticated POST, never a code-bearing URL', async () => {
    const fetch = vi.fn(async (url: string) =>
      url.endsWith('quality-preview')
        ? new Response('', { status: 404 })
        : new Response(JSON.stringify(fixture()), { status: 200 }),
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
    const [previewUrl, previewOptions] = fetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(previewUrl).toBe('/backtests/quality-preview');
    expect(previewOptions.body).not.toContain(context.code);
    const [url, options] = fetch.mock.calls[1] as unknown as [
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

  it('namespaces label, help and submit targets with a Svelte instance id', () => {
    const html = render(StrategyTrial, {
      props: { workspace: context, embedded: true },
    }).body;
    const ids = Array.from(html.matchAll(/\bid="([^"]+)"/g), match => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const match of html.matchAll(
      /\b(?:for|form|aria-controls|aria-describedby)="([^"]+)"/g,
    )) {
      for (const target of match[1].split(' ')) expect(ids).toContain(target);
    }
    const form = html.match(/<form id="([^"]+)"/)?.[1];
    expect(form).toMatch(/-run-form$/);
    expect(form).not.toBe('robustness-run-form');
    expect(html).toContain(`form="${form}"`);
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
    expect(html).toContain('Dataset SHA-256');
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
        version: '1',
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
    expect(html).toContain('Dataset version');
    expect(html).toMatch(/<dd[^>]*>1<\/dd>/);
    expect(html).not.toContain('Dataset SHA-256');
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

describe('walk-forward and regime research review', () => {
  it('round-trips new evidence through strict browser recovery and source-free escaped HTML', () => {
    const report = chronologyFixture();
    report.data_quality = {
      errors: [],
      warnings: [
        {
          code: 'calendar_unknown',
          message: '<warning>',
          column: null,
          count: 1,
          rows: [],
        },
      ],
      provenance: {
        provider: 'yfinance',
        interval: '1d',
        data_version: 'v1',
        row_count: 120,
        start: '2025-01-01T00:00:00Z',
        end: '2025-04-30T00:00:00Z',
        timestamp_timezone: 'UTC',
        timestamp_unit: 'us',
        nominal_interval_seconds: 86400,
        calendar: 'unknown',
        adjustment: 'unknown',
        staleness: 'not_assessed',
        example_limit: 5,
      },
    };
    expect(validWorkspaceReport(report)).toBe(true);
    const saved: SavedReview = {
      version: 1,
      account: 'a',
      received_at: '2026-10-12T00:00:00Z',
      input_fingerprint: 'a'.repeat(64),
      context: {
        name: context.name,
        symbol: context.symbol,
        provider: context.provider,
        period: context.period,
        interval: context.interval,
      },
      report,
    };
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
    };
    expect(saveLatestReview(storage, saved, () => 'a')).toBe('saved');
    const loaded = loadLatestReview(storage, 'a');
    expect(loaded.saved?.report).toEqual(report);
    expect(loadLatestReview(storage, 'b').saved).toBeNull();
    expect(data.get(latestReviewKey('a'))).not.toContain(context.code);
    const html = generateTrialReportHtml(report);
    expect(html).toContain('Fold 3');
    expect(html).toContain('Validation strategy');
    expect(html).toContain('rising');
    expect(html).toContain('&lt;warning&gt;');
    expect(html).toContain('No fitting, optimization or parameter selection');
    expect(html).not.toContain(context.code);
    expect(html).not.toMatch(/<script\b|<warning>/);
  });

  it('preserves old absent/null fields but rejects malformed or source-bearing new evidence', () => {
    expect(validWorkspaceReport(fixture())).toBe(true);
    expect(
      validWorkspaceReport({
        ...fixture(),
        walk_forward: null,
        regimes: null,
        data_quality: null,
      }),
    ).toBe(true);
    const report = chronologyFixture();
    expect(validWorkspaceReport(report)).toBe(true);
    expect(
      validWorkspaceReport({
        ...report,
        walk_forward: { ...report.walk_forward, folds: [] },
      }),
    ).toBe(false);
    expect(
      validWorkspaceReport({
        ...report,
        regimes: { ...report.regimes, source: context.code },
      }),
    ).toBe(false);
    expect(
      validWorkspaceReport({
        ...report,
        regimes: { ...report.regimes, threshold: 0.2 },
      }),
    ).toBe(false);
    expect(
      validWorkspaceReport({
        ...report,
        regimes: {
          ...report.regimes,
          observations: [
            { fold_id: 1, label: 'rising', market_return: Infinity },
          ],
        },
      }),
    ).toBe(false);
    expect(
      validWorkspaceReport({
        ...report,
        data_quality: {
          errors: [],
          warnings: [],
          provenance: { source: context.code },
        },
      }),
    ).toBe(false);
  });

  it('renders original fold dates, bars and separate funded outcomes with retrospective limitations', () => {
    const html = renderReview(chronologyFixture());
    for (const label of [
      'Walk-forward chronology · fixed parameters',
      'Training context:',
      '60 bars',
      '80 bars',
      '100 bars',
      '20 bars',
      'datetime="2025-03-01T00:00:00Z"',
      'datetime="2025-05-20T00:00:00Z"',
      'No fitting or parameter selection.',
      'independently funded, configured costs, fixed parameters',
      'not independent confirmations',
      'Fold 1 · rising: close-to-close market return +10.00%',
      'Fold 2 · falling: close-to-close market return -10.00%',
      'Fold 3 · sideways: close-to-close market return +2.00%',
      'Strategy +2.00% versus buy-and-hold -1.00%',
      'Strategy +4.00% versus buy-and-hold -1.00%',
      'Strategy +6.00% versus buy-and-hold -1.00%',
      'Retrospective labels use future closes; not forecasts.',
      'not a confidence score',
      'Continue research · not approval to trade',
    ])
      expect(html).toContain(label);
    expect(html.match(/<details\b/g)).toHaveLength(4);
    expect(html.match(/<caption\b[^>]*>Fold/g)).toHaveLength(3);
  });

  it('shows inadequate chronology without numeric fold or regime evidence', () => {
    const report = chronologyFixture();
    report.walk_forward!.status = 'inadequate-sample';
    for (const fold of report.walk_forward!.folds) {
      fold.status = 'inadequate-sample';
      fold.validation_bars = 13;
      fold.strategy = null;
      fold.benchmark = null;
    }
    report.regimes!.status = 'inadequate-sample';
    report.regimes!.observations = [];
    const html = renderReview(report);
    expect(html).toContain('No fold was executed.');
    expect(html).toContain('13 bars');
    expect(html).toContain('No measured strategy or benchmark summary');
    expect(html).toContain('no daily regime outcomes were measured');
    expect(html).not.toMatch(/<caption\b[^>]*>Fold/);
    expect(html).not.toContain('close-to-close market return');
  });

  it('does not infer daily regimes on unsupported data, while keeping available fold results', () => {
    const report = chronologyFixture();
    report.regimes!.status = 'unsupported-data';
    report.regimes!.observations = [];
    const html = renderReview(report);
    expect(html).toContain(
      'No intraday sessions or regime outcomes were inferred.',
    );
    expect(html).toMatch(/<caption\b[^>]*>Fold 1 validation/);
    expect(html).not.toContain('Fold 1 · rising');
  });

  it('renders missing and null older report fields as unavailable, not as passing evidence', () => {
    for (const report of [
      fixture(),
      { ...fixture(), walk_forward: null, regimes: null },
    ]) {
      const html = renderReview(report);
      expect(html).toContain(
        'Walk-forward evidence unavailable in this older report',
      );
      expect(html).toContain(
        'Regime evidence unavailable in this older report',
      );
      expect(html).toContain('Missing checks are not resilience evidence.');
      expect(html).not.toMatch(/<caption\b[^>]*>Fold/);
    }
  });

  it('escapes report text and marks a missing referenced fold summary explicitly', () => {
    const report = chronologyFixture();
    report.walk_forward!.assumption = '<script>unsafe()</script>';
    report.walk_forward!.folds[0].strategy = null;
    const html = renderReview(report);
    expect(html).toMatch(
      /&lt;script(?:&gt;|>)unsafe\(\)&lt;\/script(?:&gt;|>)/,
    );
    expect(html).not.toContain('<script>unsafe()');
    expect(html).toContain('Matching fold summary unavailable.');
    expect(html).not.toContain('Strategy +2.00% versus buy-and-hold -1.00%');
  });
});

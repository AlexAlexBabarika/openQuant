import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  generateTrialReportHtml,
  trialReportFilename,
} from './export';
import type { RunSummary, TrialReport } from './types';

function reportFixture(): TrialReport {
  const run = (
    total_return: number,
    total_cost: number,
    start: number,
  ): RunSummary => ({
    total_return,
    max_drawdown: 0.125,
    trade_count: 7,
    total_cost,
    equity: [
      { t: start, value: 10000 },
      { t: start + 86400, value: 10000 * (1 + total_return) },
    ],
  });
  return {
    schema_version: 1,
    report_id: 'test-report-hash',
    strategy: {
      id: 'backtest-billionaire',
      name: 'Test strategy',
      description: 'Test fixture only',
      lesson: 'Check the evidence',
    },
    dataset: {
      id: 'test-scenario',
      version: 'test-v1',
      label: 'Synthetic test fixture',
      synthetic: true,
      start: '2025-01-01',
      end: '2025-01-04',
      split_date: '2025-01-03',
      training_bars: 2,
      holdout_bars: 2,
    },
    config: {
      strategy_id: 'backtest-billionaire',
      commission_bps: 0,
      slippage_bps: 5,
    },
    baseline: run(0.2, 0, 1735689600),
    realistic: run(0.15, 12.34, 1735689600),
    benchmark: run(0.1, 4.56, 1735689600),
    holdout: {
      strategy: run(-0.05, 3.21, 1735862400),
      benchmark: run(0.03, 1.23, 1735862400),
    },
    sensitivity: [
      { parameter_value: 8, total_return: -0.07, max_drawdown: 0.13 },
      { parameter_value: 12, total_return: -0.09, max_drawdown: 0.14 },
    ],
    selected_parameter: { name: 'window', value: 10 },
    findings: [
      {
        id: 'costs',
        severity: 'warning',
        title: 'Test finding',
        detail: 'A measured detail',
      },
    ],
    assumptions: ['Next-bar fills', 'Synthetic OHLCV'],
    limitations: ['Educational scenario only'],
  };
}

describe('standalone trial HTML snapshot', () => {
  it('includes supplied full-period, benchmark and separate holdout metrics and provenance', () => {
    const report = reportFixture();
    const html = generateTrialReportHtml(report);
    for (const text of [
      '20.00%',
      '15.00%',
      '10.00%',
      '-5.00%',
      '3.00%',
      '12.50%',
      '12.34',
      '4.56',
      '3.21',
      '1.23',
      '-7.00%',
      '-9.00%',
      '13.00%',
      '14.00%',
      'test-report-hash',
      'test-scenario / test-v1',
      'window = 10',
      '0 bps',
      '5 bps',
      '2025-01-03',
      'Next-bar fills',
      'Educational scenario only',
      'A measured detail',
    ]) {
      expect(html).toContain(text);
    }
    expect(html).toContain('not real market history');
    expect(html).toContain('OpenQuant · Robustness checks');
    expect(html).not.toContain('Strategy on Trial');
    expect(html).not.toContain('The receipts, minus the victory lap');
    expect(html).toContain('not independent evidence of market alpha');
    expect(html).toContain('not an immutable hosted report');
    expect(html).toContain('current scenario and engine version');
    expect(html).toContain('selected using training only');
    expect(html).toContain('These curves are not stitched');
    expect(html).toContain('snapshot evidence');
  });

  it('draws separate SVG curves from the actual equity values and timestamps', () => {
    const html = generateTrialReportHtml(reportFixture());
    const charts = [...html.matchAll(/<svg\b[\s\S]*?<\/svg>/g)].map(
      match => match[0],
    );
    expect(charts).toHaveLength(2);
    expect(charts[0]).toContain('d="M72.00,214.00 L688.00,24.00"');
    expect(charts[0]).toContain('d="M72.00,214.00 L688.00,71.50"');
    expect(charts[0]).toContain('d="M72.00,214.00 L688.00,119.00"');
    expect(charts[0]).toContain('2025-01-01');
    expect(charts[1]).toContain('2025-01-03');
    expect(charts[1]).not.toContain('2025-01-01');
    expect(charts[1]).toContain('d="M72.00,95.25 L688.00,214.00"');
    expect(charts[1]).toContain('d="M72.00,95.25 L688.00,24.00"');
  });

  it('requires no scripts or remote resources and exports only allowed report fields', () => {
    const report = {
      ...reportFixture(),
      api_key: 'private-key-not-for-export',
      source_code: 'private-source-not-for-export',
      workspace: { email: 'private-email-not-for-export' },
    };
    const html = generateTrialReportHtml(report);
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('<style>');
    expect(html).toContain('@media print');
    expect(html).toContain('Content-Security-Policy');
    expect(html).not.toMatch(
      /<script\b|<link\b|<iframe\b|<img\b|\s(?:src|href)=|@import|url\(/i,
    );
    expect(html).not.toContain('private-key-not-for-export');
    expect(html).not.toContain('private-source-not-for-export');
    expect(html).not.toContain('private-email-not-for-export');
  });

  it('escapes HTML, script characters, quotes and paths in every report text field', () => {
    const report = reportFixture();
    const attack =
      '</style><script>alert("x")</script><img src="/path?a=1&b=2" onerror=\'boom\'>';
    report.report_id = attack;
    report.strategy.name = attack;
    report.strategy.description = attack;
    report.strategy.lesson = attack;
    report.dataset.id = attack;
    report.dataset.version = attack;
    report.dataset.label = attack;
    report.dataset.start = attack;
    report.dataset.end = attack;
    report.dataset.split_date = attack;
    report.selected_parameter = { name: attack, value: 10 };
    report.findings = [
      { id: attack, severity: 'warning', title: attack, detail: attack },
    ];
    report.assumptions = [attack];
    report.limitations = [attack];
    const html = generateTrialReportHtml(report);
    expect(html).not.toContain(attack);
    expect(html).not.toMatch(/<script\b|<img\b/i);
    expect(html.split(escapeHtml(attack)).length - 1).toBe(17);
    expect(html).toContain('&lt;/style&gt;&lt;script&gt;alert(&quot;x&quot;)');
    expect(html).toContain('/path?a=1&amp;b=2');
    expect(html).toContain('&#39;boom&#39;');
  });

  it('marks non-finite metrics unavailable and breaks curves around invalid observations', () => {
    const report = reportFixture();
    report.realistic.total_return = NaN;
    report.realistic.total_cost = Infinity;
    report.sensitivity[0].max_drawdown = -Infinity;
    report.baseline.equity.splice(1, 0, { t: NaN, value: 11000 });
    report.benchmark.equity.push({ t: 1735862400, value: Infinity });
    const html = generateTrialReportHtml(report);
    expect(html).toContain('Unavailable');
    expect(html).toContain('gaps are not connected');
    expect(html).toContain('d="M72.00,214.00 M688.00,24.00"');
    expect(html).not.toMatch(/NaN|Infinity/);
  });

  it('handles empty and single-point curves without inventing observations', () => {
    const report = reportFixture();
    report.baseline.equity = [];
    report.realistic.equity = [];
    report.benchmark.equity = [];
    report.holdout.strategy.equity = [{ t: 1735862400, value: 10000 }];
    report.holdout.benchmark.equity = [];
    report.selected_parameter = null;
    report.sensitivity = [];
    report.findings = [];
    report.assumptions = [];
    report.limitations = [];
    const html = generateTrialReportHtml(report);
    expect(html).toContain('No finite equity observations available');
    expect(html).toContain('d="M380.00,119.00"');
    expect(html).toContain('<circle cx="380.00" cy="119.00" r="3"');
    expect(html).toContain('no parameter selected');
    expect(html).toContain('No parameter sensitivity reported');
    expect(html).toContain('No findings reported');
    expect(html).not.toMatch(/NaN|Infinity/);
  });

  it('keeps SVG coordinates finite with extreme numbers and invalid date ranges', () => {
    const report = reportFixture();
    report.baseline.equity = [
      { t: -Number.MAX_VALUE, value: -Number.MAX_VALUE },
      { t: Number.MAX_VALUE, value: Number.MAX_VALUE },
    ];
    const html = generateTrialReportHtml(report);
    expect(html).not.toMatch(/NaN|Infinity/);
    expect(html).toContain('Unavailable');
    expect(html).toContain('d="M72.00,214.00 L688.00,24.00"');
  });

  it('preserves exact configuration and parameter values without rounding them to zero', () => {
    const report = reportFixture();
    report.config.commission_bps = 0.0001;
    report.config.slippage_bps = 49.9999;
    report.selected_parameter = { name: 'threshold', value: 0.0005 };
    report.sensitivity[0].parameter_value = 0.0004;
    const html = generateTrialReportHtml(report);
    expect(html).toContain('0.0001 bps');
    expect(html).toContain('49.9999 bps');
    expect(html).toContain('threshold = 0.0005');
    expect(html).toContain('<th scope="row">0.0004</th>');
  });

  it('creates a bounded safe download filename with no directory or HTML characters', () => {
    const report = reportFixture();
    expect(trialReportFilename(report)).toBe(
      'openquant-trial-backtest-billionaire-test-report-hash.html',
    );
    report.report_id = '../../<script>"bad"' + 'x'.repeat(300);
    const filename = trialReportFilename(report);
    expect(filename).toMatch(
      /^openquant-trial-backtest-billionaire-[a-zA-Z0-9_-]+\.html$/,
    );
    expect(filename.length).toBeLessThan(150);
    report.report_id = '';
    expect(trialReportFilename(report)).toContain('-report.html');
  });
});

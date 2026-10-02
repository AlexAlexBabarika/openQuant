import { expect, it } from 'vitest';
import { generateTrialReportHtml } from './export';
import type { TrialReport } from './types';

it('labels a fixed frequent-trader parameter without claiming a training optimization', () => {
  const run = {
    total_return: 0,
    max_drawdown: 0,
    trade_count: 0,
    total_cost: 0,
    equity: [],
  };
  const report: TrialReport = {
    schema_version: 1,
    report_id: 'fixture',
    strategy: {
      id: 'overcaffeinated-trader',
      name: 'Frequent trader',
      description: 'Fixed cadence',
      lesson: 'Count costs',
    },
    dataset: {
      id: 'fixture',
      version: '1',
      label: 'Synthetic fixture',
      synthetic: true,
      start: '2025-01-01',
      end: '2025-01-02',
      split_date: '2025-01-02',
      training_bars: 1,
      holdout_bars: 1,
    },
    config: {
      strategy_id: 'overcaffeinated-trader',
      commission_bps: 1,
      slippage_bps: 5,
    },
    baseline: run,
    realistic: run,
    benchmark: run,
    holdout: { strategy: run, benchmark: run },
    sensitivity: [],
    selected_parameter: { name: 'holding_bars', value: 2 },
    findings: [],
    assumptions: [],
    limitations: [],
  };
  const html = generateTrialReportHtml(report);
  expect(html).toContain('holding_bars = 2 (fixed, not optimized)');
  expect(html).not.toContain('selected using training only');
});

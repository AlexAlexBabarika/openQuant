import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import BacktestPanel from '../../../components/backtest/BacktestPanel.svelte';
import { BacktestState } from './backtestState.svelte';
import sample from './fixtures/sample-run.json';

describe('empty backtest results', () => {
  it('explains a loaded result with no bars rather than leaving blank chart panes', async () => {
    const backtest = new BacktestState(async () => ({
      ...sample,
      bars: [],
      equity: [],
      trades: [],
    }));
    await backtest.load();
    const html = render(BacktestPanel, {
      props: { open: true, backtest },
    }).body;
    expect(html).toContain('This run returned no market bars.');
    expect(html).not.toContain('class="chart-pane');
  });

  it('still renders results when a run has bars but no closed trades', async () => {
    const backtest = new BacktestState(async () => ({ ...sample, trades: [] }));
    await backtest.load();
    backtest.setTab('trades');
    const html = render(BacktestPanel, {
      props: { open: true, backtest },
    }).body;
    expect(html).not.toContain('This run returned no market bars.');
    expect(html).toContain('class="chart-pane');
  });
});

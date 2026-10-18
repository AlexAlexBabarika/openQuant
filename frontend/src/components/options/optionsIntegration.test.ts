import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { createOptionsDraft } from '$lib/features/options/optionsTemplates';
import type { OptionsAnalysis } from '$lib/features/options/optionsTypes';
import OptionsSummary from './OptionsSummary.svelte';
import OptionsPanel from './OptionsPanel.svelte';

function submitted(): Pick<OptionsAnalysis, 'request' | 'summary'> {
  return {
    request: createOptionsDraft(),
    summary: {
      gross_entry_cost: 500,
      entry_fees: 1,
      net_entry_cost: 501,
      entry_debit: 501,
      entry_credit: 0,
      theoretical_value_today: 521,
      pnl_today: 20,
      max_profit: null,
      max_loss: 501,
      profit_unbounded: true,
      loss_unbounded: false,
      breakevens: [105.01],
      zero_intervals: [],
    },
  };
}

describe('submitted options risk strip', () => {
  it('mounts the integrated authoring, scenario and scoped library controls without duplicate legacy editors', () => {
    const html = render(OptionsPanel).body;
    expect(html).toContain('Options strategy legs');
    expect(html).toContain('Options scenario lab');
    expect(html).toContain('Options local draft library');
    expect(html).toContain('Buy');
    expect(html).toContain('Sell');
    expect(html).not.toContain('Signed contracts');
    expect(html).not.toContain('<textarea');
  });
  it('identifies model P&L, expiry extrema, costs and the submitted context', () => {
    const html = render(OptionsSummary, {
      props: { result: submitted() },
    }).body;
    expect(html).toContain('Submitted options risk totals');
    expect(html).toContain('Expiry max profit · USD');
    expect(html).toContain('Unbounded');
    expect(html).toContain('Expiry max loss · USD');
    expect(html).toContain('Today model P&amp;L · USD');
    expect(html).toContain('+$20.00');
    expect(html).toContain('Entry fees · USD');
    expect(html).toContain('SUBMITTED EVIDENCE');
  });

  it('keeps missing extrema unavailable instead of displaying zero', () => {
    const result = submitted();
    result.summary.max_loss = null;
    expect(render(OptionsSummary, { props: { result } }).body).toContain(
      'Unavailable',
    );
  });

  it('does not advertise stale or refreshing evidence as current analysis', () => {
    const stale = render(OptionsSummary, {
      props: { result: submitted(), stale: true },
    }).body;
    expect(stale).toContain('STALE INPUTS');
    expect(stale).not.toContain('SUBMITTED EVIDENCE');
    expect(
      render(OptionsSummary, { props: { result: submitted(), pending: true } })
        .body,
    ).toContain('REFRESHING');
  });
});

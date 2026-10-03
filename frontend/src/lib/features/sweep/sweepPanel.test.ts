import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import SweepPanel from '../../../components/sweep/SweepPanel.svelte';
import { SweepState } from './sweepState.svelte';

describe('sweep control feedback', () => {
  it('shows schema errors and disables starting while parameters are loading', () => {
    const sweep = new SweepState();
    sweep.schemaLoading = true;
    sweep.schemaError = 'Invalid strategy source';
    const html = render(SweepPanel, {
      props: { code: 'bad source', sweep },
    }).body;
    expect(html).toContain('Loading parameters');
    expect(html).toContain('Invalid strategy source');
    expect(html).toMatch(/type="submit"[^>]*disabled/);
  });

  it('explains a completed sweep with no trials instead of showing a blank results section', () => {
    const sweep = new SweepState();
    sweep.status = 'done';
    const html = render(SweepPanel, { props: { code: 'x', sweep } }).body;
    expect(html).toContain('No trials were returned for this sweep.');
  });

  it('shows pending cancellation and disables duplicate cancellation', () => {
    const sweep = new SweepState();
    sweep.status = 'running';
    sweep.cancelling = true;
    const html = render(SweepPanel, { props: { code: 'x', sweep } }).body;
    expect(html).toMatch(/<button[^>]*disabled[^>]*>cancelling/);
  });
});

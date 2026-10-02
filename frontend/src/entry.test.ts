import { describe, expect, it } from 'vitest';
import { selectEntry } from './entry';
import { createTrialShareUrl } from './lib/features/trial-report/sharing';

describe('flagship entry', () => {
  it('defaults to the trial and keeps shared configurations on the trial', () => {
    const url = new URL(
      createTrialShareUrl(
        { strategy_id: 'boring-benchmark', commission_bps: 1, slippage_bps: 5 },
        'https://openquant.example/?workspace=1',
      ),
    );
    expect(selectEntry('', false)).toBe('trial');
    expect(selectEntry(url.search, false)).toBe('trial');
    expect(selectEntry('?workspace=0', false)).toBe('trial');
  });

  it('opens research only on explicit workspace requests in normal mode', () => {
    expect(selectEntry('?workspace=1', false)).toBe('workspace');
    expect(selectEntry('?trial=1&workspace=1', false)).toBe('workspace');
  });

  it('handles unavailable workspace requests without mounting research in standalone mode', () => {
    expect(selectEntry('?workspace=1', true)).toBe('workspace-unavailable');
    expect(selectEntry('', true)).toBe('trial');
  });
});

import { describe, expect, it } from 'vitest';
import { selectEntry, trialSearch } from './entry';
import { createTrialShareUrl } from './lib/features/trial-report/sharing';

describe('flagship entry', () => {
  it('defaults to research and keeps explicit and shared trials discoverable', () => {
    const url = new URL(
      createTrialShareUrl(
        { strategy_id: 'boring-benchmark', commission_bps: 1, slippage_bps: 5 },
        'https://openquant.example/?workspace=1',
      ),
    );
    expect(selectEntry('', false)).toBe('workspace');
    expect(selectEntry('?trial=1', false)).toBe('trial');
    expect(selectEntry(url.search, false)).toBe('trial');
    expect(selectEntry('?workspace=0', false)).toBe('workspace');
    expect(selectEntry('?trial=0', false)).toBe('workspace');
  });

  it('preserves legacy workspace links and their precedence', () => {
    expect(selectEntry('?workspace=1', false)).toBe('workspace');
    expect(selectEntry('?trial=1&workspace=1', false)).toBe('workspace');
  });

  it('handles unavailable workspace requests without mounting research in standalone mode', () => {
    expect(selectEntry('?workspace=1', true)).toBe('workspace-unavailable');
    expect(selectEntry('', true)).toBe('trial');
    expect(selectEntry('?trial=1', true)).toBe('trial');
  });

  it('opens trials from legacy workspace URLs without dropping unrelated parameters', () => {
    const search = trialSearch('?workspace=1&symbol=AAPL', true);
    expect(selectEntry(search, false)).toBe('trial');
    expect(new URLSearchParams(search).get('symbol')).toBe('AAPL');
    expect(new URLSearchParams(search).has('workspace')).toBe(false);
  });

  it('preserves a shared configuration on open and clears it when returning to research', () => {
    const url = new URL(
      createTrialShareUrl(
        { strategy_id: 'boring-benchmark', commission_bps: 1, slippage_bps: 5 },
        'https://openquant.example/',
      ),
    );
    expect(trialSearch(url.search, true)).toBe(url.search);
    expect(trialSearch(url.search, false)).toBe('');
    expect(trialSearch(`${url.search}&symbol=AAPL`, false)).toBe(
      '?symbol=AAPL',
    );
  });
});

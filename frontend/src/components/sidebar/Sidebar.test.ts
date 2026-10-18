import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import type { ComponentProps } from 'svelte';
import Sidebar from './Sidebar.svelte';

function props(
  extra: Partial<ComponentProps<typeof Sidebar>> = {},
): ComponentProps<typeof Sidebar> {
  return {
    groups: [],
    selectedGroupName: '',
    selectedPriority: null,
    selectedStance: null,
    priorityCounts: {} as ComponentProps<typeof Sidebar>['priorityCounts'],
    stanceCounts: {} as ComponentProps<typeof Sidebar>['stanceCounts'],
    tickers: [],
    quotes: {},
    groupActions: {} as ComponentProps<typeof Sidebar>['groupActions'],
    onaddticker: vi.fn(),
    onselectpriority: vi.fn(),
    onselectstance: vi.fn(),
    onselectticker: vi.fn(),
    ondeleteticker: vi.fn(),
    onsetpriority: vi.fn(),
    onsetstance: vi.fn(),
    onaddnote: vi.fn(),
    oneditnote: vi.fn(),
    ondeletenote: vi.fn(),
    ...extra,
  };
}

describe('current symbol entry points', () => {
  it('offers options on the loaded symbol', () => {
    const html = render(Sidebar, {
      props: props({ symbol: 'AAPL', onoptions: vi.fn() }),
    }).body;
    expect(html).toMatch(/<button[^>]*>Options on AAPL<\/button>/);
  });

  it('offers nothing without a symbol or a handler', () => {
    expect(
      render(Sidebar, { props: props({ symbol: 'AAPL' }) }).body,
    ).not.toContain('Options on');
    expect(
      render(Sidebar, { props: props({ onoptions: vi.fn() }) }).body,
    ).not.toContain('Options on');
  });
});

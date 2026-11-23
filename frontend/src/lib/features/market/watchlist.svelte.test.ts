import { describe, expect, it } from 'vitest';
import { TickerPriority, TickerStance, type TickerGroup } from './tickers';
import { Watchlist } from './watchlist.svelte';

const ticker = (
  symbol: string,
  priority = TickerPriority.None,
  stance = TickerStance.None,
) => ({ symbol, priority, stance, providers: null });

function watchlist(groups: TickerGroup[], selectedGroupName = groups[0].name) {
  return new Watchlist({
    groups,
    selectedGroupName,
    selectedPriority: null,
    selectedStance: null,
  });
}

const symbols = (list: Watchlist) => list.tickers.map(t => t.symbol);

describe('watchlist views', () => {
  it('shows one view at a time: a group, a priority or a stance', () => {
    const list = watchlist([
      { name: 'Tech', tickers: [ticker('AAPL', TickerPriority.High)] },
      {
        name: 'Macro',
        tickers: [ticker('SPY', TickerPriority.High, TickerStance.Buy)],
      },
    ]);
    expect(symbols(list)).toEqual(['AAPL']);
    list.selectPriority(TickerPriority.High);
    expect(symbols(list)).toEqual(['AAPL', 'SPY']);
    list.selectStance(TickerStance.Buy);
    expect(list.selectedPriority).toBeNull();
    expect(symbols(list)).toEqual(['SPY']);
    list.selectGroup('Macro');
    expect(list.selectedStance).toBeNull();
    expect(symbols(list)).toEqual(['SPY']);
    expect(list.groupSymbols).toEqual(['SPY']);
  });

  it('a new group becomes the view; a rename keeps the selection', () => {
    const list = watchlist([{ name: 'All', tickers: [ticker('AAPL')] }]);
    list.selectPriority(TickerPriority.High);
    list.addGroup('Ideas');
    expect(list.selectedGroupName).toBe('Ideas');
    expect(list.selectedPriority).toBeNull();
    list.renameGroup('Shortlist');
    expect(list.selectedGroupName).toBe('Shortlist');
    expect(list.groupNames).toEqual(['All', 'Shortlist']);
  });
});

describe('watchlist group changes', () => {
  it('selects the copy after duplicating and the first group after deleting', () => {
    const list = watchlist(
      [
        { name: 'All', tickers: [] },
        { name: 'Tech', tickers: [ticker('AAPL')] },
      ],
      'Tech',
    );
    list.duplicateGroup();
    expect(list.groups).toHaveLength(3);
    expect(list.selectedGroupName).not.toBe('Tech');
    expect(symbols(list)).toEqual(['AAPL']);
    list.deleteGroup();
    expect(list.groups).toHaveLength(2);
    expect(list.selectedGroupName).toBe('All');
  });

  it('keeps the last group', () => {
    const list = watchlist([{ name: 'All', tickers: [ticker('AAPL')] }]);
    list.deleteGroup();
    expect(list.groupNames).toEqual(['All']);
    list.clearGroup();
    expect(symbols(list)).toEqual([]);
  });

  it('removes a ticker from its group, or from every group in a flag view', () => {
    const groups = () => [
      { name: 'A', tickers: [ticker('AAPL', TickerPriority.High)] },
      { name: 'B', tickers: [ticker('AAPL', TickerPriority.High)] },
    ];
    const inGroup = watchlist(groups());
    inGroup.deleteTicker('AAPL');
    expect(inGroup.groups.map(g => g.tickers.length)).toEqual([0, 1]);
    const inFlagView = watchlist(groups());
    inFlagView.selectPriority(TickerPriority.High);
    inFlagView.deleteTicker('AAPL');
    expect(inFlagView.groups.map(g => g.tickers.length)).toEqual([0, 0]);
  });
});

describe('watchlist flags', () => {
  const groups = () => [
    { name: 'A', tickers: [ticker('AAPL')] },
    { name: 'B', tickers: [ticker('AAPL', TickerPriority.High)] },
  ];
  const priorityIn = (list: Watchlist, group: string) =>
    list.groups.find(g => g.name === group)!.tickers[0].priority;

  it('changes nothing and reports a conflict when another group disagrees', () => {
    const list = watchlist(groups());
    const conflict = list.setPriority('AAPL', TickerPriority.Low);
    expect(conflict).toMatchObject({
      kind: 'priority',
      symbol: 'AAPL',
      desired: TickerPriority.Low,
      conflict: { existingPriority: TickerPriority.High, groups: ['B'] },
    });
    expect(priorityIn(list, 'A')).toBe(TickerPriority.None);
    list.adoptExistingFlag(conflict!);
    expect(priorityIn(list, 'A')).toBe(TickerPriority.High);
  });

  it('applies a flag that agrees with the other groups', () => {
    const list = watchlist(groups());
    expect(list.setPriority('AAPL', TickerPriority.High)).toBeNull();
    expect(priorityIn(list, 'A')).toBe(TickerPriority.High);
    expect(list.priorityCounts[TickerPriority.High]).toBeGreaterThan(0);
  });

  it('changes every group from a flag view, without a conflict', () => {
    const list = watchlist(groups());
    list.selectPriority(TickerPriority.High);
    expect(list.setPriority('AAPL', TickerPriority.Low)).toBeNull();
    expect(priorityIn(list, 'A')).toBe(TickerPriority.Low);
    expect(priorityIn(list, 'B')).toBe(TickerPriority.Low);
  });

  it('treats stance the same way', () => {
    const list = watchlist([
      { name: 'A', tickers: [ticker('AAPL')] },
      {
        name: 'B',
        tickers: [ticker('AAPL', TickerPriority.None, TickerStance.Buy)],
      },
    ]);
    const conflict = list.setStance('AAPL', TickerStance.Sell);
    expect(conflict?.kind).toBe('stance');
    list.adoptExistingFlag(conflict!);
    expect(list.groups[0].tickers[0].stance).toBe(TickerStance.Buy);
  });
});

describe('watchlist provider cache', () => {
  it('records providers for a symbol in every group', () => {
    const list = watchlist([
      { name: 'A', tickers: [ticker('AAPL')] },
      { name: 'B', tickers: [ticker('AAPL')] },
    ]);
    expect(list.providersFor('AAPL')).toBeNull();
    const providers = { yfinance: true } as never;
    list.setProviders('AAPL', providers);
    expect(list.providersFor('AAPL')).toEqual(providers);
    expect(list.groups[1].tickers[0].providers).toEqual(providers);
  });
});

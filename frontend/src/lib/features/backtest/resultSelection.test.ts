import { describe, it, expect } from 'vitest';
import { tradeSelection, drawdownSelection } from './resultSelection';
import { BacktestState } from './backtestState.svelte';
import { topDrawdowns } from './derive';
import fixture from './fixtures/sample-run.json';
import { loadResult } from './loadResult';

const result = loadResult(fixture);
describe('linked result selection', () => {
  it('uses stored bar indices with surrounding context, not chart workspace candles', () => {
    const selection = tradeSelection(result, 0)!;
    const trade = result.trades[0];
    expect(selection.kind).toBe('trade');
    expect(selection.index).toBe(0);
    expect(selection.from).toBeLessThanOrEqual(trade.entry_index);
    expect(selection.to).toBeGreaterThanOrEqual(trade.exit_index);
    expect(selection.to).toBeLessThan(result.bars.length);
  });
  it('rejects missing trades and invalid bar indices', () => {
    expect(tradeSelection(result, -1)).toBeNull();
    const changed = {
      ...result,
      trades: [{ ...result.trades[0], exit_index: result.bars.length }],
    };
    expect(tradeSelection(changed, 0)).toBeNull();
    expect(tradeSelection({ ...result, bars: [] }, 0)).toBeNull();
  });
  it('keeps a selected trade after mouse hover leaves, until explicitly cleared', async () => {
    const state = new BacktestState(async () => fixture);
    await state.load();
    state.selectTrade(0);
    state.hoverTrade(1);
    state.hoverTrade(null);
    expect(state.selection?.index).toBe(0);
    state.clearSelection();
    expect(state.selection).toBeNull();
  });
  it('focuses recovered and ongoing drawdowns through the last stored equity point', () => {
    const episode = topDrawdowns(result.equity)[0];
    expect(drawdownSelection(result, episode, 0)?.kind).toBe('drawdown');
    const ongoing = drawdownSelection(
      result,
      { ...episode, recovery: null },
      1,
    )!;
    expect(ongoing.label).toContain('ongoing');
    expect(ongoing.to).toBe(result.bars.length - 1);
  });
  it('does not invent a price period for a drawdown outside stored bars', () => {
    const episode = topDrawdowns(result.equity)[0];
    expect(drawdownSelection({ ...result, bars: [] }, episode, 0)).toBeNull();
  });
});

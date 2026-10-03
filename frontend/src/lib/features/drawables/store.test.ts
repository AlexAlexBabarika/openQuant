// frontend/src/lib/drawables/store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createDrawablesStore } from './store.svelte';
import type { RulerDrawable } from './tools/ruler/tool';

function d(id: string, symbol = 'AAPL'): RulerDrawable {
  return {
    id,
    type: 'ruler',
    symbol,
    geometry: { startTime: 0, endTime: 1, startPrice: 1, endPrice: 2 },
    params: {},
    style: {
      upColor: 'rgb(0,0,0)',
      downColor: 'rgb(1,1,1)',
      showStats: true,
    },
    createdAt: 0,
  };
}

describe('drawables store', () => {
  let store: ReturnType<typeof createDrawablesStore>;
  beforeEach(() => {
    store = createDrawablesStore();
  });

  it('starts empty', () => {
    expect(store.items).toEqual([]);
    expect(store.selected).toBeNull();
  });

  it('add/update/remove and selection', () => {
    store.add(d('1'));
    store.add(d('2'));
    expect(store.items.map(x => x.id)).toEqual(['1', '2']);

    store.update('1', { symbol: 'MSFT' });
    expect(store.items[0].symbol).toBe('MSFT');

    store.select('2');
    expect(store.selected?.id).toBe('2');

    store.remove('2');
    expect(store.items.map(x => x.id)).toEqual(['1']);
    expect(store.selected).toBeNull();
  });

  it('forSymbol filters by symbol', () => {
    store.add(d('a', 'AAPL'));
    store.add(d('b', 'MSFT'));
    store.add(d('c', 'AAPL'));
    expect(store.forSymbol('AAPL').map(x => x.id)).toEqual(['a', 'c']);
  });

  it('replaceAll swaps items and clears selection', () => {
    store.add(d('1'));
    store.select('1');
    store.replaceAll([d('2'), d('3')]);
    expect(store.items.map(x => x.id)).toEqual(['2', '3']);
    expect(store.selected).toBeNull();
  });

  it('select(null) deselects', () => {
    store.add(d('1'));
    store.select('1');
    store.select(null);
    expect(store.selected).toBeNull();
  });

  it('only exposes a current-symbol selection that has visible geometry', () => {
    store.add(d('a', 'AAPL'));
    store.add(d('b', 'MSFT'));
    store.select('a');
    expect(store.selectedForSymbol('MSFT', ['b'])).toBeNull();
    expect(store.selectedForSymbol('AAPL', [])).toBeNull();
    expect(store.selectedForSymbol('AAPL', ['a'])?.id).toBe('a');
    const hidden = store.selectedForSymbol('MSFT', ['b']);
    if (hidden) store.remove(hidden.id);
    expect(store.items.map(x => x.id)).toEqual(['a', 'b']);
    store.select('b');
    const visible = store.selectedForSymbol('MSFT', ['b']);
    if (visible) store.remove(visible.id);
    expect(store.items.map(x => x.id)).toEqual(['a']);
  });

  it('removeAllForSymbol removes only matching symbol and clears selection if needed', () => {
    store.add(d('1', 'AAPL'));
    store.add(d('2', 'MSFT'));
    store.add(d('3', 'AAPL'));
    store.select('3');
    store.removeAllForSymbol('AAPL');
    expect(store.items.map(x => x.id)).toEqual(['2']);
    expect(store.selected).toBeNull();
    store.removeAllForSymbol('MSFT');
    expect(store.items).toEqual([]);
  });
});

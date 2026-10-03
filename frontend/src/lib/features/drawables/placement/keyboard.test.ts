import { describe, it, expect, vi } from 'vitest';
import { chartKeyAction } from './keyboard';
import { createDrawablesStore } from '../store.svelte';
import type { RulerDrawable } from '../tools/ruler/tool';

describe('chart keyboard eligibility', () => {
  it.each(['Delete', 'Backspace', 'Escape'])(
    'never intercepts %s in editable fields or their descendants',
    key => {
      const closest = vi.fn(() => ({}));
      expect(
        chartKeyAction(
          { key, target: { closest } as unknown as EventTarget },
          true,
          true,
        ),
      ).toBeNull();
      expect(closest).toHaveBeenCalled();
    },
  );

  it('cancels placement, deselects with Escape, and ignores unrelated keys', () => {
    expect(chartKeyAction({ key: 'Escape', target: null }, true, true)).toBe(
      'cancel',
    );
    expect(chartKeyAction({ key: 'Escape', target: null }, false, true)).toBe(
      'deselect',
    );
    expect(chartKeyAction({ key: 'a', target: null }, false, true)).toBeNull();
  });

  it('keeps the invisible A record after A→B Delete, then deletes a visible B exactly once', () => {
    const store = createDrawablesStore();
    const add = (id: string, symbol: string) =>
      store.add({
        id,
        type: 'ruler',
        symbol,
        createdAt: 0,
        params: {},
        geometry: { startTime: 1, endTime: 2, startPrice: 1, endPrice: 2 },
        style: { upColor: 'green', downColor: 'red', showStats: true },
      } satisfies RulerDrawable);
    add('a', 'A');
    add('b', 'B');
    store.select('a');
    const deleteInB = () => {
      const selection = store.selectedForSymbol('B', ['b']);
      if (
        chartKeyAction(
          { key: 'Delete', target: null },
          false,
          selection !== null,
        ) === 'delete'
      )
        store.remove(selection!.id);
    };
    deleteInB();
    expect(store.items.map(d => d.id)).toEqual(['a', 'b']);
    store.select(null);
    expect(store.selected).toBeNull();
    store.select('b');
    deleteInB();
    deleteInB();
    expect(store.items.map(d => d.id)).toEqual(['a']);
  });
});

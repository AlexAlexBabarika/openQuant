// frontend/src/lib/drawables/store.svelte.ts
import { measureDrawablesSync } from '$lib/core/dev/drawablesProfile';
import type { BundledDrawable } from './bundledDrawable';
import type { Drawable } from './types';

export function createDrawablesStore() {
  let items = $state<BundledDrawable[]>([]);
  let selectedId = $state<string | null>(null);

  /** O(1) lookup by id; rebuilt when `items` changes (same cost as one linear scan). */
  let byId = $derived(new Map(items.map(d => [d.id, d])));

  return {
    get items() {
      return items;
    },
    get selected() {
      if (selectedId === null) return null;
      return byId.get(selectedId) ?? null;
    },
    forSymbol(symbol: string) {
      return items.filter(d => d.symbol === symbol);
    },
    selectedForSymbol(symbol: string, visibleIds: Iterable<string>) {
      const selected = selectedId === null ? null : byId.get(selectedId);
      return selected?.symbol === symbol && new Set(visibleIds).has(selected.id)
        ? selected
        : null;
    },
    add(d: BundledDrawable) {
      measureDrawablesSync('drawables:store:add', () => {
        items = [...items, d];
      });
    },
    update(id: string, patch: Partial<Drawable>) {
      measureDrawablesSync('drawables:store:update', () => {
        const i = items.findIndex(d => d.id === id);
        if (i === -1) return;
        const merged = { ...items[i], ...patch } as BundledDrawable;
        const next = items.slice();
        next[i] = merged;
        items = next;
      });
    },
    remove(id: string) {
      measureDrawablesSync('drawables:store:remove', () => {
        items = items.filter(d => d.id !== id);
        if (selectedId === id) selectedId = null;
      });
    },
    removeAllForSymbol(symbol: string) {
      measureDrawablesSync('drawables:store:removeAllForSymbol', () => {
        const removing = new Set(
          items.filter(d => d.symbol === symbol).map(d => d.id),
        );
        if (removing.size === 0) return;
        items = items.filter(d => d.symbol !== symbol);
        if (selectedId !== null && removing.has(selectedId)) {
          selectedId = null;
        }
      });
    },
    replaceAll(next: BundledDrawable[]) {
      measureDrawablesSync('drawables:store:replaceAll', () => {
        items = [...next];
        selectedId = null;
      });
    },
    select(id: string | null) {
      selectedId = id;
    },
  };
}

export type DrawablesStoreApi = ReturnType<typeof createDrawablesStore>;

/** Singleton used by the app. Tests create their own via createDrawablesStore(). */
export const drawables = createDrawablesStore();

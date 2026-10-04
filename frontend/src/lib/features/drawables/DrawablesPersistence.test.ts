import { afterEach, describe, expect, it, vi } from 'vitest';
import { client, clientModule } from '$lib/features/chart/reactiveTestSupport';
import type { DrawablesStoreApi } from './store.svelte';
import type { BundledDrawable } from './bundledDrawable';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const drawable = (id: string): BundledDrawable => ({
  id,
  type: 'ruler',
  symbol: 'TEST',
  createdAt: 0,
  geometry: { startTime: 0, endTime: 1, startPrice: 1, endPrice: 2 },
  params: {},
  style: { upColor: 'red', downColor: 'green', showStats: true },
});

function setup(userId: string | null = null, ready = true) {
  vi.useFakeTimers();
  const store = clientModule<{ drawables: DrawablesStoreApi }>(
    new URL('./store.svelte.ts', import.meta.url),
    {
      '$lib/core/dev/drawablesProfile': {
        measureDrawablesSync: (_label: string, fn: () => unknown) => fn(),
      },
    },
  ).drawables;
  const props = client.proxy({ userId, ready });
  const storage = new Map<string | null, BundledDrawable[]>([
    [null, [drawable('guest')]],
    ['a', [drawable('a')]],
    ['b', [drawable('b')]],
  ]);
  const loadAll = vi.fn((owner: string | null) => storage.get(owner) ?? []);
  const saveAll = vi.fn(
    (items: readonly BundledDrawable[], owner: string | null) => {
      storage.set(owner, JSON.parse(JSON.stringify(items)));
    },
  );
  const component = clientModule<{
    default: (anchor: unknown, props: unknown) => void;
  }>(new URL('./DrawablesPersistence.svelte', import.meta.url), {
    './store.svelte': { drawables: store },
    './persistence': { loadAll, saveAll },
  }).default;
  const stop = client.effect_root(() =>
    component(null, {
      get userId() {
        return props.userId;
      },
      get ready() {
        return props.ready;
      },
    }),
  );
  cleanups.push(stop);
  client.flush();
  return { store, props, storage, saveAll, loadAll, stop };
}

describe('annotation persistence ownership', () => {
  it('flushes pending edits on pagehide and removes its listener on destruction', () => {
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    const removeListener = vi.spyOn(target, 'removeEventListener');
    const { store, storage, saveAll, stop } = setup('a');
    store.add(drawable('a-new'));
    client.flush();
    target.dispatchEvent(new Event('pagehide'));
    expect(storage.get('a')?.map(d => d.id)).toEqual(['a', 'a-new']);
    stop();
    cleanups.pop();
    expect(removeListener).toHaveBeenCalledWith(
      'pagehide',
      expect.any(Function),
    );
    const calls = saveAll.mock.calls.length;
    target.dispatchEvent(new Event('pagehide'));
    vi.advanceTimersByTime(500);
    expect(saveAll).toHaveBeenCalledTimes(calls);
  });

  it('does not load or save guest data while session restoration is pending', () => {
    const { store, props, loadAll, saveAll } = setup(null, false);
    expect(store.items).toEqual([]);
    vi.advanceTimersByTime(500);
    expect(loadAll).not.toHaveBeenCalled();
    expect(saveAll).not.toHaveBeenCalled();
    props.userId = 'a';
    props.ready = true;
    client.flush();
    expect(store.items.map(d => d.id)).toEqual(['a']);
    expect(loadAll).toHaveBeenCalledExactlyOnceWith('a');
  });

  it('flushes pending guest/account edits only to their owner and clears selection on switches', () => {
    const { store, props, storage } = setup();
    store.add(drawable('guest-new'));
    store.select('guest-new');
    client.flush();
    props.userId = 'a';
    client.flush();
    expect(store.selected).toBeNull();
    expect(store.items.map(d => d.id)).toEqual(['a']);
    expect(storage.get(null)?.map(d => d.id)).toEqual(['guest', 'guest-new']);
    store.add(drawable('a-new'));
    client.flush();
    props.userId = 'b';
    client.flush();
    vi.advanceTimersByTime(500);
    expect(storage.get('a')?.map(d => d.id)).toEqual(['a', 'a-new']);
    expect(storage.get('b')?.map(d => d.id)).toEqual(['b']);
    props.userId = null;
    client.flush();
    expect(store.items.map(d => d.id)).toEqual(['guest', 'guest-new']);
    props.userId = 'a';
    client.flush();
    expect(store.items.map(d => d.id)).toEqual(['a', 'a-new']);
  });

  it('retains edits and selection during an unchanged identity and flushes on destruction', () => {
    const { store, props, storage, loadAll, stop } = setup('a');
    store.add(drawable('a-new'));
    store.select('a-new');
    props.userId = 'a';
    client.flush();
    expect(loadAll).toHaveBeenCalledTimes(1);
    expect(store.selected?.id).toBe('a-new');
    stop();
    cleanups.pop();
    expect(storage.get('a')?.map(d => d.id)).toEqual(['a', 'a-new']);
    vi.advanceTimersByTime(500);
    expect(storage.get('b')?.map(d => d.id)).toEqual(['b']);
  });
});

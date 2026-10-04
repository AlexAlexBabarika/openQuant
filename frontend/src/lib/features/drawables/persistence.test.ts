// frontend/src/lib/drawables/persistence.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadAll,
  saveAll,
  DRAWABLES_STORAGE_KEY,
  drawablesStorageKey,
} from './persistence';
import { registerTool, _resetRegistry } from './registry';
import type { RulerDrawable } from './tools/ruler/tool';
import type { DrawableTool, Drawable } from './types';

// Minimal in-memory localStorage shim: vitest defaults to the node environment
// and this project has no jsdom/happy-dom dependency, so we stub it here rather
// than add a heavier dev dep just to run these tests.
const mem = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i: number) => Array.from(mem.keys())[i] ?? null,
  get length() {
    return mem.size;
  },
});

function tool(
  type: string,
  schemaVersion = 1,
  migrate?: DrawableTool['migrate'],
): DrawableTool {
  return {
    type,
    label: type,
    icon: (() => null) as unknown as DrawableTool['icon'],
    defaults: { params: {}, style: {} },
    schemaVersion,
    migrate,
    createPlacement: () => {
      throw new Error('not used');
    },
    Renderer: (() => null) as unknown as DrawableTool['Renderer'],
    Settings: (() => null) as unknown as DrawableTool['Settings'],
  };
}

function rulerDrawable(id: string): RulerDrawable {
  return {
    id,
    type: 'ruler',
    symbol: 'AAPL',
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

describe('persistence', () => {
  it('isolates guest and account namespaces without collisions', () => {
    registerTool(tool('ruler', 1));
    saveAll([rulerDrawable('guest')]);
    saveAll([rulerDrawable('a')], 'user/a');
    saveAll([rulerDrawable('b')], 'guest');
    expect(loadAll().map(d => d.id)).toEqual(['guest']);
    expect(loadAll('user/a').map(d => d.id)).toEqual(['a']);
    expect(loadAll('guest').map(d => d.id)).toEqual(['b']);
    expect(loadAll('user/b')).toEqual([]);
    expect(drawablesStorageKey('user/a')).not.toBe(
      drawablesStorageKey('user%2Fa'),
    );
  });

  it('retains legacy annotations only in guest storage without overwriting them', () => {
    registerTool(tool('ruler', 1));
    const legacy = JSON.stringify([
      { ...rulerDrawable('legacy'), schemaVersion: 1 },
    ]);
    localStorage.setItem(DRAWABLES_STORAGE_KEY, legacy);
    expect(loadAll('a')).toEqual([]);
    expect(loadAll().map(d => d.id)).toEqual(['legacy']);
    saveAll(loadAll());
    saveAll([rulerDrawable('private')], 'a');
    expect(loadAll().map(d => d.id)).toEqual(['legacy']);
    expect(localStorage.getItem(DRAWABLES_STORAGE_KEY)).toBe(legacy);
    saveAll([]);
    expect(loadAll()).toEqual([]);
  });

  it('does not fall back to guest data for a malformed account record', () => {
    registerTool(tool('ruler', 1));
    saveAll([rulerDrawable('guest')]);
    localStorage.setItem(drawablesStorageKey('a'), 'invalid');
    expect(loadAll('a')).toEqual([]);
    expect(loadAll().map(d => d.id)).toEqual(['guest']);
  });

  beforeEach(() => {
    _resetRegistry();
    localStorage.clear();
  });

  it('returns empty array when storage key missing', () => {
    expect(loadAll()).toEqual([]);
  });

  it('returns empty array for malformed JSON', () => {
    localStorage.setItem(DRAWABLES_STORAGE_KEY, 'not json');
    expect(loadAll()).toEqual([]);
  });

  it('saves items stamped with each tool schemaVersion', () => {
    registerTool(tool('ruler', 3));
    saveAll([rulerDrawable('a')]);
    const raw = JSON.parse(localStorage.getItem(drawablesStorageKey())!);
    expect(raw[0].schemaVersion).toBe(3);
  });

  it('loads matching schemaVersion unchanged', () => {
    registerTool(tool('ruler', 1));
    saveAll([rulerDrawable('a')]);
    const loaded = loadAll();
    expect(loaded.map(d => d.id)).toEqual(['a']);
  });

  it('drops drawables whose tool is not registered', () => {
    registerTool(tool('ruler', 1));
    saveAll([rulerDrawable('a')]);
    const raw = JSON.parse(
      localStorage.getItem(drawablesStorageKey())!,
    ) as unknown[];
    raw.push({
      ...rulerDrawable('b'),
      id: 'b',
      type: 'ghost',
    });
    localStorage.setItem(drawablesStorageKey(), JSON.stringify(raw));
    expect(loadAll().map(d => d.id)).toEqual(['a']);
  });

  it('runs migrate when schemaVersion mismatches', () => {
    registerTool(
      tool('ruler', 2, raw => {
        const base = raw as Drawable;
        return {
          ...base,
          type: 'ruler' as const,
          geometry: {
            startTime: 0,
            endTime: 2,
            startPrice: 1,
            endPrice: 3,
          },
          params: {},
          style: {
            upColor: 'rgb(0,0,0)',
            downColor: 'rgb(1,1,1)',
            showStats: false,
          },
        } satisfies RulerDrawable;
      }),
    );
    localStorage.setItem(
      DRAWABLES_STORAGE_KEY,
      JSON.stringify([{ ...rulerDrawable('a'), schemaVersion: 1 }]),
    );
    const loaded = loadAll();
    expect(loaded[0].geometry).toEqual({
      startTime: 0,
      endTime: 2,
      startPrice: 1,
      endPrice: 3,
    });
  });

  it('drops drawables where migrate returns null', () => {
    registerTool(tool('ruler', 2, () => null));
    localStorage.setItem(
      DRAWABLES_STORAGE_KEY,
      JSON.stringify([{ ...rulerDrawable('a'), schemaVersion: 1 }]),
    );
    expect(loadAll()).toEqual([]);
  });

  it('drops drawables with schemaVersion mismatch and no migrate defined', () => {
    registerTool(tool('ruler', 2));
    localStorage.setItem(
      DRAWABLES_STORAGE_KEY,
      JSON.stringify([{ ...rulerDrawable('a'), schemaVersion: 1 }]),
    );
    expect(loadAll()).toEqual([]);
  });

  it('drops bundled entries that fail shape validation', () => {
    registerTool(tool('ruler', 1));
    localStorage.setItem(
      DRAWABLES_STORAGE_KEY,
      JSON.stringify([
        {
          ...rulerDrawable('a'),
          geometry: { invalid: true },
          schemaVersion: 1,
        },
      ]),
    );
    expect(loadAll()).toEqual([]);
  });
});

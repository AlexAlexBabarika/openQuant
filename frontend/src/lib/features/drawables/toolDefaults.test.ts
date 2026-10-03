import {
  beforeAll,
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { BundledDrawable } from './bundledDrawable';

const mem = new Map<string, string>();
beforeAll(async () => {
  // Warm Svelte/UI compilation separately from the persistence assertions.
  await import('./toolCatalog');
}, 20_000);
beforeEach(() => {
  mem.clear();
  vi.resetModules();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => mem.set(k, v),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('legacy tool defaults through real registry and persistence', () => {
  it.each(['position-long', 'position-short'])(
    '%s migrates each legacy style and survives reload',
    async type => {
      for (const style of [
        {
          entryColor: '#12ab34',
          riskFill: '#ab1234',
          rewardFill: '#000000',
          showMetrics: false,
        },
        { riskFill: '#ab1234', rewardFill: '#000000' },
        { entryColor: '#12ab34' },
      ]) {
        vi.resetModules();
        localStorage.setItem(
          'openQuant.drawables.toolDefaults.v1',
          JSON.stringify({ [type]: { style, params: { oldSizing: 10 } } }),
        );
        const { getTool, saveAll, loadAll } = await import('./index');
        const tool = getTool(type)!;
        const m = tool.createPlacement({
          symbol: 'X',
          coordMap: {} as never,
          lastCandleTime: 1000,
          barStepSeconds: 100,
        });
        let geometry: unknown;
        m.onComplete(g => {
          geometry = g;
        });
        m.onPointerUp({ time: 1000, price: 100 });
        const d = {
          id: 'd',
          type,
          symbol: 'X',
          createdAt: 0,
          geometry,
          ...tool.defaults,
        } as BundledDrawable;
        saveAll([d]);
        const restored = loadAll();
        expect(restored).toHaveLength(1);
        expect(restored[0].params).toEqual({});
        expect(restored[0].style).toMatchObject({
          targetColor: style.entryColor ?? 'rgb(38, 166, 154)',
          stopColor: style.riskFill ?? 'rgb(239, 83, 80)',
          showMetrics: style.showMetrics ?? true,
        });
      }
    },
  );

  it('ignores malformed entries without replacing registered defaults', async () => {
    localStorage.setItem(
      'openQuant.drawables.toolDefaults.v1',
      JSON.stringify({ 'position-long': 'bad', ruler: null }),
    );
    const { getTool } = await import('./index');
    expect(getTool('position-long')!.defaults.style).toMatchObject({
      stopColor: 'rgb(239, 83, 80)',
    });
    expect(getTool('ruler')!.defaults.style).toMatchObject({ showStats: true });
  });
});

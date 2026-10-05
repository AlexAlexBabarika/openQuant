import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import {
  defaultChartColours,
  loadChartColoursFromStorage,
  loadTemplates,
  persistChartColours,
  refreshThemeColours,
  saveTemplate,
  setChartColour,
} from './chartColours';
import {
  getCssVarColor,
  invalidateCssVarCache,
  observeChartTheme,
  syncChartTheme,
} from './chart';

const values: Record<string, [string, string]> = {
  '--chart-background': ['#FFFFFF', '#18212B'],
  '--foreground': ['#1B2533', '#E6EDF5'],
  '--border': ['#CBD3DD', '#33404D'],
  '--chart-grid': ['#E4E9EF', '#263342'],
  '--up-color': ['#167666', '#50C5AE'],
  '--down-color': ['#B83B35', '#F08B82'],
  '--chart-1': ['#167666', '#50C5AE'],
  '--chart-2': ['#7B469B', '#CFABEB'],
  '--chart-3': ['#4F6074', '#AFBAC8'],
  '--ring': ['#245FC3', '#91BBFF'],
  '--risk': ['#8C5312', '#EFC48D'],
  '--area-top-color': [
    '0.509303 0.087596 178.1891 / 16%',
    '0.750610 0.110741 177.9453 / 16%',
  ],
  '--area-bottom-color': [
    '0.509303 0.087596 178.1891 / 2%',
    '0.750610 0.110741 177.9453 / 2%',
  ],
  '--volume-up-color': [
    '0.509303 0.087596 178.1891 / 24%',
    '0.750610 0.110741 177.9453 / 24%',
  ],
  '--volume-down-color': [
    '0.533150 0.162163 26.8637 / 24%',
    '0.742377 0.124532 25.8820 / 24%',
  ],
};

describe('theme-aware chart foundation', () => {
  let dark: boolean;
  let stored: Map<string, string>;
  let mutation: () => void;
  let disconnect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    dark = false;
    stored = new Map();
    disconnect = vi.fn();
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {
      documentElement: { classList: { contains: () => dark } },
    });
    vi.stubGlobal('getComputedStyle', () => ({
      getPropertyValue: (key: string) => values[key]?.[dark ? 1 : 0] ?? '',
    }));
    vi.stubGlobal(
      'MutationObserver',
      class {
        constructor(callback: () => void) {
          mutation = callback;
        }
        observe = vi.fn();
        disconnect = disconnect;
      },
    );
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    });
    invalidateCssVarCache();
  });

  afterEach(() => {
    invalidateCssVarCache();
    vi.unstubAllGlobals();
  });

  function switchTheme() {
    dark = !dark;
    invalidateCssVarCache();
  }

  it('refreshes every automatic default without mutating the previous colours', () => {
    const light = defaultChartColours();
    expect(light.chartBackground).toBe('rgb(255, 255, 255)');
    switchTheme();
    const next = refreshThemeColours(light);
    expect(next).toEqual(defaultChartColours());
    expect(light.chartBackground).toBe('rgb(255, 255, 255)');
    expect(next.chartBackground).toBe('rgb(24, 33, 43)');
    expect(next.candleUpBody).toBe('rgb(80, 197, 174)');
    expect(next.candleDownBody).toBe('rgb(240, 139, 130)');
  });

  it('keeps explicit edits fixed, even when the chosen colour equals a default', () => {
    const initial = defaultChartColours();
    const custom = setChartColour(
      initial,
      'chartBackground',
      initial.chartBackground,
    );
    switchTheme();
    const next = refreshThemeColours(custom);
    expect(next.chartBackground).toBe(initial.chartBackground);
    expect(next.textColour).toBe(defaultChartColours().textColour);
    expect(next.themeDefaultKeys).not.toContain('chartBackground');
  });

  it('restores automatic defaults and explicit edits correctly after reload', () => {
    const custom = setChartColour(
      defaultChartColours(),
      'candleUpBody',
      '#123456',
    );
    persistChartColours(custom);
    switchTheme();
    const loaded = loadChartColoursFromStorage();
    expect(loaded?.chartBackground).toBe(defaultChartColours().chartBackground);
    expect(loaded?.candleUpBody).toBe('#123456');
    expect(loaded?.themeDefaultKeys).not.toContain('candleUpBody');
  });

  it('does not infer automatic defaults from legacy saved colours', () => {
    const legacy = { ...defaultChartColours() };
    delete legacy.themeDefaultKeys;
    stored.set('openquant:chartColours', JSON.stringify(legacy));
    switchTheme();
    const loaded = loadChartColoursFromStorage()!;
    expect(loaded).toMatchObject(legacy);
    expect(loaded.themeDefaultKeys).toEqual([]);
    expect(refreshThemeColours(loaded)).toBe(loaded);
  });

  it('fills missing legacy keys with theme defaults while preserving saved keys', () => {
    stored.set(
      'openquant:chartColours',
      JSON.stringify({ chartBackground: '#102030' }),
    );
    const loaded = loadChartColoursFromStorage()!;
    switchTheme();
    const next = refreshThemeColours(loaded);
    expect(next.chartBackground).toBe('#102030');
    expect(next.textColour).toBe(defaultChartColours().textColour);
  });

  it('saves templates as fixed colour snapshots without changing their source', () => {
    const original = defaultChartColours();
    saveTemplate({
      name: 'Study',
      colours: original,
      smaLineWidth: 2,
      emaLineWidth: 2,
    });
    expect(original.themeDefaultKeys?.length).toBeGreaterThan(0);
    switchTheme();
    const template = loadTemplates()[0];
    expect(template.colours).toMatchObject({
      ...original,
      themeDefaultKeys: [],
    });
    expect(refreshThemeColours(template.colours)).toBe(template.colours);
  });

  it('filters malformed automatic-key metadata rather than applying arbitrary fields', () => {
    stored.set(
      'openquant:chartColours',
      JSON.stringify({
        chartBackground: '#102030',
        themeDefaultKeys: ['textColour', 'themeDefaultKeys', '__proto__', 5],
      }),
    );
    const loaded = loadChartColoursFromStorage()!;
    expect(loaded.themeDefaultKeys).toEqual(['textColour']);
    expect(loaded.chartBackground).toBe('#102030');
  });

  it('invalidates colour caches only on theme changes and disconnects on teardown', () => {
    const update = vi.fn();
    const stop = observeChartTheme(update);
    expect(getCssVarColor('--foreground')).toBe('rgb(27, 37, 51)');
    mutation();
    expect(update).not.toHaveBeenCalled();
    dark = true;
    mutation();
    expect(update).toHaveBeenCalledOnce();
    expect(getCssVarColor('--foreground')).toBe('rgb(230, 237, 245)');
    stop();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('updates chart chrome and candles in place without changing viewport or data', () => {
    const applyOptions = vi.fn();
    const candleOptions = vi.fn();
    const remove = vi.fn();
    const timeScale = vi.fn();
    const setData = vi.fn();
    const chart = { applyOptions, remove, timeScale } as unknown as IChartApi;
    const candleSeries = {
      applyOptions: candleOptions,
      setData,
    } as unknown as ISeriesApi<'Candlestick'>;
    switchTheme();
    syncChartTheme({ chart, candleSeries });
    expect(applyOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        layout: {
          background: { type: 'solid', color: 'rgb(24, 33, 43)' },
          textColor: 'rgb(230, 237, 245)',
        },
        grid: {
          vertLines: { color: 'rgb(38, 51, 66)' },
          horzLines: { color: 'rgb(38, 51, 66)' },
        },
      }),
    );
    expect(candleOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        upColor: 'rgb(80, 197, 174)',
        downColor: 'rgb(240, 139, 130)',
      }),
    );
    expect(remove).not.toHaveBeenCalled();
    expect(timeScale).not.toHaveBeenCalled();
    expect(setData).not.toHaveBeenCalled();
  });
});

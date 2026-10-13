import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  client,
  clientModule,
  componentDeclarations,
} from '$lib/features/chart/reactiveTestSupport';
import { buildCoordMap } from '$lib/features/drawables/coordMap';
import type { CoordMap } from '$lib/features/drawables/types';
import type { OHLCVCandle } from '$lib/core/types';
import { candleBatchSignature } from '$lib/features/chart/candleFingerprint';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe('Chart active series integration', () => {
  it('invalidates mappings for unversioned historical edits without subscribing owned publications to candle proxies', () => {
    const chartUrl = new URL('./Chart.svelte', import.meta.url);
    const props = client.proxy({
      candles: [0, 1].map(i => ({
        symbol: 'SYNTHETIC',
        timestamp: new Date(i * 60_000).toISOString(),
        open: 1,
        high: 2,
        low: 1,
        close: 2,
        volume: 100,
      })),
      candleRevision: undefined as number | undefined,
    });
    let revision!: () => string | number;
    const module = clientModule<{
      default: (anchor: unknown, props: unknown) => void;
    }>(
      chartUrl,
      {
        'test:signature': { candleBatchSignature },
        'test:capture': {
          capture: (value: typeof revision) => {
            revision = value;
          },
        },
      },
      `<script lang="ts">
      import { candleBatchSignature } from 'test:signature';
      import { capture } from 'test:capture';
      let { candles, candleRevision } = $props();
      ${componentDeclarations(chartUrl, ['coordCandleRevision'])}
      capture(() => coordCandleRevision);
      </script>`,
    );
    const revisions: (number | string)[] = [];
    cleanups.push(
      client.effect_root(() => {
        module.default(null, {
          get candles() {
            return props.candles;
          },
          get candleRevision() {
            return props.candleRevision;
          },
        });
        client.user_effect(() => {
          revisions.push(revision());
        });
      }),
    );
    client.flush();
    const first = revisions[0];
    props.candles[0].timestamp = new Date(30_000).toISOString();
    client.flush();
    expect(revisions).toHaveLength(2);
    expect(revisions[1]).not.toBe(first);
    props.candleRevision = 1;
    client.flush();
    expect(revisions).toHaveLength(3);
    props.candles[0].timestamp = new Date(40_000).toISOString();
    client.flush();
    expect(revisions).toHaveLength(3);
    props.candleRevision = 2;
    client.flush();
    expect(revisions).toHaveLength(4);
  });

  it('releases large-history mappings on return to a small scene and keeps renderer dependencies off candle proxies', () => {
    const chartUrl = new URL('./Chart.svelte', import.meta.url);
    const timeToIndex = vi.fn((time: number) => time / 60);
    const chart = {
      paneSize: () => ({ width: 800, height: 400 }),
      timeScale: () => ({
        timeToIndex,
        logicalToCoordinate: (index: number) => index,
        coordinateToLogical: (x: number) => x,
      }),
    };
    let harness!: {
      updateCoordMap: (version: number, data: OHLCVCandle[]) => void;
      clearCoordMap: () => void;
      map: () => CoordMap | null;
      current: () => CoordMap | null;
    };
    const module = clientModule<{
      default: (anchor: unknown, props: unknown) => void;
    }>(
      chartUrl,
      {
        'test:chart': { chart, buildCoordMap },
        'test:capture': {
          capture: (value: typeof harness) => {
            harness = value;
          },
        },
      },
      `<script lang="ts">
      import { untrack } from 'svelte';
      import { chart, buildCoordMap } from 'test:chart';
      import { capture } from 'test:capture';
      const series = { priceToCoordinate: p => p, coordinateToPrice: y => y };
      function priceSeries() { return series; }
      ${componentDeclarations(chartUrl, ['coordMap', 'currentCoordMap', 'updateCoordMap', 'clearCoordMap'])}
      capture({ updateCoordMap, clearCoordMap, map: () => coordMap, current: () => currentCoordMap });
      </script>`,
    );
    const large = client.proxy(
      Array.from({ length: 50_000 }, (_, i) => ({
        symbol: 'SYNTHETIC',
        timestamp: new Date(i * 60_000).toISOString(),
        open: 1,
        high: 2,
        low: 1,
        close: 2,
        volume: 100,
      })),
    );
    const small = client.proxy(large.slice(0, 500).map(c => ({ ...c })));
    let rendererCalls = 0;
    let previous!: CoordMap;
    const stop = client.effect_root(() => {
      module.default(null, {});
      harness.updateCoordMap(1, large);
      previous = harness.map()!;
      client.user_effect(() => {
        const map = harness.map();
        if (map) {
          map.timeToX(60);
          rendererCalls++;
        }
      });
    });
    cleanups.push(stop);
    client.flush();
    const calls = rendererCalls;
    large[1].timestamp = new Date(120_000).toISOString();
    client.flush();
    expect(rendererCalls).toBe(calls);
    harness.updateCoordMap(2, small);
    client.flush();
    expect(rendererCalls).toBe(calls + 1);
    timeToIndex.mockClear();
    expect(previous.timeToX(499 * 60)).toBe(499);
    expect(timeToIndex.mock.calls.map(([time]) => time)).toEqual([
      498 * 60,
      499 * 60,
    ]);
    large[498].timestamp = new Date(0).toISOString();
    expect(previous.timeToX(499 * 60)).toBe(499);
    harness.clearCoordMap();
    client.flush();
    expect(harness.map()).toBeNull();
    expect(harness.current()).toBeNull();
    expect(previous.timeToX(60)).toBeNull();
    expect(previous.xToTime(60)).toBeNull();
    expect(previous.priceToY(1)).toBeNull();
    expect(previous.yToPrice(1)).toBeNull();
  });

  it.each([
    ['BacktestChart', 'pendingViewport', 'updateViewport'],
    ['TimeSeriesChart', 'pendingFitContent', 'fitSeriesContent'],
  ])(
    'defers hidden %s result fitting and preserves its viewport on later task switches',
    (name, flag, fit) => {
      const url = new URL(`../backtest/${name}.svelte`, import.meta.url);
      const order: string[] = [];
      const fitContent = vi.fn(() => order.push('fit'));
      const setVisibleLogicalRange = vi.fn();
      const applyOptions = vi.fn(() => order.push('resize'));
      const containerEl = { clientWidth: 0, clientHeight: 0 };
      const backtest: { selection: { from: number; to: number } | null } = {
        selection: null,
      };
      const module = clientModule<{
        default: (
          anchor: unknown,
          props: unknown,
        ) => { fit: () => void; resize: () => void };
      }>(
        url,
        {
          'test:chart': {
            containerEl,
            backtest,
            chart: {
              applyOptions,
              timeScale: () => ({ fitContent, setVisibleLogicalRange }),
            },
          },
        },
        `<script lang="ts">
      import { chart, containerEl, backtest } from 'test:chart';
      ${componentDeclarations(url, [flag, fit, 'resize'])}
      export function fit() { ${fit}(); }
      export { resize };
      </script>`,
      );
      let harness!: ReturnType<typeof module.default>;
      cleanups.push(
        client.effect_root(() => {
          harness = module.default(null, {});
        }),
      );
      harness.fit();
      harness.resize();
      expect(order).toEqual([]);
      containerEl.clientWidth = 900;
      containerEl.clientHeight = 260;
      harness.resize();
      expect(order).toEqual(['resize', 'fit']);
      containerEl.clientWidth = 0;
      harness.resize();
      containerEl.clientWidth = 900;
      harness.resize();
      expect(fitContent).toHaveBeenCalledTimes(1);

      if (name === 'BacktestChart') {
        containerEl.clientWidth = 0;
        backtest.selection = { from: 10, to: 30 };
        harness.fit();
        expect(setVisibleLogicalRange).not.toHaveBeenCalled();
        containerEl.clientWidth = 900;
        harness.resize();
        expect(setVisibleLogicalRange).toHaveBeenCalledWith({
          from: 10,
          to: 30,
        });
        expect(fitContent).toHaveBeenCalledTimes(1);
      }
    },
  );

  it('defers fitting hidden data until after a measurable resize without refitting on later task switches', () => {
    const chartUrl = new URL('./Chart.svelte', import.meta.url);
    const order: string[] = [];
    const fitContent = vi.fn(() => order.push('fit'));
    const applyOptions = vi.fn(options => {
      if ('width' in options) order.push('resize');
    });
    const containerEl = { clientWidth: 0, clientHeight: 0 };
    const module = clientModule<{
      default: (
        anchor: unknown,
        props: unknown,
      ) => {
        fit: () => void;
        resize: () => void;
      };
    }>(
      chartUrl,
      {
        'test:chart': {
          containerEl,
          chart: { applyOptions, timeScale: () => ({ fitContent }) },
        },
      },
      `<script lang="ts">
      import { chart, containerEl } from 'test:chart';
      let coordVersion = $state(0), priceInvalidator = null;
      const CHART_TIME_SCALE_RIGHT_OFFSET = 8;
      ${componentDeclarations(chartUrl, ['pendingFitContent', 'fitSeriesContent', 'handleResize'])}
      export function fit() { fitSeriesContent(); }
      export function resize() { handleResize(); }
      </script>`,
    );
    let harness!: ReturnType<typeof module.default>;
    cleanups.push(
      client.effect_root(() => {
        harness = module.default(null, {});
      }),
    );
    harness.fit();
    harness.resize();
    expect(applyOptions).not.toHaveBeenCalled();
    expect(fitContent).not.toHaveBeenCalled();

    containerEl.clientWidth = 1200;
    containerEl.clientHeight = 700;
    harness.resize();
    expect(order).toEqual(['resize', 'fit']);
    expect(applyOptions).toHaveBeenLastCalledWith({
      timeScale: { rightOffset: 8 },
    });

    containerEl.clientWidth = 0;
    harness.resize();
    containerEl.clientWidth = 1200;
    harness.resize();
    expect(fitContent).toHaveBeenCalledTimes(1);

    // New history loaded while another task is visible needs a fresh fit.
    containerEl.clientWidth = 0;
    harness.fit();
    containerEl.clientWidth = 900;
    harness.resize();
    expect(fitContent).toHaveBeenCalledTimes(2);
  });

  it('publishes actual applySeries replacements to the marker effect without changing scripts', () => {
    const chartUrl = new URL('./Chart.svelte', import.meta.url);
    const removed: unknown[] = [];
    const chart = { removeSeries: (series: unknown) => removed.push(series) };
    const plugins: {
      detach: ReturnType<typeof vi.fn>;
      setMarkers: ReturnType<typeof vi.fn>;
    }[] = [];
    const create = vi.fn((_series: unknown, _data: unknown) => {
      const plugin = { detach: vi.fn(), setMarkers: vi.fn() };
      plugins.push(plugin);
      return plugin;
    });
    const markers = clientModule<{
      default: (anchor: unknown, props: unknown) => void;
    }>(new URL('./ChartScriptMarkers.svelte', import.meta.url), {
      'lightweight-charts': { createSeriesMarkers: create },
    }).default;
    let apply!: (type: string) => void;
    let series!: () => unknown;
    const module = clientModule<{
      default: (anchor: unknown, props: unknown) => void;
    }>(
      chartUrl,
      {
        'test:chart': {
          chart,
          colours: undefined,
          addCandlestickSeries: () => ({ kind: 'candlestick' }),
          addLineSeries: () => ({ kind: 'line' }),
          resolveColour: () => '#fff',
        },
        'test:capture': {
          capture: (value: {
            applySeries: typeof apply;
            priceSeries: typeof series;
          }) => {
            apply = value.applySeries;
            series = value.priceSeries;
          },
        },
      },
      `<script lang="ts">
      import { chart, colours, addCandlestickSeries, addLineSeries, resolveColour } from 'test:chart';
      import { capture } from 'test:capture';
      ${componentDeclarations(chartUrl, ['candleSeries', 'lineSeries', 'applySeries', 'priceSeries'])}
      capture({ applySeries, priceSeries });
    </script>`,
    );
    const stop = client.effect_root(() => {
      module.default(null, {});
      markers(null, {
        priceSeriesFn: () => series(),
        runningScripts: [
          { outputs: [{ type: 'markers', data: [{ time: 1 }] }] },
        ],
      });
    });
    cleanups.push(stop);
    client.flush();
    expect(create).not.toHaveBeenCalled();
    for (let i = 0; i < 41; i++) {
      apply(i % 2 ? 'line' : 'candlestick');
      client.flush();
      expect(create).toHaveBeenCalledTimes(i + 1);
      expect(create.mock.calls[i][0]).toBe(series());
      expect(create.mock.calls[i][1]).toMatchObject([{ time: 1 }]);
      expect(create.mock.calls[i][1]).toEqual(create.mock.calls[0][1]);
      expect(removed).toHaveLength(i);
      plugins.slice(0, -1).forEach(plugin => {
        expect(plugin.detach).toHaveBeenCalledTimes(1);
        expect(plugin.setMarkers).not.toHaveBeenCalled();
      });
    }
    stop();
    expect(plugins.every(plugin => plugin.detach.mock.calls.length === 1)).toBe(
      true,
    );
  });
});

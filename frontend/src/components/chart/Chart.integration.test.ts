import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  client,
  clientModule,
  componentDeclarations,
} from '$lib/features/chart/reactiveTestSupport';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe('Chart active series integration', () => {
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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { client, clientModule } from '$lib/features/chart/reactiveTestSupport';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function setup() {
  const series = client.state<unknown>(null);
  const scripts = client.proxy({
    value: [
      {
        outputs: [
          {
            type: 'markers',
            data: [{ time: 2 }, { time: 1 }],
            shape: 'arrowup',
            position: 'belowbar',
          },
        ],
      },
    ],
  });
  const plugins: {
    detach: ReturnType<typeof vi.fn>;
    setMarkers: ReturnType<typeof vi.fn>;
  }[] = [];
  const create = vi.fn((_series: unknown, _data: unknown) => {
    const plugin = { detach: vi.fn(), setMarkers: vi.fn() };
    plugins.push(plugin);
    return plugin;
  });
  const component = clientModule<{
    default: (anchor: unknown, props: unknown) => void;
  }>(new URL('./ChartScriptMarkers.svelte', import.meta.url), {
    'lightweight-charts': { createSeriesMarkers: create },
  }).default;
  const stop = client.effect_root(() =>
    component(null, {
      priceSeriesFn: () => client.get(series),
      get runningScripts() {
        return scripts.value;
      },
    }),
  );
  cleanups.push(stop);
  client.flush();
  return { series, scripts, plugins, create, stop };
}

describe('script marker lifecycle', () => {
  it('tracks late initialization and 20 active series replacements without script changes', () => {
    const { series, create, plugins, stop } = setup();
    expect(create).not.toHaveBeenCalled();
    for (let i = 0; i < 21; i++) {
      const next = { kind: i % 2 ? 'line' : 'candlestick', i };
      client.set(series, next);
      client.flush();
      expect(create).toHaveBeenCalledTimes(i + 1);
      expect(create.mock.calls[i][0]).toBe(next);
      expect(create.mock.calls[i][1]).toEqual([
        {
          time: 1,
          shape: 'arrowUp',
          position: 'belowBar',
          color: '#eab308',
          text: undefined,
        },
        {
          time: 2,
          shape: 'arrowUp',
          position: 'belowBar',
          color: '#eab308',
          text: undefined,
        },
      ]);
      for (const plugin of plugins.slice(0, -1)) {
        expect(plugin.detach).toHaveBeenCalledTimes(1);
        expect(plugin.setMarkers).not.toHaveBeenCalled();
      }
    }
    stop();
    for (const plugin of plugins)
      expect(plugin.detach).toHaveBeenCalledTimes(1);
  });

  it('tracks in-place output changes, detaches on empty output and never updates a removed series', () => {
    const { series, scripts, create, plugins } = setup();
    client.set(series, {});
    client.flush();
    scripts.value[0].outputs[0].data.push({ time: 3 });
    client.flush();
    expect(plugins[0].setMarkers).toHaveBeenCalledTimes(1);
    expect(plugins[0].setMarkers.mock.calls[0][0]).toHaveLength(3);
    scripts.value[0].outputs[0].data = [];
    client.flush();
    expect(plugins[0].detach).toHaveBeenCalledTimes(1);
    client.set(series, null);
    scripts.value[0].outputs[0].data = [{ time: 4 }];
    client.flush();
    expect(create).toHaveBeenCalledTimes(1);
    expect(plugins[0].setMarkers).toHaveBeenCalledTimes(1);
  });
});

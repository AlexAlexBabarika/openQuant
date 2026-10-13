import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { parse } from 'svelte/compiler';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  client,
  clientModule,
  componentDeclarations,
  deferred,
} from '$lib/features/chart/reactiveTestSupport';
import { candleBatchSignature } from '$lib/features/chart/candleFingerprint';
import { withRulerCandleIndex } from '$lib/features/drawables/tools/ruler/compute';
import { createDrawableComputeScheduler } from '$lib/features/drawables/computeScheduler';
import type {
  ComputeCtx,
  DrawableComputeState,
} from '$lib/features/drawables/types';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

// Script-only effect/callback evidence, not a native DOM mount/unmount test.
describe('chart lifecycle callback boundaries', () => {
  it.each(['resolve', 'reject'] as const)(
    'isolates identical drawable ids/work keys after old-owner %s',
    async outcome => {
      const requests: {
        signal: AbortSignal;
        result: ReturnType<typeof deferred<unknown>>;
      }[] = [];
      const compute = (_item: unknown, ctx: ComputeCtx) => {
        const result = deferred<unknown>();
        requests.push({ signal: ctx.signal, result });
        return result.promise;
      };
      const component = clientModule<{
        default: (anchor: unknown, props: unknown) => void;
      }>(new URL('./ChartDrawablesCompute.svelte', import.meta.url), {
        '$lib/features/chart/candleFingerprint': { candleBatchSignature },
        '$lib/features/drawables': { getTool: () => ({ compute }) },
        '$lib/features/drawables/tools/ruler/compute': { withRulerCandleIndex },
        '$lib/features/drawables/computeScheduler': {
          createDrawableComputeScheduler,
        },
        '$lib/core/dev/drawablesProfile': {
          measureDrawablesSync: (_label: string, run: () => unknown) => run(),
        },
      }).default;
      const props = {
        symbol: 'TEST',
        provider: 'test',
        interval: '1d',
        candleRevision: 1,
        candles: [],
        items: [
          { id: 'same-id', type: 'ruler', geometry: {}, params: {}, style: {} },
        ],
      };
      function createOwner() {
        const data = client.state(new Map<string, unknown>());
        const states = client.state(new Map<string, DrawableComputeState>());
        const stop = client.effect_root(() =>
          component(null, {
            ...props,
            get computedData() {
              return client.get(data);
            },
            set computedData(value: Map<string, unknown>) {
              client.set(data, value);
            },
            get computedStates() {
              return client.get(states);
            },
            set computedStates(value: Map<string, DrawableComputeState>) {
              client.set(states, value);
            },
          }),
        );
        client.flush();
        cleanups.push(stop);
        return { data, states, stop };
      }
      const old = createOwner();
      const oldKey = client.get(old.states).get('same-id')?.workKey;
      old.stop();
      expect(requests[0].signal.aborted).toBe(true);
      expect(client.get(old.data).size).toBe(0);
      expect(client.get(old.states).size).toBe(0);
      const latest = createOwner();
      expect(client.get(latest.states).get('same-id')?.workKey).toBe(oldKey);
      if (outcome === 'resolve')
        requests[0].result.resolve('old-private-result');
      else requests[0].result.reject(new Error('old-private-failure'));
      await Promise.resolve();
      client.flush();
      expect(client.get(old.data).size).toBe(0);
      expect(client.get(old.states).size).toBe(0);
      expect(client.get(latest.data).size).toBe(0);
      expect(client.get(latest.states).get('same-id')?.status).toBe('pending');
      requests[1].result.resolve('current-result');
      await Promise.resolve();
      client.flush();
      expect(client.get(latest.data).get('same-id')).toBe('current-result');
      latest.stop();
      expect(client.get(latest.data).size).toBe(0);
      expect(client.get(latest.states).size).toBe(0);
    },
  );

  it('runs actual chart lifecycle callbacks and releases observers/listeners/invalidator', () => {
    const chartUrl = new URL('./Chart.svelte', import.meta.url);
    const componentSource = readFileSync(chartUrl, 'utf8');
    const instance = parse(componentSource, { modern: true }).instance!;
    const source = componentSource
      .slice(instance.start, instance.end)
      .replace(/^<script[^>]*>|<\/script>$/g, '');
    const ast = ts.createSourceFile(
      chartUrl.pathname,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const callbacks = ast.statements
      .filter(
        node =>
          ts.isExpressionStatement(node) &&
          ts.isCallExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          ['onMount', 'onDestroy'].includes(node.expression.expression.text),
      )
      .map(node => node.getText(ast))
      .join('\n');
    expect(callbacks).toContain('chart.remove()');
    const target = () => {
      const events = new Map<string, { listener: unknown; capture: unknown }>();
      return {
        events,
        addEventListener: vi.fn((name, listener, capture) =>
          events.set(name, { listener, capture }),
        ),
        removeEventListener: vi.fn((name, listener, capture) => {
          expect(events.get(name)).toEqual({ listener, capture });
          events.delete(name);
        }),
      };
    };
    const windowTarget = target();
    const container = target();
    const invalidator = {
      start: vi.fn(),
      stop: vi.fn(),
      settle: vi.fn(),
      destroy: vi.fn(),
    };
    const observer = { observe: vi.fn(), disconnect: vi.fn() };
    const chart = {
      remove: vi.fn(),
      timeScale: () => ({ subscribeVisibleLogicalRangeChange: vi.fn() }),
    };
    const comparisons = new Map([['id', {}]]);
    let mount!: () => () => void;
    let destroy!: () => void;
    const harness = clientModule<{
      default: (anchor: unknown, props: unknown) => { snapshot: () => unknown };
    }>(
      chartUrl,
      {
        'test:lifecycle': {
          env: {
            windowTarget,
            container,
            invalidator,
            observer,
            chart,
            comparisons,
          },
          onMount: (fn: typeof mount) => {
            mount = fn;
          },
          onDestroy: (fn: typeof destroy) => {
            destroy = fn;
          },
        },
      },
      `<script lang="ts">
        import {env,onMount,onDestroy} from 'test:lifecycle';
        const window = env.windowTarget;
        const containerEl = env.container;
        let chart = env.chart;
        let api = null;
        let coordVersion = 0;
        ${componentDeclarations(chartUrl, ['coordMap', 'currentCoordMap', 'clearCoordMap', 'prevCandles', 'candleSeries', 'lineSeries', 'areaSeries', 'volumeSeries', 'smaSeries', 'emaSeries', 'bbandsUpperSeries', 'bbandsMiddleSeries', 'bbandsLowerSeries'])}
        let priceInvalidator = null;
        let resizeObserver = null;
        const comparisonSeriesById = env.comparisons;
        const initChart = () => {};
        const appendCandle = () => {};
        const handleResize = () => {};
        const coordinateInvalidator = () => env.invalidator;
        const ResizeObserver = class { constructor() {return env.observer;} };
        ${callbacks}
        export function snapshot() {return {chart,api,priceInvalidator,resizeObserver,coordMap,currentCoordMap,prevCandles,candleSeries,lineSeries};}
      </script>`,
    ).default(null, {});
    const cleanup = mount();
    expect(windowTarget.events.size).toBe(4);
    expect(container.events.size).toBe(2);
    expect(observer.observe).toHaveBeenCalledExactlyOnceWith(container);
    cleanup();
    destroy();
    expect(windowTarget.events.size).toBe(0);
    expect(container.events.size).toBe(0);
    expect(invalidator.destroy).toHaveBeenCalledOnce();
    expect(observer.disconnect).toHaveBeenCalledOnce();
    expect(chart.remove).toHaveBeenCalledOnce();
    expect(comparisons.size).toBe(0);
    expect(harness.snapshot()).toEqual({
      chart: null,
      api: null,
      priceInvalidator: null,
      resizeObserver: null,
      coordMap: null,
      currentCoordMap: null,
      prevCandles: undefined,
      candleSeries: null,
      lineSeries: null,
    });
  });
});

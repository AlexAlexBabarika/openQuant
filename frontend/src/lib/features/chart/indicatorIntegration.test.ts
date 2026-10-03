import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  client,
  clientModule,
  componentDeclarations,
  deferred,
} from './reactiveTestSupport';
import { fetchSMA, fetchEMA, fetchBBands } from './indicators';
import type { IndicatorResult } from './indicatorEffect.svelte';

const api = vi.hoisted(() => ({ json: vi.fn() }));
vi.mock('$lib/core/api', () => ({ apiJson: api.json }));
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('built-in indicator caller integration', () => {
  it('forwards cancellation through all App callbacks and refreshes the same chart for a new account', async () => {
    vi.useFakeTimers();
    const context = client.proxy({
      chart: { loadedSymbol: 'AAA', marketDataVersion: 1, errorMessage: '' },
      smaConfig: { enabled: true, period: 20 },
      emaConfig: { enabled: true, period: 20 },
      bbandsConfig: { enabled: true, period: 20, stdDev: 2 },
      auth: { user: { id: 'one' } },
      hasCandles: true,
    });
    const requests: ReturnType<typeof deferred<{ points: number[] }>>[] = [];
    api.json.mockImplementation(() => {
      const request = deferred<{ points: number[] }>();
      requests.push(request);
      return request.promise;
    });
    const effect = clientModule(
      new URL('./indicatorEffect.svelte.ts', import.meta.url),
      {
        '$lib/core/api': { getSessionGeneration: () => 1 },
      },
    );
    let results!: {
      sma: IndicatorResult<number>;
      ema: IndicatorResult<number>;
      bbands: IndicatorResult<number>;
    };
    const app = new URL('../../../App.svelte', import.meta.url);
    const module = clientModule<{
      default: (anchor: unknown, props: unknown) => void;
    }>(
      app,
      {
        'test:context': {
          ...context,
          authState: {
            subscribe: (run: (value: typeof context.auth) => void) => {
              run(context.auth);
              return () => {};
            },
          },
        },
        'test:effect': effect,
        'test:api': { fetchSMA, fetchEMA, fetchBBands },
        'test:capture': {
          capture: (value: typeof results) => {
            results = value;
          },
        },
      },
      `<script lang="ts">
      import { chart, smaConfig, emaConfig, bbandsConfig, authState, hasCandles } from 'test:context';
      import { useIndicatorEffect } from 'test:effect';
      import { fetchSMA, fetchEMA, fetchBBands } from 'test:api';
      import { capture } from 'test:capture';
      ${componentDeclarations(app, ['indicatorErrorHandler', 'sma', 'ema', 'bbands'])}
      capture({ sma, ema, bbands });
    </script>`,
    );
    cleanups.push(client.effect_root(() => module.default(null, {})));
    client.flush();
    await vi.advanceTimersByTimeAsync(300);
    expect(requests).toHaveLength(3);
    const firstSignals = api.json.mock.calls.map(call => call[1]?.signal);
    expect(firstSignals.every(signal => signal instanceof AbortSignal)).toBe(
      true,
    );
    requests.forEach(request => request.resolve({ points: [1] }));
    await Promise.resolve();
    await Promise.resolve();
    expect(Object.values(results).map(result => result.points)).toEqual([
      [1],
      [1],
      [1],
    ]);
    context.auth.user.id = 'two';
    client.flush();
    expect(firstSignals.every(signal => signal.aborted)).toBe(true);
    expect(Object.values(results).map(result => result.points)).toEqual([
      [],
      [],
      [],
    ]);
    await vi.advanceTimersByTimeAsync(300);
    expect(requests).toHaveLength(6);
    cleanups[0]();
    expect(
      api.json.mock.calls.slice(3).every(call => call[1].signal.aborted),
    ).toBe(true);
  });
});

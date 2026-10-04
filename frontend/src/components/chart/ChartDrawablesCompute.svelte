<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import type { OHLCVCandle } from '$lib/core/types';
  import { candleBatchSignature } from '$lib/features/chart/candleFingerprint';
  import type { BundledDrawable } from '$lib/features/drawables/bundledDrawable';
  import type { DrawableComputeState } from '$lib/features/drawables/types';
  import { getTool } from '$lib/features/drawables';
  import { withRulerCandleIndex } from '$lib/features/drawables/tools/ruler/compute';
  import { measureDrawablesSync } from '$lib/core/dev/drawablesProfile';

  let {
    symbol,
    candles,
    provider,
    interval,
    items,
    computedData = $bindable(new Map<string, unknown>()),
    computedStates = $bindable(new Map<string, DrawableComputeState>()),
  }: {
    symbol: string;
    candles: OHLCVCandle[];
    provider: string;
    interval: string;
    items: readonly BundledDrawable[];
    computedData?: Map<string, unknown>;
    computedStates?: Map<string, DrawableComputeState>;
  } = $props();

  const needsCandles = $derived(items.some(d => Boolean(getTool(d.type)?.compute)));
  const candleSig = $derived(
    needsCandles
      ? measureDrawablesSync('drawables:candle-signature', () =>
          candleBatchSignature(candles),
        )
      : '0',
  );
  const jobs = new Map<string, { key: string; controller: AbortController }>();
  let destroyed = false;

  $effect(() => {
    const cs = candles;
    const sig = candleSig;
    const sym = symbol;
    const prov = provider;
    const iv = interval;
    const keyed = measureDrawablesSync('drawables:workKey', () =>
      items.map(d => ({
        drawable: d,
        key: JSON.stringify([
          sym, prov, iv, sig, d.type, d.geometry, d.params, d.style,
        ]),
      })),
    );

    untrack(() => {
      measureDrawablesSync('drawables:compute-pass', () => {
        const nextData = new Map(computedData);
        const nextStates = new Map(computedStates);
        const liveIds = new Set(keyed.map(({ drawable }) => drawable.id));
        let changed = false;
        for (const [id, job] of jobs) {
          if (liveIds.has(id)) continue;
          job.controller.abort();
          jobs.delete(id);
          nextData.delete(id);
          nextStates.delete(id);
          changed = true;
        }

        withRulerCandleIndex(cs, sig, () => {
          for (const { drawable: d, key } of keyed) {
            const tool = getTool(d.type);
            if (!tool?.compute) {
              const previous = jobs.get(d.id);
              if (previous) {
                previous.controller.abort();
                jobs.delete(d.id);
                nextData.delete(d.id);
                nextStates.delete(d.id);
                changed = true;
              }
              continue;
            }
            if (jobs.get(d.id)?.key === key) continue;
            jobs.get(d.id)?.controller.abort();
            const controller = new AbortController();
            const job = { key, controller };
            jobs.set(d.id, job);
            nextData.delete(d.id);
            nextStates.set(d.id, { status: 'pending', workKey: key });
            changed = true;

            const settle = (value: unknown, error?: unknown) => {
              if (
                destroyed || controller.signal.aborted || jobs.get(d.id) !== job
              ) return;
              const state: DrawableComputeState =
                error === undefined
                  ? { status: 'success', workKey: key }
                  : {
                      status: 'error',
                      workKey: key,
                      error: error instanceof Error ? error.message : 'Calculation failed',
                    };
              computedStates = new Map(computedStates).set(d.id, state);
              const data = new Map(computedData);
              if (error === undefined) data.set(d.id, value);
              else data.delete(d.id);
              computedData = data;
            };

            try {
              const result = tool.compute(d, {
                candles: cs,
                provider: prov,
                symbol: sym,
                interval: iv,
                signal: controller.signal,
              });
              if (result instanceof Promise) {
                result.then(
                  value => settle(value),
                  error => settle(undefined, error ?? new Error('Calculation failed')),
                );
              } else {
                nextData.set(d.id, result);
                nextStates.set(d.id, { status: 'success', workKey: key });
              }
            } catch (error) {
              nextStates.set(d.id, {
                status: 'error',
                workKey: key,
                error: error instanceof Error ? error.message : 'Calculation failed',
              });
            }
          }
        });
        if (changed) {
          computedData = nextData;
          computedStates = nextStates;
        }
      });
    });
  });

  onDestroy(() => {
    destroyed = true;
    for (const { controller } of jobs.values()) controller.abort();
    jobs.clear();
    computedData = new Map();
    computedStates = new Map();
  });
</script>

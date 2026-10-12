<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import type { OHLCVCandle } from '$lib/core/types';
  import { candleBatchSignature } from '$lib/features/chart/candleFingerprint';
  import type { BundledDrawable } from '$lib/features/drawables/bundledDrawable';
  import type { DrawableComputeState } from '$lib/features/drawables/types';
  import { getTool } from '$lib/features/drawables';
  import { withRulerCandleIndex } from '$lib/features/drawables/tools/ruler/compute';
  import { createDrawableComputeScheduler } from '$lib/features/drawables/computeScheduler';
  import { measureDrawablesSync } from '$lib/core/dev/drawablesProfile';

  let {
    symbol,
    candles,
    candleRevision,
    provider,
    interval,
    items,
    computedData = $bindable(new Map<string, unknown>()),
    computedStates = $bindable(new Map<string, DrawableComputeState>()),
  }: {
    symbol: string;
    candles: OHLCVCandle[];
    /** Omit for externally mutable candles without an owned publication token. */
    candleRevision?: number;
    provider: string;
    interval: string;
    items: readonly BundledDrawable[];
    computedData?: Map<string, unknown>;
    computedStates?: Map<string, DrawableComputeState>;
  } = $props();

  const needsCandles = $derived(
    items.some(d => {
      const tool = getTool(d.type);
      return tool?.compute && tool.computeUsesCandles !== false;
    }),
  );
  const candleSig = $derived(
    needsCandles
      ? candleRevision !== undefined
        ? `revision:${candleRevision}`
        : measureDrawablesSync('drawables:candle-signature', () =>
            candleBatchSignature(candles),
          )
      : '0',
  );
  let batch:
    | {
        data: Map<string, unknown>;
        states: Map<string, DrawableComputeState>;
        changed: boolean;
      }
    | undefined;
  function publish(id: string, state?: DrawableComputeState, value?: unknown) {
    const data = batch?.data ?? new Map(computedData);
    const states = batch?.states ?? new Map(computedStates);
    if (state?.status === 'success') data.set(id, value);
    else data.delete(id);
    if (state) states.set(id, state);
    else states.delete(id);
    if (batch) batch.changed = true;
    else {
      computedData = data;
      computedStates = states;
    }
  }
  const scheduler = createDrawableComputeScheduler({
    pending: (id, key) => publish(id, { status: 'pending', workKey: key }),
    success: (id, key, value) =>
      publish(id, { status: 'success', workKey: key }, value),
    error: (id, key, error) =>
      publish(id, {
        status: 'error',
        workKey: key,
        error: error instanceof Error ? error.message : 'Calculation failed',
      }),
    removed: id => publish(id),
  });

  $effect(() => {
    const cs = candles;
    const sig = candleSig;
    const sym = symbol;
    const prov = provider;
    const iv = interval;
    const keyed = measureDrawablesSync('drawables:workKey', () =>
      items.map(d => {
        const dataKey =
          getTool(d.type)?.computeUsesCandles === false ? '0' : sig;
        const cancelKey = JSON.stringify([
          sym,
          prov,
          iv,
          d.type,
          d.geometry,
          d.params,
          d.style,
        ]);
        return {
          drawable: d,
          cancelKey,
          key: JSON.stringify([cancelKey, dataKey]),
        };
      }),
    );

    untrack(() => {
      measureDrawablesSync('drawables:compute-pass', () => {
        batch = {
          data: new Map(computedData),
          states: new Map(computedStates),
          changed: false,
        };
        try {
          scheduler.retain(
            new Set(
              keyed
                .filter(({ drawable }) => getTool(drawable.type)?.compute)
                .map(({ drawable }) => drawable.id),
            ),
          );
          withRulerCandleIndex(cs, sig, () => {
            for (const { drawable: d, key, cancelKey } of keyed) {
              const tool = getTool(d.type);
              if (!tool?.compute) continue;
              const compute = tool.compute;
              scheduler.submit(d.id, {
                key,
                cancelKey,
                run: signal =>
                  compute(d, {
                    candles: cs,
                    provider: prov,
                    symbol: sym,
                    interval: iv,
                    signal,
                  }),
              });
            }
          });
          if (batch.changed) {
            computedData = batch.data;
            computedStates = batch.states;
          }
        } finally {
          batch = undefined;
        }
      });
    });
  });

  onDestroy(() => {
    scheduler.destroy();
    computedData = new Map();
    computedStates = new Map();
  });
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import {
    createSeriesMarkers,
    type ISeriesApi,
    type ISeriesMarkersPluginApi,
    type SeriesMarker,
    type SeriesMarkerBarPosition,
    type SeriesMarkerShape,
    type Time,
  } from 'lightweight-charts';
  import type { ScriptOutput } from '$lib/features/indicators/scripts';
  import type { RunningScript } from '$lib/features/indicators/indicatorState.svelte';

  let {
    priceSeriesFn,
    runningScripts = [] as RunningScript[],
  }: {
    priceSeriesFn: () => ISeriesApi<'Candlestick' | 'Line'> | null;
    runningScripts?: RunningScript[];
  } = $props();

  const DEFAULT_MARKER_COLOUR = '#eab308';

  const SHAPE_MAP: Record<string, SeriesMarkerShape> = {
    square: 'square',
    arrowup: 'arrowUp',
    arrow_up: 'arrowUp',
    arrowdown: 'arrowDown',
    arrow_down: 'arrowDown',
  };

  const POSITION_MAP: Record<string, SeriesMarkerBarPosition> = {
    belowbar: 'belowBar',
    below_bar: 'belowBar',
    inbar: 'inBar',
    in_bar: 'inBar',
  };

  const lookup = <T,>(
    table: Record<string, T>,
    name: string | null | undefined,
    fallback: T,
  ): T => table[(name ?? '').toLowerCase()] ?? fallback;

  let plugin: ISeriesMarkersPluginApi<Time> | null = null;
  let attachedTo: ISeriesApi<'Candlestick' | 'Line'> | null = null;

  function detach(): void {
    if (!plugin) return;
    try {
      plugin.detach();
    } catch {
      /* series already removed */
    }
    plugin = null;
    attachedTo = null;
  }

  function build(scripts: RunningScript[]): SeriesMarker<Time>[] {
    const merged: SeriesMarker<Time>[] = [];
    for (const s of scripts) {
      for (const out of s.outputs) {
        if (out.type !== 'markers') continue;
        const m = out as Extract<ScriptOutput, { type: 'markers' }>;
        const shape = lookup(SHAPE_MAP, m.shape, 'circle');
        const position = lookup(POSITION_MAP, m.position, 'aboveBar');
        const color = m.color ?? DEFAULT_MARKER_COLOUR;
        const text = m.text ?? undefined;
        for (const pt of m.data) {
          merged.push({
            time: pt.time as Time,
            shape,
            position,
            color,
            text,
          });
        }
      }
    }
    merged.sort((a, b) => Number(a.time) - Number(b.time));
    return merged;
  }

  $effect(() => {
    const scripts = runningScripts;
    const priceSeries = priceSeriesFn();
    const data = build(scripts);
    untrack(() => {
      if (!priceSeries) {
        detach();
        return;
      }
      if (data.length === 0) {
        detach();
        return;
      }
      if (!plugin || attachedTo !== priceSeries) {
        detach();
        plugin = createSeriesMarkers(priceSeries, data);
        attachedTo = priceSeries;
      } else {
        plugin.setMarkers(data);
      }
    });
  });

  onDestroy(detach);
</script>

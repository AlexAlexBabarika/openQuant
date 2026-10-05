<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { LineStyle, type IChartApi, type ISeriesApi, type Time } from 'lightweight-charts';
  import {
    createChartContainer,
    addLineSeries,
    invalidateCssVarCache,
    getCssVarColor,
    syncChartTheme,
    observeChartTheme,
  } from '$lib/features/chart/chart';
  import type { TimeValue } from '$lib/features/backtest/derive';

  interface LineSpec {
    data: TimeValue[];
    color: string;
    lineWidth?: number;
    lineStyle?: LineStyle;
  }

  let {
    lines,
    percent = false,
  }: {
    lines: LineSpec[];
    /** Format the price axis as a percent (values are fractions). */
    percent?: boolean;
  } = $props();

  let containerEl = $state<HTMLDivElement | null>(null);
  let chart = $state.raw<IChartApi | null>(null);
  let series: ISeriesApi<'Line'>[] = [];
  let resizeObserver: ResizeObserver | null = null;
  let stopThemeObserver: (() => void) | undefined;
  let pendingFitContent = false;

  function fitSeriesContent(): void {
    if (!chart || !containerEl) return;
    pendingFitContent = true;
    if (!containerEl.clientWidth || !containerEl.clientHeight) return;
    chart.timeScale().fitContent();
    pendingFitContent = false;
  }

  function rebuild(specs: LineSpec[]): void {
    if (!chart) return;
    for (const s of series) chart.removeSeries(s);
    series = [];
    for (const spec of specs) {
      const s = addLineSeries(chart, resolveLineColour(spec.color));
      s.applyOptions({
        lineWidth: (spec.lineWidth ?? 2) as 1 | 2 | 3 | 4,
        lineStyle: spec.lineStyle ?? LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
        ...(percent
          ? {
              priceFormat: {
                type: 'custom' as const,
                formatter: (v: number) => `${(v * 100).toFixed(1)}%`,
                minMove: 0.0001,
              },
            }
          : {}),
      });
      s.setData(spec.data.map(p => ({ time: p.t as Time, value: p.value })));
      series.push(s);
    }
    fitSeriesContent();
  }

  function resolveLineColour(color: string): string {
    return color.startsWith('--') ? getCssVarColor(color) : color;
  }

  function resize(): void {
    if (chart && containerEl) {
      if (!containerEl.clientWidth || !containerEl.clientHeight) return;
      chart.applyOptions({
        width: containerEl.clientWidth,
        height: containerEl.clientHeight,
      });
      if (pendingFitContent) fitSeriesContent();
    }
  }

  onMount(() => {
    if (!containerEl) return;
    invalidateCssVarCache();
    chart = createChartContainer(containerEl);
    stopThemeObserver = observeChartTheme(() => {
      if (!chart) return;
      syncChartTheme({ chart });
      series.forEach((s, i) => s.applyOptions({ color: resolveLineColour(lines[i].color) }));
    });
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(containerEl);
  });

  $effect(() => {
    rebuild(lines);
  });

  onDestroy(() => {
    stopThemeObserver?.();
    resizeObserver?.disconnect();
    resizeObserver = null;
    chart?.remove();
    chart = null;
  });
</script>

<div class="chart" bind:this={containerEl}></div>

<style>
  .chart {
    width: 100%;
    height: 100%;
    min-height: 0;
  }
</style>

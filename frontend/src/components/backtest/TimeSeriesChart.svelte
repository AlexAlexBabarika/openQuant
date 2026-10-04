<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { IChartApi, ISeriesApi, Time } from 'lightweight-charts';
  import {
    createChartContainer,
    addLineSeries,
    invalidateCssVarCache,
  } from '$lib/features/chart/chart';
  import type { TimeValue } from '$lib/features/backtest/derive';

  interface LineSpec {
    data: TimeValue[];
    color: string;
    lineWidth?: number;
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
  let chart: IChartApi | null = null;
  let series: ISeriesApi<'Line'>[] = [];
  let resizeObserver: ResizeObserver | null = null;
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
      const s = addLineSeries(chart, spec.color);
      s.applyOptions({
        lineWidth: (spec.lineWidth ?? 2) as 1 | 2 | 3 | 4,
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
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(containerEl);
  });

  $effect(() => {
    rebuild(lines);
  });

  onDestroy(() => {
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

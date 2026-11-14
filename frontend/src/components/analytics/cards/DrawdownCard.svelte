<script lang="ts">
  import { onMount } from 'svelte';
  import {
    createChart,
    AreaSeries,
    ColorType,
    type IChartApi,
    type ISeriesApi,
    type UTCTimestamp,
  } from 'lightweight-charts';
  import type { MaxDrawdownResponse } from '$lib/features/analytics/analyticsApi';

  let { data }: { data: MaxDrawdownResponse } = $props();

  let host = $state<HTMLDivElement | null>(null);
  let chart: IChartApi | null = null;
  let series: ISeriesApi<'Area'> | null = null;

  function pct(v: number): string {
    return `${(v * 100).toFixed(2)}%`;
  }

  function toPoints(d: MaxDrawdownResponse) {
    return d.series.map(p => ({
      time: Math.floor(Date.parse(p.timestamp) / 1000) as UTCTimestamp,
      value: p.value,
    }));
  }

  onMount(() => {
    if (!host) return;
    chart = createChart(host, {
      width: host.clientWidth,
      height: host.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: 'rgba(255,255,255,0.5)',
        fontFamily: "'Geist Mono', ui-monospace, monospace",
        fontSize: 9,
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: false },
      handleScroll: false,
      handleScale: false,
    });
    series = chart.addSeries(AreaSeries, {
      lineColor: '#ff7373',
      topColor: 'rgba(255,115,115,0.05)',
      bottomColor: 'rgba(255,115,115,0.45)',
      lineWidth: 1,
      priceFormat: { type: 'percent' },
    });
    series.setData(toPoints(data));
    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (chart && host) chart.resize(host.clientWidth, host.clientHeight);
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      chart?.remove();
      chart = null;
      series = null;
    };
  });

  $effect(() => {
    if (series) series.setData(toPoints(data));
    chart?.timeScale().fitContent();
  });
</script>

<div class="dd">
  <div class="head">
    <span class="lbl">max drawdown</span>
    <span class="val">{pct(data.max_drawdown)}</span>
  </div>
  <div class="chart" bind:this={host}></div>
</div>

<style>
  .dd {
    display: flex;
    flex-direction: column;
    gap: 6px;
    height: 160px;
  }
  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
  }
  .lbl {
    font-size: 10px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: color-mix(in oklab, oklch(var(--foreground)) 50%, transparent);
  }
  .val {
    font-size: 16px;
    font-weight: 600;
    color: oklch(var(--down-color));
    font-variant-numeric: tabular-nums;
  }
  .chart {
    flex: 1 1 auto;
    min-height: 0;
  }
</style>

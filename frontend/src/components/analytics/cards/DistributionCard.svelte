<script lang="ts">
  import { onMount } from 'svelte';
  import {
    createChart,
    HistogramSeries,
    ColorType,
    type IChartApi,
    type ISeriesApi,
    type UTCTimestamp,
  } from 'lightweight-charts';
  import type { ReturnDistributionResponse } from '$lib/features/analytics/analyticsApi';

  let { data }: { data: ReturnDistributionResponse } = $props();

  let host = $state<HTMLDivElement | null>(null);
  let chart: IChartApi | null = null;
  let series: ISeriesApi<'Histogram'> | null = null;

  function toPoints(d: ReturnDistributionResponse) {
    // x-axis is bin index; tickMarkFormatter renders the bin midpoint as %.
    return d.bins.map((b, i) => ({
      time: i as UTCTimestamp,
      value: b.count,
      color: (b.left + b.right) / 2 < 0 ? '#ff7373' : '#7dd3fc',
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
      timeScale: {
        borderVisible: false,
        timeVisible: false,
        tickMarkFormatter: (idx: number) => {
          const bin = data.bins[Math.floor(idx)];
          if (!bin) return '';
          return `${(((bin.left + bin.right) / 2) * 100).toFixed(1)}%`;
        },
      },
      handleScroll: false,
      handleScale: false,
    });
    series = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
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

<div class="dist">
  <div class="head">
    <span class="lbl">log-return distribution</span>
    <span class="bins">{data.bins.length} bins</span>
  </div>
  <div class="chart" bind:this={host}></div>
</div>

<style>
  .dist {
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
    font-size: var(--font-size-annotation);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: oklch(var(--foreground-tertiary));
  }
  .bins {
    font-size: var(--font-size-annotation);
    color: oklch(var(--foreground-tertiary));
  }
  .chart {
    flex: 1 1 auto;
    min-height: 0;
  }
</style>

<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    createSeriesMarkers,
    type CandlestickData,
    type HistogramData,
    type IChartApi,
    type ISeriesApi,
    type ISeriesMarkersPluginApi,
    type SeriesMarker,
    type Time,
  } from 'lightweight-charts';
  import {
    createChartContainer,
    addCandlestickSeries,
    addInMarketSeries,
    getCssVarColor,
    invalidateCssVarCache,
  } from '$lib/features/chart/chart';
  import type { BacktestState } from '$lib/features/backtest/backtestState.svelte';
  import type { BacktestResult } from '$lib/features/backtest/types';

  let { backtest }: { backtest: BacktestState } = $props();

  const HOLDINGS_EPS = 1e-9;

  let containerEl = $state<HTMLDivElement | null>(null);
  let chart = $state.raw<IChartApi | null>(null);
  let candleSeries: ISeriesApi<'Candlestick'> | null = null;
  let inMarketSeries: ISeriesApi<'Histogram'> | null = null;
  let markers: ISeriesMarkersPluginApi<Time> | null = null;
  let resizeObserver: ResizeObserver | null = null;

  // Bar-close time (unix seconds) -> trade index, for both entry and exit bars.
  // Lets a crosshair landing on a marker's bar highlight the matching row.
  let timeToTrade = new Map<number, number>();

  function candleData(result: BacktestResult): CandlestickData[] {
    return result.bars.map(b => ({
      time: b.t as Time,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    }));
  }

  function inMarketData(
    result: BacktestResult,
    color: string,
  ): HistogramData[] {
    return result.equity
      .filter(p => Math.abs(p.holdings) > HOLDINGS_EPS)
      .map(p => ({ time: p.t as Time, value: 1, color }));
  }

  function buildMarkers(
    result: BacktestResult,
    hovered: number | null,
    selected: number | null,
  ): SeriesMarker<Time>[] {
    const up = getCssVarColor('--up-color', '#26a69a');
    const down = getCssVarColor('--down-color', '#ef5350');
    const out: SeriesMarker<Time>[] = [];
    result.trades.forEach((tr, i) => {
      const emp = i === hovered || i === selected;
      const entryBar = result.bars[tr.entry_index];
      const exitBar = result.bars[tr.exit_index];
      if (entryBar) {
        out.push({
          time: entryBar.t as Time,
          position: 'belowBar',
          shape: 'arrowUp',
          color: up,
          size: emp ? 2 : 1,
          text: emp ? `#${i + 1} in` : undefined,
        });
      }
      if (exitBar) {
        out.push({
          time: exitBar.t as Time,
          position: 'aboveBar',
          shape: 'arrowDown',
          color: down,
          size: emp ? 2 : 1,
          text: emp ? `#${i + 1} out` : undefined,
        });
      }
    });
    out.sort((a, b) => Number(a.time) - Number(b.time));
    return out;
  }

  function resize(): void {
    if (chart && containerEl) {
      chart.applyOptions({
        width: containerEl.clientWidth,
        height: containerEl.clientHeight,
      });
    }
  }

  onMount(() => {
    if (!containerEl) return;
    invalidateCssVarCache();
    chart = createChartContainer(containerEl);
    candleSeries = addCandlestickSeries(chart);
    inMarketSeries = addInMarketSeries(
      chart,
      'rgba(56, 142, 233, 0.16)',
    );

    chart.subscribeCrosshairMove(param => {
      const idx =
        param.time != null
          ? (timeToTrade.get(Number(param.time)) ?? null)
          : null;
      if (idx !== backtest.hoveredTrade) backtest.hoverTrade(idx);
    });
    chart.subscribeClick(param => {
      const index = param.time == null ? undefined : timeToTrade.get(Number(param.time));
      if (index !== undefined) backtest.selectTrade(index);
    });

    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(containerEl);
  });

  // Load price + in-market data and the time→trade index once a result lands.
  $effect(() => {
    const result = backtest.result;
    if (!result || !chart || !candleSeries || !inMarketSeries) return;
    candleSeries.setData(candleData(result));
    inMarketSeries.setData(inMarketData(result, 'rgba(56, 142, 233, 0.16)'));
    timeToTrade = new Map();
    result.trades.forEach((tr, i) => {
      const entryBar = result.bars[tr.entry_index];
      const exitBar = result.bars[tr.exit_index];
      if (entryBar) timeToTrade.set(entryBar.t, i);
      if (exitBar) timeToTrade.set(exitBar.t, i);
    });
    chart.timeScale().fitContent();
  });

  // Rebuild markers when the result loads or the hovered trade changes.
  $effect(() => {
    const result = backtest.result;
    const hovered = backtest.hoveredTrade;
    if (!result || !candleSeries) return;
    const data = buildMarkers(result, hovered, backtest.selection?.kind === 'trade' ? backtest.selection.index : null);
    if (markers) {
      markers.setMarkers(data);
    } else {
      markers = createSeriesMarkers(candleSeries, data);
    }
  });

  $effect(() => {
    const selection = backtest.selection;
    const result = backtest.result;
    if (!chart || !result) return;
    if (selection) chart.timeScale().setVisibleLogicalRange({ from: selection.from, to: selection.to });
    else chart.timeScale().fitContent();
  });

  onDestroy(() => {
    resizeObserver?.disconnect();
    resizeObserver = null;
    markers?.detach();
    markers = null;
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

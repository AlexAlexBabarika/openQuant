<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import {
    PriceScaleMode,
    LineSeries,
    CandlestickSeries,
  } from 'lightweight-charts';
  import type {
    IChartApi,
    ISeriesApi,
    LineWidth,
    MouseEventParams,
    Time,
  } from 'lightweight-charts';
  import {
    candleOHLCVtoAreaData,
    candleOHLCVtoCandlestickData,
    candleOHLCVtoVolumeData,
  } from '$lib/features/chart/chartAdapters';
  import { cssColourToHsva, hsvaToHex } from '$lib/features/chart/colourUtils';
  import { formatMarketPrice, marketPriceFormat } from '$lib/features/market/priceFormat';
  import type {
    Comparison,
  } from '$lib/features/chart/comparisonController.svelte';
  import type { ComparisonSeriesType } from '$lib/features/chart/comparisonsApi';
  import {
    CHART_TIME_SCALE_RIGHT_OFFSET,
    createChartContainer,
    addCandlestickSeries,
    addVolumeSeries,
    addAreaSeries,
    addLineSeries,
    syncChartTheme,
    resolveColour,
  } from '$lib/features/chart/chart';
  import type {
    OHLCVCandle,
    IndicatorPoint,
    BollingerBandsPoint,
  } from '$lib/core/types';
  import type {
    ChartColours,
    ChartType,
  } from '$lib/features/chart/chartColours';
  import { linePoint } from '$lib/features/chart/chart';
  import {
    toCrosshairMode,
    type CrosshairModeName,
  } from '$lib/features/chart/crosshair';
  import {
    buildCoordMap,
    chartTimeAtCoordinate,
    CURSOR,
    type ActiveTool,
    type CoordMap,
    type ChartPoint,
    type DrawableSurface,
  } from '$lib/features/drawables';
  import ChartViewport from './ChartViewport.svelte';
  import { coordinateInvalidator } from '$lib/features/drawables/coordMap';
  import ChartScriptOverlay from './ChartScriptOverlay.svelte';
  import ChartScriptMarkers from './ChartScriptMarkers.svelte';
  import type { RunningScript } from '$lib/features/indicators/indicatorState.svelte';

  export type ChartApi = { appendCandle: (c: OHLCVCandle) => void };

  let {
    candles = [] as OHLCVCandle[],
    candleRevision = undefined as number | undefined,
    annotationOwner = 'guest',
    symbol = '',
    chartType = 'candlestick' as ChartType,
    showArea = true,
    showVolume = true,
    smaPoints = [] as IndicatorPoint[],
    emaPoints = [] as IndicatorPoint[],
    bbandsPoints = [] as BollingerBandsPoint[],
    smaLineWidth = 2,
    emaLineWidth = 2,
    bbandsLineWidth = 1,
    colours = undefined as ChartColours | undefined,
    crosshairMode = 'magnet' as CrosshairModeName,
    provider = 'yfinance' as string,
    interval = '1d' as string,
    runningScripts = [] as RunningScript[],
    activeTool = $bindable<ActiveTool>(CURSOR),
    api = $bindable<ChartApi | null>(null),
    comparisons = [] as Comparison[],
    onRemoveComparison,
    onSetComparisonColor,
    onSetComparisonSeriesType,
  }: {
    candles: OHLCVCandle[];
    candleRevision?: number;
    annotationOwner?: string;
    symbol: string;
    chartType?: ChartType;
    showArea?: boolean;
    showVolume?: boolean;
    smaPoints?: IndicatorPoint[];
    emaPoints?: IndicatorPoint[];
    bbandsPoints?: BollingerBandsPoint[];
    smaLineWidth?: number;
    emaLineWidth?: number;
    bbandsLineWidth?: number;
    colours?: ChartColours;
    crosshairMode?: CrosshairModeName;
    provider: string;
    interval: string;
    runningScripts?: RunningScript[];
    activeTool: ActiveTool;
    api?: ChartApi | null;
    comparisons?: Comparison[];
    onRemoveComparison?: (id: string) => void;
    onSetComparisonColor?: (id: string, color: string) => void;
    onSetComparisonSeriesType?: (id: string, type: ComparisonSeriesType) => void;
  } = $props();

  let containerEl = $state<HTMLDivElement | null>(null);
  let chart: IChartApi | null = null;
  let candleSeries = $state.raw<ISeriesApi<'Candlestick'> | null>(null);
  let lineSeries = $state.raw<ISeriesApi<'Line'> | null>(null);
  let areaSeries: ISeriesApi<'Area'> | null = null;
  let volumeSeries: ISeriesApi<'Histogram'> | null = null;
  let smaSeries: ISeriesApi<'Line'> | null = null;
  let emaSeries: ISeriesApi<'Line'> | null = null;
  let bbandsUpperSeries: ISeriesApi<'Line'> | null = null;
  let bbandsMiddleSeries: ISeriesApi<'Line'> | null = null;
  let bbandsLowerSeries: ISeriesApi<'Line'> | null = null;
  let resizeObserver: ResizeObserver | null = null;

  type ComparisonSeriesEntry = {
    type: ComparisonSeriesType;
    color: string;
    series: ISeriesApi<'Line'> | ISeriesApi<'Candlestick'>;
  };
  const comparisonSeriesById = new Map<string, ComparisonSeriesEntry>();

  function darkenHex(hex: string): string {
    const hsva = cssColourToHsva(hex);
    return hsvaToHex({ ...hsva, v: Math.max(0, hsva.v * 0.7) });
  }

  function addComparisonSeries(
    c: Comparison,
  ): ComparisonSeriesEntry | null {
    if (!chart) return null;
    if (c.seriesType === 'line') {
      const series = chart.addSeries(LineSeries, {
        color: c.color,
        lastValueVisible: true,
        priceLineVisible: false,
      });
      return { type: 'line', color: c.color, series };
    }
    const down = darkenHex(c.color);
    const series = chart.addSeries(CandlestickSeries, {
      upColor: c.color,
      downColor: down,
      borderUpColor: c.color,
      borderDownColor: down,
      wickUpColor: c.color,
      wickDownColor: down,
    });
    return { type: 'candlestick', color: c.color, series };
  }

  function setComparisonSeriesData(
    entry: ComparisonSeriesEntry,
    candles: OHLCVCandle[],
  ): void {
    entry.series.applyOptions({ priceFormat: marketPriceFormat(candles[candles.length - 1]?.close ?? 0) });
    if (entry.type === 'line') {
      (entry.series as ISeriesApi<'Line'>).setData(
        candles.map(candleOHLCVtoAreaData),
      );
    } else {
      (entry.series as ISeriesApi<'Candlestick'>).setData(
        candles.map(candleOHLCVtoCandlestickData),
      );
    }
  }

  /**
   * Incremented when pan/zoom/resize (or container size) invalidates chart pixel
   * mapping. Fed into `buildCoordMap(..., version, candles)` → `coordMap.version`.
   * Depend on `coordMap` / `coordMap.version` in overlays for transforms; this
   * counter is the chart shell’s upstream invalidation signal only.
   */
  let coordVersion = $state(0);

  let coordMap = $state<CoordMap | null>(null);
  let priceInvalidator: ReturnType<typeof coordinateInvalidator> | null = null;

  let drawablePlacing = $state(false);

  function onDrawablePlacementActiveChange(active: boolean): void {
    drawablePlacing = active;
  }

  let chartDrawables = $state<DrawableSurface | undefined>(undefined);

  let legendName = $state('');
  let legendPrice = $state('');
  let legendDate = $state('');
  let legendVolume = $state('');
  let showLegend = $state(false);

  const dateFormatter = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  function formatDate(time: Time): string {
    let date: Date;
    if (typeof time === 'string') {
      date = new Date(time);
    } else if (typeof time === 'number') {
      date = new Date(time * 1000);
    } else {
      date = new Date(time.year, time.month - 1, time.day);
    }
    return dateFormatter.format(date);
  }

  function updateLegend(param: MouseEventParams | undefined): void {
    const priceSeries = candleSeries ?? lineSeries;
    if (!priceSeries) return;

    const validCrosshairPoint = !(
      param === undefined ||
      param.time === undefined ||
      param.point === undefined ||
      param.point.x < 0 ||
      param.point.y < 0
    );

    const bar = validCrosshairPoint
      ? param.seriesData.get(priceSeries)
      : priceSeries.dataByIndex(Number.MAX_SAFE_INTEGER, -1);

    const volumeBar = volumeSeries
      ? validCrosshairPoint
        ? param.seriesData.get(volumeSeries)
        : volumeSeries.dataByIndex(Number.MAX_SAFE_INTEGER, -1)
      : null;

    if (!bar) return;

    let price: number | undefined;
    if ('value' in bar && typeof bar.value === 'number') {
      price = bar.value;
    } else if ('close' in bar && typeof bar.close === 'number') {
      price = bar.close;
    }
    if (price === undefined) return;

    let volume: number | undefined;
    if (
      volumeBar &&
      'value' in volumeBar &&
      typeof volumeBar.value === 'number'
    ) {
      volume = volumeBar.value;
    }

    legendName = symbol || 'Unknown';
    legendPrice = formatMarketPrice(price);
    legendDate = formatDate(bar.time);
    legendVolume = volume !== undefined ? volume.toLocaleString() : '—';
    showLegend = true;
  }

  function initChart(): void {
    if (!containerEl) return;

    chart = createChartContainer(containerEl, colours);
    chart.subscribeCrosshairMove(updateLegend);
    updateLegend(undefined);
  }

  function applyVolume(enabled: boolean): void {
    if (!chart) return;

    if (enabled && !volumeSeries) {
      volumeSeries = addVolumeSeries(chart);
    } else if (!enabled && volumeSeries) {
      chart.removeSeries(volumeSeries);
      volumeSeries = null;
    }
  }

  function applyArea(enabled: boolean): void {
    if (!chart) return;

    if (enabled && !areaSeries) {
      areaSeries = addAreaSeries(chart, colours);
    } else if (!enabled && areaSeries) {
      chart.removeSeries(areaSeries);
      areaSeries = null;
    }
  }

  function applySeries(type: ChartType): void {
    if (!chart) return;

    const needCandle = type === 'candlestick';
    if (needCandle && candleSeries) return;
    if (!needCandle && lineSeries) return;

    if (candleSeries) {
      chart.removeSeries(candleSeries);
      candleSeries = null;
    }
    if (lineSeries) {
      chart.removeSeries(lineSeries);
      lineSeries = null;
    }

    if (needCandle) {
      candleSeries = addCandlestickSeries(chart, colours);
    } else {
      lineSeries = addLineSeries(chart, resolveColour(colours, 'lineColour'));
    }
  }

  function toVolume(c: OHLCVCandle) {
    return candleOHLCVtoVolumeData(c, colours?.volumeUp, colours?.volumeDown);
  }

  function appendCandle(c: OHLCVCandle): void {
    if (!chart) return;
    applyPriceFormat(c.close);

    if (candleSeries) {
      candleSeries.update(candleOHLCVtoCandlestickData(c));
    }
    if (lineSeries) {
      lineSeries.update(candleOHLCVtoAreaData(c));
    }
    if (areaSeries && candles.length >= 20) {
      if (candles.length === 20) {
        areaSeries.setData(candles.map(candleOHLCVtoAreaData));
      } else {
        areaSeries.update(candleOHLCVtoAreaData(c));
      }
    }
    if (volumeSeries) {
      volumeSeries.update(toVolume(c));
    }
    updateLegend(undefined);
    priceInvalidator?.settle();
  }

  function setSeriesData(data: OHLCVCandle[]): void {
    if (!chart) return;
    applyPriceFormat(data[data.length - 1]?.close ?? 0);

    if (areaSeries) {
      areaSeries.setData(
        data.length >= 20 ? data.map(candleOHLCVtoAreaData) : [],
      );
    }
    if (candleSeries) {
      candleSeries.setData(data.map(candleOHLCVtoCandlestickData));
    }
    if (lineSeries) {
      lineSeries.setData(data.map(candleOHLCVtoAreaData));
    }
    if (volumeSeries) {
      volumeSeries.setData(data.map(toVolume));
    }
    updateLegend(undefined);
    priceInvalidator?.settle();
  }

  function applyPriceFormat(reference: number): void {
    const priceFormat = marketPriceFormat(reference);
    for (const series of [candleSeries, lineSeries, areaSeries]) {
      if (!series) continue;
      const current = series.options().priceFormat;
      if (current.type !== 'custom' || current.minMove !== priceFormat.minMove) {
        series.applyOptions({ priceFormat });
      }
    }
  }

  function handleResize(): void {
    if (chart && containerEl) {
      chart.applyOptions({
        width: containerEl.clientWidth,
        height: containerEl.clientHeight,
      });
      coordVersion += 1;
      priceInvalidator?.settle();
    }
  }

  function priceSeries(): ISeriesApi<'Candlestick' | 'Line'> | null {
    return candleSeries ?? lineSeries;
  }

  function pointerToChart(
    clientX: number,
    clientY: number,
  ): { time: number; price: number } | null {
    if (!chart) return null;
    const series = priceSeries();
    if (!series) return null;
    const rect = chart.chartElement().getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const time = chartTimeAtCoordinate(chart, x, candles);
    const coordPrice = series.coordinateToPrice(y);
    let price: number | null =
      coordPrice == null ? null : Number(coordPrice);
    if (price == null && candles.length > 0) {
      price = candles[candles.length - 1].close;
    }
    if (time == null || price == null) return null;
    return { time, price };
  }

  function toChartPoint(e: PointerEvent): ChartPoint | null {
    const pt = pointerToChart(e.clientX, e.clientY);
    return pt ? { time: pt.time, price: pt.price } : null;
  }

  function onChartPointerDown(e: PointerEvent) {
    chartDrawables?.handlePointerDown(e);
  }

  function onChartPointerMove(e: PointerEvent) {
    chartDrawables?.handlePointerMove(e);
  }

  function onChartPointerUp(e: PointerEvent) {
    chartDrawables?.handlePointerUp(e);
  }

  function onChartKeyDown(e: KeyboardEvent) {
    chartDrawables?.handleKeyDown(e);
  }

  $effect(() => {
    const version = coordVersion;
    const data = candles;
    if (!chart) {
      coordMap = null;
      return;
    }
    const series = priceSeries();
    if (!series) {
      coordMap = null;
      return;
    }
    coordMap = buildCoordMap(chart, series, version, data);
  });

  $effect(() => {
    const placing = drawablePlacing;
    if (!chart) return;
    untrack(() => {
      chart?.applyOptions({
        handleScroll: !placing,
        handleScale: !placing,
      });
    });
  });

  onMount(() => {
    initChart();
    priceInvalidator = coordinateInvalidator(() => { coordVersion += 1; });
    const element = containerEl;
    const startScale = (e: PointerEvent) => {
      if (!chart || !element) return;
      const rect = element.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const left = chart.priceScale('left').width();
      if (y >= 0 && y <= chart.paneSize().height && (x < left || x >= left + chart.paneSize().width)) {
        priceInvalidator?.start();
      }
    };
    const stopScale = () => priceInvalidator?.stop();
    const resetScale = () => priceInvalidator?.settle();
    element?.addEventListener('pointerdown', startScale, true);
    element?.addEventListener('dblclick', resetScale, true);
    window.addEventListener('pointerup', stopScale);
    window.addEventListener('pointercancel', stopScale);
    window.addEventListener('blur', stopScale);
    api = { appendCandle };
    window.addEventListener('resize', handleResize);

    if (containerEl) {
      resizeObserver = new ResizeObserver(handleResize);
      resizeObserver.observe(containerEl);
    }

    let lastFrom: number | null = null;
    let lastTo: number | null = null;
    chart?.timeScale().subscribeVisibleLogicalRangeChange(range => {
      const from = range?.from ?? null;
      const to = range?.to ?? null;
      if (from === lastFrom && to === lastTo) return;
      lastFrom = from;
      lastTo = to;
      coordVersion += 1;
    });
    coordVersion += 1;
    return () => {
      element?.removeEventListener('pointerdown', startScale, true);
      element?.removeEventListener('dblclick', resetScale, true);
      window.removeEventListener('pointerup', stopScale);
      window.removeEventListener('pointercancel', stopScale);
      window.removeEventListener('blur', stopScale);
      priceInvalidator?.destroy();
      priceInvalidator = null;
    };
  });

  onDestroy(() => {
    api = null;
    window.removeEventListener('resize', handleResize);
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    if (chart) {
      chart.remove();
      chart = null;
    }
    comparisonSeriesById.clear();
  });

  let prevCandles: OHLCVCandle[] | undefined;

  $effect(() => {
    if (!chart) return;
    const type = chartType;
    const area = showArea;
    const volume = showVolume;
    const data = candles;
    untrack(() => {
      if (!chart) return;
      applySeries(type);
      applyArea(area);
      applyVolume(volume);
      setSeriesData(data);
      coordVersion += 1;
      if (data !== prevCandles) {
        chart.timeScale().fitContent();
        chart.applyOptions({
          timeScale: { rightOffset: CHART_TIME_SCALE_RIGHT_OFFSET },
        });
        prevCandles = data;
      }
    });
  });

  $effect(() => {
    if (!chart) return;
    const points = smaPoints;
    const width = smaLineWidth;
    untrack(() => {
      if (!chart) return;
      if (points.length > 0) {
        if (!smaSeries) {
          smaSeries = addLineSeries(chart, resolveColour(colours, 'smaLine'));
        }
        smaSeries.applyOptions({ lineWidth: width as LineWidth });
        smaSeries.setData(points.map(p => linePoint(p.timestamp, p.value)));
      } else if (smaSeries) {
        chart.removeSeries(smaSeries);
        smaSeries = null;
      }
    });
  });

  $effect(() => {
    if (!chart) return;
    const points = emaPoints;
    const width = emaLineWidth;
    untrack(() => {
      if (!chart) return;
      if (points.length > 0) {
        if (!emaSeries) {
          emaSeries = addLineSeries(chart, resolveColour(colours, 'emaLine'));
        }
        emaSeries.applyOptions({ lineWidth: width as LineWidth });
        emaSeries.setData(points.map(p => linePoint(p.timestamp, p.value)));
      } else if (emaSeries) {
        chart.removeSeries(emaSeries);
        emaSeries = null;
      }
    });
  });

  $effect(() => {
    if (!chart) return;
    const points = bbandsPoints;
    const width = bbandsLineWidth;
    untrack(() => {
      if (!chart) return;
      if (points.length > 0) {
        if (!bbandsUpperSeries) {
          bbandsUpperSeries = addLineSeries(
            chart,
            resolveColour(colours, 'bbandsUpper'),
          );
        }
        if (!bbandsMiddleSeries) {
          bbandsMiddleSeries = addLineSeries(
            chart,
            resolveColour(colours, 'bbandsMiddle'),
          );
        }
        if (!bbandsLowerSeries) {
          bbandsLowerSeries = addLineSeries(
            chart,
            resolveColour(colours, 'bbandsLower'),
          );
        }
        bbandsUpperSeries.applyOptions({ lineWidth: width as LineWidth });
        bbandsMiddleSeries.applyOptions({
          lineWidth: width as LineWidth,
          lineStyle: 2,
        });
        bbandsLowerSeries.applyOptions({ lineWidth: width as LineWidth });
        bbandsUpperSeries.setData(
          points.map(p => linePoint(p.timestamp, p.upper)),
        );
        bbandsMiddleSeries.setData(
          points.map(p => linePoint(p.timestamp, p.middle)),
        );
        bbandsLowerSeries.setData(
          points.map(p => linePoint(p.timestamp, p.lower)),
        );
      } else {
        if (bbandsUpperSeries) {
          chart.removeSeries(bbandsUpperSeries);
          bbandsUpperSeries = null;
        }
        if (bbandsMiddleSeries) {
          chart.removeSeries(bbandsMiddleSeries);
          bbandsMiddleSeries = null;
        }
        if (bbandsLowerSeries) {
          chart.removeSeries(bbandsLowerSeries);
          bbandsLowerSeries = null;
        }
      }
    });
  });

  $effect(() => {
    if (!chart) return;
    const mode = crosshairMode;
    untrack(() => {
      chart?.applyOptions({ crosshair: { mode: toCrosshairMode(mode) } });
    });
  });

  $effect(() => {
    if (!chart || !colours) return;
    syncChartTheme({
      chart,
      candleSeries,
      areaSeries,
      lineSeries,
      smaSeries,
      emaSeries,
      bbandsUpperSeries,
      bbandsMiddleSeries,
      bbandsLowerSeries,
      colours,
    });
  });

  // Reconcile comparison series + toggle percentage mode on right price scale.
  $effect(() => {
    const list = comparisons;
    if (!chart) return;
    untrack(() => {
      if (!chart) return;
      const seenIds = new Set<string>();
      for (const c of list) {
        seenIds.add(c.id);
        let entry = comparisonSeriesById.get(c.id);
        // Recreate series when type has changed.
        if (entry && entry.type !== c.seriesType) {
          chart.removeSeries(entry.series);
          comparisonSeriesById.delete(c.id);
          entry = undefined;
        }
        if (!entry) {
          const created = addComparisonSeries(c);
          if (!created) continue;
          comparisonSeriesById.set(c.id, created);
          entry = created;
        }
        if (entry.color !== c.color) {
          if (entry.type === 'line') {
            (entry.series as ISeriesApi<'Line'>).applyOptions({
              color: c.color,
            });
          } else {
            const down = darkenHex(c.color);
            (entry.series as ISeriesApi<'Candlestick'>).applyOptions({
              upColor: c.color,
              downColor: down,
              borderUpColor: c.color,
              borderDownColor: down,
              wickUpColor: c.color,
              wickDownColor: down,
            });
          }
          entry.color = c.color;
        }
        setComparisonSeriesData(entry, c.candles);
      }
      // Remove series for comparisons no longer present.
      for (const [id, entry] of comparisonSeriesById) {
        if (!seenIds.has(id)) {
          chart.removeSeries(entry.series);
          comparisonSeriesById.delete(id);
        }
      }
      const mode = list.length > 0
        ? PriceScaleMode.Percentage
        : PriceScaleMode.Normal;
      chart.priceScale('right').applyOptions({ mode });
      coordVersion += 1;
      priceInvalidator?.settle();
    });
  });

  $effect(() => {
    if (!chart || !colours || !volumeSeries) return;
    colours.volumeUp;
    colours.volumeDown;
    untrack(() => {
      if (volumeSeries && candles.length > 0) {
        volumeSeries.setData(candles.map(toVolume));
      }
    });
  });
</script>

<ChartViewport
  bind:containerEl
  bind:chartDrawables
  bind:activeTool
  {coordMap}
  {symbol}
  {candles}
  {candleRevision}
  {annotationOwner}
  {provider}
  {interval}
  seriesIdentity={chartType}
  {toChartPoint}
  onPlacementActiveChange={onDrawablePlacementActiveChange}
  {onChartPointerDown}
  {onChartPointerMove}
  {onChartPointerUp}
  {onChartKeyDown}
  {showLegend}
  legendTitle={legendName}
  {legendPrice}
  {legendDate}
  {legendVolume}
  legendTextColour={colours?.textColour}
  {comparisons}
  {onRemoveComparison}
  {onSetComparisonColor}
  {onSetComparisonSeriesType}
/>

{#each runningScripts as rs (rs.scriptId)}
  <ChartScriptOverlay
    chartFn={() => chart}
    scriptId={rs.scriptId}
    outputs={rs.outputs}
  />
{/each}
<ChartScriptMarkers
  priceSeriesFn={() => priceSeries()}
  {runningScripts}
/>

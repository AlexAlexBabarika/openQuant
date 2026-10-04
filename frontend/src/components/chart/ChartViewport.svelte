<script lang="ts">
  import type { OHLCVCandle } from '$lib/core/types';
  import {
    CURSOR,
    type ActiveTool,
    type CoordMap,
    type ChartPoint,
    type DrawableSurface,
  } from '$lib/features/drawables';
  import ChartDrawables from './ChartDrawables.svelte';
  import ChartLegend from './ChartLegend.svelte';
  import ChartComparisonLegend from './ChartComparisonLegend.svelte';
  import type { Comparison } from '$lib/features/chart/comparisonController.svelte';
  import type { ComparisonSeriesType } from '$lib/features/chart/comparisonsApi';

  let {
    containerEl = $bindable<HTMLDivElement | null>(null),
    chartDrawables = $bindable<DrawableSurface | undefined>(undefined),
    activeTool = $bindable(CURSOR as ActiveTool),
    coordMap = null as CoordMap | null,
    symbol = '',
    candles = [] as OHLCVCandle[],
    candleRevision = undefined as number | undefined,
    annotationOwner = 'guest',
    provider = 'yfinance',
    interval = '1d',
    seriesIdentity = '',
    toChartPoint,
    onPlacementActiveChange,
    onChartPointerDown,
    onChartPointerMove,
    onChartPointerUp,
    onChartKeyDown,
    showLegend = false,
    legendTitle = '',
    legendPrice = '',
    legendDate = '',
    legendVolume = '',
    legendTextColour = undefined as string | undefined,
    comparisons = [] as Comparison[],
    onRemoveComparison,
    onSetComparisonColor,
    onSetComparisonSeriesType,
  }: {
    containerEl?: HTMLDivElement | null;
    chartDrawables?: DrawableSurface | undefined;
    activeTool?: ActiveTool;
    coordMap: CoordMap | null;
    symbol: string;
    candles: OHLCVCandle[];
    candleRevision?: number;
    annotationOwner?: string;
    provider: string;
    interval: string;
    seriesIdentity?: string;
    toChartPoint: (e: PointerEvent) => ChartPoint | null;
    onPlacementActiveChange?: (active: boolean) => void;
    onChartPointerDown: (e: PointerEvent) => void;
    onChartPointerMove: (e: PointerEvent) => void;
    onChartPointerUp: (e: PointerEvent) => void;
    onChartKeyDown: (e: KeyboardEvent) => void;
    showLegend?: boolean;
    legendTitle?: string;
    legendPrice?: string;
    legendDate?: string;
    legendVolume?: string;
    legendTextColour?: string;
    comparisons?: Comparison[];
    onRemoveComparison?: (id: string) => void;
    onSetComparisonColor?: (id: string, color: string) => void;
    onSetComparisonSeriesType?: (id: string, type: ComparisonSeriesType) => void;
  } = $props();
</script>

<!-- Hit target for chart + drawables: lightweight-charts canvas is not focusable; we need tabindex and keyboard handlers here. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="flex-1 min-h-0 relative w-full z-0 overflow-hidden"
  class:cursor-crosshair={activeTool !== CURSOR}
  bind:this={containerEl}
  role="region"
  aria-label="Chart"
  tabindex="0"
  onpointerdown={onChartPointerDown}
  onpointermove={onChartPointerMove}
  onpointerup={onChartPointerUp}
  onpointercancel={onChartPointerUp}
  onlostpointercapture={onChartPointerUp}
  onkeydown={onChartKeyDown}
>
  <ChartLegend
    show={showLegend}
    title={legendTitle}
    price={legendPrice}
    date={legendDate}
    volume={legendVolume}
    textColour={legendTextColour}
  />

  <ChartComparisonLegend
    {comparisons}
    textColour={legendTextColour}
    onRemove={id => onRemoveComparison?.(id)}
    onSetColor={(id, c) => onSetComparisonColor?.(id, c)}
    onSetSeriesType={(id, t) => onSetComparisonSeriesType?.(id, t)}
  />

  {#key annotationOwner}
    <ChartDrawables
      bind:this={chartDrawables}
      {activeTool}
      onActiveToolChange={t => (activeTool = t)}
      {coordMap}
      {symbol}
      {candles}
      {candleRevision}
      {provider}
      {interval}
      {seriesIdentity}
      {toChartPoint}
      containerEl={containerEl}
      {onPlacementActiveChange}
    />
  {/key}
</div>

<style>
  /* lightweight-charts injects canvas elements that need full sizing */
  div :global(canvas) {
    width: 100% !important;
    height: 100% !important;
  }
</style>

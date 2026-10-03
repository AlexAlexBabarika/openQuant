<script lang="ts">
  import {
    getTool,
    previewPlacementRendererProps,
    type ChartPoint,
    type CoordMap,
    type Drawable,
    type PlacementMachine,
    type ScreenPoint,
    type DrawableComputeState,
  } from '$lib/features/drawables';
  import type { BundledDrawable } from '$lib/features/drawables/bundledDrawable';

  let {
    coordMap,
    items,
    computedData,
    computedStates,
    creating = false,
    selectedId,
    placement,
    toChartPoint,
    onPatchGeometry,
    onSelectDrawable,
    onAnchorPoint,
  }: {
    coordMap: CoordMap;
    items: readonly BundledDrawable[];
    computedData: Map<string, unknown>;
    computedStates: Map<string, DrawableComputeState>;
    creating?: boolean;
    selectedId: string | null;
    placement: {
      type: string;
      machine: PlacementMachine<unknown>;
      preview: Drawable | null;
    } | null;
    toChartPoint: (e: PointerEvent) => ChartPoint | null;
    onPatchGeometry: (id: string, geometry: unknown) => void;
    onSelectDrawable: (id: string) => void;
    onAnchorPoint: (id: string, pt: ScreenPoint | null) => void;
  } = $props();
</script>

<svg
  class:creating
  class="absolute inset-0 w-full h-full z-10 pointer-events-none"
  style="overflow: visible;"
>
  {#each items as d (d.id)}
    {@const tool = getTool(d.type)}
    {#if tool}
      {@const RendererCmp = tool.Renderer}
      <RendererCmp
        drawable={d}
        data={computedData.get(d.id)}
        computeState={computedStates.get(d.id)}
        selected={selectedId === d.id}
        {coordMap}
        {toChartPoint}
        onGeometryChange={geo => onPatchGeometry(d.id, geo)}
        onRequestSelect={() => onSelectDrawable(d.id)}
        onAnchorPoint={pt => onAnchorPoint(d.id, pt)}
      />
    {/if}
  {/each}

  {#if placement?.preview}
    {@const previewTool = getTool(placement.type)}
    {#if previewTool}
      {@const PreviewCmp = previewTool.Renderer}
      <PreviewCmp
        {...previewPlacementRendererProps({
          drawable: placement.preview,
          data: undefined,
          coordMap,
          toChartPoint,
        })}
      />
    {/if}
  {/if}
</svg>

<style>
  .creating :global(*) {
    pointer-events: none !important;
  }
</style>

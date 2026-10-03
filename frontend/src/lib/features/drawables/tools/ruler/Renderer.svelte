<!-- frontend/src/lib/drawables/tools/ruler/Renderer.svelte -->
<script lang="ts">
  import type {
    ScreenPoint,
    RendererProps,
  } from '../../types';
  import type { RulerGeo, RulerParams, RulerStyle } from './tool';
  import type { RulerStats } from './compute';
  import {
    formatPct,
    formatPriceDelta,
    formatVolume,
  } from './compute';
  import DrawableSvgHitRect from '../../ui/DrawableSvgHitRect.svelte';

  let {
    drawable,
    data,
    computeState,
    selected,
    coordMap,
    onRequestSelect,
    onAnchorPoint,
  }: RendererProps<RulerGeo, RulerParams, RulerStyle, RulerStats> = $props();

  let box = $derived.by(() => {
    coordMap.version; // re-run on coord invalidation
    const g = drawable.geometry;
    const x1 = coordMap.timeToX(g.startTime);
    const x2 = coordMap.timeToX(g.endTime);
    const y1 = coordMap.priceToY(g.startPrice);
    const y2 = coordMap.priceToY(g.endPrice);
    if (x1 == null || x2 == null || y1 == null || y2 == null) return null;
    return {
      left: Math.min(x1, x2),
      top: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
      x1,
      y1,
      x2,
      y2,
    };
  });

  let stats = $derived(computeState && computeState.status !== 'success' ? null : data ?? null);

  /** Same hue as the box fill; stronger than `fill-opacity` on the rect (see below). */
  const accentOpacity = 0.88;

  let up = $derived(
    stats ? stats.isUp : drawable.geometry.endPrice >= drawable.geometry.startPrice,
  );

  $effect(() => {
    if (!box || box.left + box.width < 0 || box.left > coordMap.plotWidth || box.top + box.height < 0 || box.top > coordMap.plotHeight) {
      onAnchorPoint(null);
      return;
    }
    const pt: ScreenPoint = { x: box.left + box.width, y: box.top };
    onAnchorPoint(pt);
  });

  function onHitPointerDown(e: PointerEvent) {
    e.stopPropagation();
    onRequestSelect();
  }
</script>

{#if box}
  {@const fill = up ? drawable.style.upColor : drawable.style.downColor}
  {@const stroke = fill}
  {@const cx = box.left + box.width / 2}
  {@const cy = box.top + box.height / 2}
  {@const timeArrowRight = box.x2 >= box.x1}
  {@const ah = Math.max(
    1,
    Math.min(
      8,
      Math.max(2, Math.min(box.width, box.height) * 0.22),
      box.width / 2,
      box.height / 2,
    ),
  )}
  {@const aw = ah * 0.65}
  <g>
    <rect
      x={box.left}
      y={box.top}
      width={box.width}
      height={box.height}
      fill={fill}
      fill-opacity="0.18"
      stroke={stroke}
      stroke-width={selected ? 2 : 1}
    />
    <!-- Vertical axis: arrow toward higher price (up) or lower price (down) -->
    {#if up}
      <line
        x1={cx}
        y1={box.top + box.height}
        x2={cx}
        y2={box.top + ah}
        stroke={stroke}
        stroke-opacity={accentOpacity}
        stroke-width="1.5"
      />
      <polygon
        points="{cx},{box.top} {cx - aw},{box.top + ah} {cx + aw},{box.top + ah}"
        fill={fill}
        fill-opacity={accentOpacity}
      />
    {:else}
      <line
        x1={cx}
        y1={box.top}
        x2={cx}
        y2={box.top + box.height - ah}
        stroke={stroke}
        stroke-opacity={accentOpacity}
        stroke-width="1.5"
      />
      <polygon
        points="{cx},{box.top + box.height} {cx - aw},{box.top + box.height - ah} {cx + aw},{box.top + box.height - ah}"
        fill={fill}
        fill-opacity={accentOpacity}
      />
    {/if}
    <!-- Horizontal axis: arrow in the direction of time (start → end) -->
    {#if timeArrowRight}
      <line
        x1={box.left}
        y1={cy}
        x2={box.left + box.width - ah}
        y2={cy}
        stroke={stroke}
        stroke-opacity={accentOpacity}
        stroke-width="1.5"
      />
      <polygon
        points="{box.left + box.width},{cy} {box.left + box.width - ah},{cy - aw} {box.left + box.width - ah},{cy + aw}"
        fill={fill}
        fill-opacity={accentOpacity}
      />
    {:else}
      <line
        x1={box.left + ah}
        y1={cy}
        x2={box.left + box.width}
        y2={cy}
        stroke={stroke}
        stroke-opacity={accentOpacity}
        stroke-width="1.5"
      />
      <polygon
        points="{box.left},{cy} {box.left + ah},{cy - aw} {box.left + ah},{cy + aw}"
        fill={fill}
        fill-opacity={accentOpacity}
      />
    {/if}
    <DrawableSvgHitRect
      x={box.left - 4}
      y={box.top - 4}
      width={box.width + 8}
      height={box.height + 8}
      drawableId={drawable.id}
      ariaLabel="Ruler drawable"
      onPointerDown={onHitPointerDown}
      mode="stroke"
    />

    {#if stats && drawable.style.showStats}
      <foreignObject
        x={box.x2 - 60}
        y={up ? box.y1 + 8 : box.y1 - 56}
        width="120"
        height="48"
        pointer-events="none"
      >
        <div
          class="rounded-md px-2 py-1 text-[10px] font-mono text-white shadow-lg whitespace-nowrap text-center leading-tight"
          style:background-color={fill}
        >
          <div>
            {formatPriceDelta(stats.priceDelta)} ({formatPct(stats.pctDelta)})
          </div>
          <div style:opacity="0.9">
            {stats.barCount} bars{stats.spanLabel ? `, ${stats.spanLabel}` : ''}
          </div>
          <div style:opacity="0.9">Vol {formatVolume(stats.volumeSum)}</div>
        </div>
      </foreignObject>
    {/if}
  </g>
{/if}

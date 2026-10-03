<script lang="ts">
  import type { RendererProps, ScreenPoint } from '../../../types';
  import type { AvpGeo, AvpParams, AvpStyle } from './compute';
  import type {
    VolumeProfileBin,
    VolumeProfileResponse,
  } from '../shared/types';
  import DrawableSvgHitRect from '../../../ui/DrawableSvgHitRect.svelte';
  import { measureDrawablesSync } from '$lib/core/dev/drawablesProfile';

  let {
    drawable,
    data,
    computeState,
    selected,
    coordMap,
    onRequestSelect,
    onAnchorPoint,
  }: RendererProps<AvpGeo, AvpParams, AvpStyle, VolumeProfileResponse> =
    $props();

  let anchorX = $derived.by(() => {
    coordMap.version;
    return coordMap.timeToX(drawable.geometry.time);
  });

  const MAX_WIDTH_PX = 320;
  let currentData = $derived(
    computeState && computeState.status !== 'success' ? undefined : data,
  );

  let boxWidth = $derived.by(() => {
    if (anchorX == null) return 0;
    const pct = Math.min(100, Math.max(0, drawable.style.widthPct)) / 100;
    return Math.round(MAX_WIDTH_PX * pct);
  });

  let boxLeft = $derived.by(() => {
    coordMap.version;
    if (drawable.style.placement === 'right') {
      const pw = coordMap.plotWidth;
      return pw > boxWidth ? pw - boxWidth : 0;
    }
    return 0;
  });

  let plotHeight = $derived(coordMap.plotHeight);

  let maxBinVol = $derived.by(() => {
    if (!currentData?.bins.length) return 0;
    let m = 0;
    for (const b of currentData.bins) {
      const v = b.upVol + b.downVol;
      if (v > m) m = v;
    }
    return m;
  });

  let statusLabel = $derived(
    computeState?.status === 'error'
      ? 'AVP unavailable'
      : !currentData
        ? 'Computing AVP…'
        : maxBinVol <= 0
          ? 'No volume · AVP'
          : 'AVP · OHLCV estimate',
  );

  let profileDetails = $derived.by(() => {
    const method =
      'OHLCV estimate: volume spread uniformly over candle low–high, weighted by row overlap. ' +
      'Up/down uses close ≥ open / close < open, not order-flow delta. ' +
      'POC is the lowest tied row’s lower edge; VAH/VAL bracket included rows.';
    if (!currentData) return `${method} ${statusLabel}.`;
    const d = currentData;
    return [
      method,
      `Source: ${d.provider}:${d.symbol}, ${d.interval ?? 'interval unknown'}.`,
      `Anchor (inclusive): ${new Date(d.startTs * 1000).toISOString()}.`,
      `First included candle: ${new Date(d.firstCandleTs * 1000).toISOString()}.`,
      `Latest included candle: ${new Date(d.latestCandleTs * 1000).toISOString()}.`,
      d.endTs == null
        ? 'Window extends to latest cached candle; not a tick/live order-flow profile.'
        : `End (inclusive): ${new Date(d.endTs * 1000).toISOString()}.`,
      maxBinVol <= 0 ? 'No positive volume; POC/VA levels are unsupported.' : '',
    ].join(' ');
  });

  /** Precomputed rows so bin geometry is measurable (`drawables:avp-bin-layout`) and matches the prior `{#each}` math. */
  let binLayoutRows = $derived.by(() => {
    coordMap.version;
    if (
      !currentData?.bins.length ||
      !drawable.style.showProfile ||
      maxBinVol <= 0
    ) {
      return [] as Array<{
        bin: VolumeProfileBin;
        top: number;
        h: number;
        upW: number;
        downW: number;
        fullW: number;
      }>;
    }
    const d = currentData;
    const rowSize = d.rowSize;
    return measureDrawablesSync('drawables:avp-bin-layout', () => {
      const rows: Array<{
        bin: VolumeProfileBin;
        top: number;
        h: number;
        upW: number;
        downW: number;
        fullW: number;
      }> = [];
      for (const bin of d.bins) {
        const y = coordMap.priceToY(bin.price);
        const yNext = coordMap.priceToY(bin.price + rowSize);
        if (y == null || yNext == null) continue;
        const h = Math.max(1, Math.abs(y - yNext));
        const top = Math.min(y, yNext);
        const total = bin.upVol + bin.downVol;
        const fullW = (total / maxBinVol) * boxWidth;
        const upW = total > 0 ? fullW * (bin.upVol / total) : 0;
        const downW = fullW - upW;
        rows.push({ bin, top, h, upW, downW, fullW });
      }
      return rows;
    });
  });

  $effect(() => {
    if (anchorX == null) {
      onAnchorPoint(null);
      return;
    }
    const poc = maxBinVol > 0 ? currentData?.poc : null;
    const anchorY = poc != null ? (coordMap.priceToY(poc) ?? 0) : 0;
    onAnchorPoint({ x: anchorX, y: anchorY } satisfies ScreenPoint);
  });

  function onHitPointerDown(e: PointerEvent) {
    e.stopPropagation();
    onRequestSelect();
  }
</script>

{#if anchorX != null}
  {@const placement = drawable.style.placement}
  <g>
    <line
      x1={anchorX}
      y1={0}
      x2={anchorX}
      y2={plotHeight}
      stroke={drawable.style.upColor}
      stroke-width={selected ? 2 : 1}
      stroke-dasharray="2 4"
      opacity="0.8"
    />

    {#if drawable.style.showProfile && currentData && maxBinVol > 0}
      {#each binLayoutRows as row (row.bin.price)}
        {#if placement === 'right'}
          <rect
            x={boxLeft + boxWidth - row.upW}
            y={row.top}
            width={row.upW}
            height={row.h}
            fill={drawable.style.upColor}
            fill-opacity="0.6"
          />
          <rect
            x={boxLeft + boxWidth - row.fullW}
            y={row.top}
            width={row.downW}
            height={row.h}
            fill={drawable.style.downColor}
            fill-opacity="0.6"
          />
        {:else}
          <rect
            x={boxLeft}
            y={row.top}
            width={row.upW}
            height={row.h}
            fill={drawable.style.upColor}
            fill-opacity="0.6"
          />
          <rect
            x={boxLeft + row.upW}
            y={row.top}
            width={row.downW}
            height={row.h}
            fill={drawable.style.downColor}
            fill-opacity="0.6"
          />
        {/if}
      {/each}
    {/if}

    {#if currentData && maxBinVol > 0}
      {@const pocY = currentData.poc != null ? coordMap.priceToY(currentData.poc) : null}
      {@const vahY = currentData.vah != null ? coordMap.priceToY(currentData.vah) : null}
      {@const valY = currentData.val != null ? coordMap.priceToY(currentData.val) : null}
      {#if drawable.style.showPOC && pocY != null}
        <line
          x1={boxLeft}
          y1={pocY}
          x2={boxLeft + boxWidth}
          y2={pocY}
          stroke={drawable.style.pocColor}
          stroke-width="1.5"
        />
      {/if}
      {#if drawable.style.showVAH && vahY != null}
        <line
          x1={boxLeft}
          y1={vahY}
          x2={boxLeft + boxWidth}
          y2={vahY}
          stroke={drawable.style.vahColor}
          stroke-width="1"
          stroke-dasharray="4 3"
        />
      {/if}
      {#if drawable.style.showVAL && valY != null}
        <line
          x1={boxLeft}
          y1={valY}
          x2={boxLeft + boxWidth}
          y2={valY}
          stroke={drawable.style.valColor}
          stroke-width="1"
          stroke-dasharray="4 3"
        />
      {/if}
    {/if}

    <text
      x={placement === 'right' ? coordMap.plotWidth - 4 : 4}
      y={plotHeight - 22}
      text-anchor={placement === 'right' ? 'end' : 'start'}
      fill="oklch(var(--foreground))"
      font-size="11"
      font-family="Lato, sans-serif"
      pointer-events="auto"
      role="button"
      tabindex="-1"
      data-drawable-id={drawable.id}
      onpointerdown={onHitPointerDown}
      style:cursor="pointer"
    >
      <title>{profileDetails}</title>
      {statusLabel}
    </text>
    {#if currentData}
      <text
        x={placement === 'right' ? coordMap.plotWidth - 4 : 4}
        y={plotHeight - 8}
        text-anchor={placement === 'right' ? 'end' : 'start'}
        fill="oklch(var(--muted-foreground))"
        font-size="10"
        font-family="Space Mono, monospace"
        pointer-events="auto"
        role="button"
        tabindex="-1"
        data-drawable-id={drawable.id}
        onpointerdown={onHitPointerDown}
        style:cursor="pointer"
      >
        <title>{profileDetails}</title>
        {currentData.provider} · {currentData.interval ?? 'interval unknown'}
      </text>
    {/if}

    <DrawableSvgHitRect
      x={anchorX - 5}
      y={0}
      width={10}
      height={plotHeight}
      drawableId={drawable.id}
      ariaLabel="Anchored Volume Profile"
      onPointerDown={onHitPointerDown}
    />
  </g>
{/if}

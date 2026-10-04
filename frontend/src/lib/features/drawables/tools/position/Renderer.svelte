<script lang="ts">
  import type { RendererProps } from '../../types';
  import type { PositionGeo, PositionParams, PositionStyle } from './compute';
  import type { PositionMetricsResponse } from './types';
  import DrawableSvgHitRect from '../../ui/DrawableSvgHitRect.svelte';
  import { POSITION_LONG_TYPE } from './constants';
  import { contrastTextColour } from '$lib/features/chart/colourUtils';

  const HANDLE = 9;
  const MIN_TIME_SPAN = 1;
  const CHIP_H_TARGET_STOP = 36;
  const CHIP_H_RR = 40;
  /** Space between shaded band edge and Target/Stop chips (SVG y grows downward). */
  const LABEL_GAP = 6;

  let {
    drawable,
    data,
    computeState,
    selected,
    coordMap,
    onGeometryChange,
    onRequestSelect,
    onAnchorPoint,
    toChartPoint,
  }: RendererProps<
    PositionGeo,
    PositionParams,
    PositionStyle,
    PositionMetricsResponse
  > = $props();

  let isLong = $derived(drawable.type === POSITION_LONG_TYPE);

  let layout = $derived.by(() => {
    coordMap.version;
    const g = drawable.geometry;
    const xL = coordMap.timeToX(g.startTime);
    const xR = coordMap.timeToX(g.endTime);
    const yE = coordMap.priceToY(g.entryPrice);
    const yS = coordMap.priceToY(g.stopPrice);
    const yT = coordMap.priceToY(g.targetPrice);
    if (xL == null || xR == null || yE == null || yS == null || yT == null) {
      return null;
    }
    const xLeft = Math.min(xL, xR);
    const xRight = Math.max(xL, xR);
    const pad = 4;
    const yRiskTop = Math.min(yE, yS);
    const yRiskBot = Math.max(yE, yS);
    const yRewTop = Math.min(yE, yT);
    const yRewBot = Math.max(yE, yT);
    return {
      xLeft,
      xRight,
      yE,
      yS,
      yT,
      yRiskTop,
      yRiskBot,
      yRewTop,
      yRewBot,
      pad,
      width: Math.max(1, xRight - xLeft),
    };
  });

  let metrics = $derived(computeState && computeState.status !== 'success' ? null : data ?? null);

  /** Fallback when API hasn't replied yet (data is null on first render). */
  function riskRewardFromGeometry(g: PositionGeo, long: boolean): number | null {
    const risk = long ? g.entryPrice - g.stopPrice : g.stopPrice - g.entryPrice;
    const reward = long
      ? g.targetPrice - g.entryPrice
      : g.entryPrice - g.targetPrice;
    if (!(risk > 0 && reward > 0)) return null;
    return reward / risk;
  }

  let displayRiskReward = $derived.by(() => {
    const current = riskRewardFromGeometry(drawable.geometry, isLong);
    if (current === null || (computeState && computeState.status !== 'success')) return null;
    const rr = metrics?.riskRewardRatio;
    if (rr != null && Number.isFinite(rr) && rr > 0) return rr;
    return current;
  });

  let validDirection = $derived(riskRewardFromGeometry(drawable.geometry, isLong) !== null);
  let validTarget = $derived(isLong ? drawable.geometry.targetPrice > drawable.geometry.entryPrice : drawable.geometry.targetPrice < drawable.geometry.entryPrice);
  let validStop = $derived(isLong ? drawable.geometry.stopPrice < drawable.geometry.entryPrice : drawable.geometry.stopPrice > drawable.geometry.entryPrice);
  let statusLabel = $derived(!validDirection ? 'Invalid levels' : computeState?.status === 'pending' ? 'Calculating…' : computeState?.status === 'error' ? 'Calculation failed' : null);

  let labelTexts = $derived([
    `${validTarget ? 'Target' : 'Invalid target'}: ${fmtPrice(Math.abs(drawable.geometry.targetPrice - drawable.geometry.entryPrice))} price (${fmt(Math.abs(pctFromEntry(drawable.geometry.targetPrice, drawable.geometry.entryPrice)), 3)}%)`,
    `${validStop ? 'Stop' : 'Invalid stop'}: ${fmtPrice(Math.abs(drawable.geometry.stopPrice - drawable.geometry.entryPrice))} price (${fmt(Math.abs(pctFromEntry(drawable.geometry.stopPrice, drawable.geometry.entryPrice)), 3)}%)`,
    statusLabel ?? `Risk/reward: ${fmt(displayRiskReward, 2)}`,
  ]);
  let labelElements = $state<(HTMLDivElement | undefined)[]>([]);
  let labelWidths = $state([140, 140, 144]);

  $effect(() => {
    labelTexts;
    for (let i = 0; i < labelElements.length; i++) {
      const element = labelElements[i];
      if (!element) continue;
      const width = Math.max(i === 2 ? 144 : 140, Math.ceil(element.getBoundingClientRect().width));
      if (Number.isFinite(width) && width !== labelWidths[i]) labelWidths[i] = width;
    }
  });

  let dragKind = $state<null | 'target' | 'stop' | 't0' | 't1'>(null);

  $effect(() => {
    if (!layout || layout.xRight < 0 || layout.xLeft > coordMap.plotWidth || Math.max(layout.yRiskBot, layout.yRewBot) < 0 || Math.min(layout.yRiskTop, layout.yRewTop) > coordMap.plotHeight) {
      onAnchorPoint(null);
      return;
    }
    onAnchorPoint({ x: layout.xRight + 8, y: layout.yE });
  });

  function onHitPointerDown(e: PointerEvent) {
    e.stopPropagation();
    onRequestSelect();
  }

  function fmt(n: number | null | undefined, d = 2): string {
    if (n == null || !Number.isFinite(n)) return '—';
    return n.toFixed(d);
  }

  function fmtPrice(n: number): string {
    if (!Number.isFinite(n)) return '—';
    if (n === 0 || (Math.abs(n) >= 0.01 && Math.abs(n) < 1e6)) return n.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 6, minimumFractionDigits: 2 });
    return n.toPrecision(4).replace(/(\.\d*?[1-9])0+(?=e|$)|\.0+(?=e|$)/, '$1');
  }

  function pctFromEntry(price: number, entry: number): number {
    if (!Number.isFinite(price) || !Number.isFinite(entry) || entry === 0) {
      return 0;
    }
    return ((price - entry) / entry) * 100;
  }

  function patchGeo(patch: Partial<PositionGeo>): void {
    onGeometryChange({ ...drawable.geometry, ...patch });
  }

  function labelX(center: number, width: number): number {
    return Math.max(0, Math.min(center - width / 2, coordMap.plotWidth - width));
  }

  function handleDown(
    kind: 'target' | 'stop' | 't0' | 't1',
    e: PointerEvent,
  ): void {
    if (!toChartPoint) return;
    e.stopPropagation();
    e.preventDefault();
    onRequestSelect();
    dragKind = kind;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }

  function handleMove(e: PointerEvent): void {
    if (!dragKind || !toChartPoint) return;
    const pt = toChartPoint(e);
    if (!pt) return;
    const g = drawable.geometry;
    if (dragKind === 'target') {
      patchGeo({ targetPrice: pt.price });
    } else if (dragKind === 'stop') {
      patchGeo({ stopPrice: pt.price });
    } else if (dragKind === 't0') {
      const next = Math.min(pt.time, g.endTime - MIN_TIME_SPAN);
      patchGeo({ startTime: next });
    } else if (dragKind === 't1') {
      const next = Math.max(pt.time, g.startTime + MIN_TIME_SPAN);
      patchGeo({ endTime: next });
    }
  }

  function handleUp(e: PointerEvent): void {
    if (dragKind) {
      try {
        (e.currentTarget as Element).releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
    }
    dragKind = null;
  }

  function handlePos(
    kind: 'target' | 'stop' | 't0' | 't1',
    L: NonNullable<typeof layout>,
  ): { x: number; y: number } {
    const g = drawable.geometry;
    if (kind === 'target') {
      return { x: L.xLeft - HANDLE / 2, y: L.yT - HANDLE / 2 };
    }
    if (kind === 'stop') {
      return { x: L.xLeft - HANDLE / 2, y: L.yS - HANDLE / 2 };
    }
    if (kind === 't0') {
      const x = coordMap.timeToX(g.startTime);
      return {
        x: (x ?? L.xLeft) - HANDLE / 2,
        y: L.yE - HANDLE / 2,
      };
    }
    const x = coordMap.timeToX(g.endTime);
    return {
      x: (x ?? L.xRight) - HANDLE / 2,
      y: L.yE - HANDLE / 2,
    };
  }
</script>

{#if layout}
  {@const L = layout}
  {@const strokeW = selected ? 2 : 1}
  {@const targetLabelY =
    L.yT <= L.yE
      ? L.yRewTop - LABEL_GAP - CHIP_H_TARGET_STOP
      : L.yRewBot + LABEL_GAP}
  {@const stopLabelY =
    L.yS <= L.yE
      ? L.yRiskTop - LABEL_GAP - CHIP_H_TARGET_STOP
      : L.yRiskBot + LABEL_GAP}
  {@const labelCenterX = L.xLeft + L.width / 2}
  <g>
    <DrawableSvgHitRect
      x={L.xLeft - L.pad}
      y={Math.min(L.yRiskTop, L.yRewTop) - L.pad}
      width={L.width + L.pad * 2}
      height={Math.max(L.yRiskBot, L.yRewBot) -
        Math.min(L.yRiskTop, L.yRewTop) +
        L.pad * 2}
      drawableId={drawable.id}
      ariaLabel="{isLong ? 'Long' : 'Short'} position"
      onPointerDown={onHitPointerDown}
      mode="stroke"
    />

    {#if drawable.style.showRiskZone}
      <rect
        x={L.xLeft}
        y={L.yRiskTop}
        width={L.width}
        height={Math.max(1, L.yRiskBot - L.yRiskTop)}
        fill={drawable.style.stopColor}
        fill-opacity="0.18"
        pointer-events="none"
      />
    {/if}
    {#if drawable.style.showRewardZone}
      <rect
        x={L.xLeft}
        y={L.yRewTop}
        width={L.width}
        height={Math.max(1, L.yRewBot - L.yRewTop)}
        fill={validTarget ? drawable.style.targetColor : drawable.style.stopColor}
        fill-opacity="0.18"
        pointer-events="none"
      />
    {/if}

    <line
      x1={L.xLeft}
      x2={L.xRight}
      y1={L.yE}
      y2={L.yE}
      stroke={validDirection ? drawable.style.targetColor : drawable.style.stopColor}
      stroke-width={strokeW}
      stroke-dasharray="4 3"
      pointer-events="none"
    />
    <line
      x1={L.xLeft}
      x2={L.xRight}
      y1={L.yS}
      y2={L.yS}
      stroke={drawable.style.stopColor}
      stroke-width={1}
      pointer-events="none"
    />
    <line
      x1={L.xLeft}
      x2={L.xRight}
      y1={L.yT}
      y2={L.yT}
      stroke={validTarget ? drawable.style.targetColor : drawable.style.stopColor}
      stroke-width={1}
      pointer-events="none"
    />

    {#if drawable.style.showMetrics}
      <foreignObject
        x={labelX(labelCenterX, labelWidths[0])}
        y={targetLabelY}
        width={labelWidths[0]}
        height={CHIP_H_TARGET_STOP}
        pointer-events="none"
      >
        <div
          bind:this={labelElements[0]}
          class="w-max whitespace-nowrap rounded px-2 py-1 text-[10px] font-mono shadow-lg text-center"
          style:min-width="140px"
          style:background-color={validTarget ? drawable.style.targetColor : drawable.style.stopColor}
          style:color={contrastTextColour(validTarget ? drawable.style.targetColor : drawable.style.stopColor)}
        >
          {labelTexts[0]}
        </div>
      </foreignObject>

      <foreignObject
        x={labelX(labelCenterX, labelWidths[1])}
        y={stopLabelY}
        width={labelWidths[1]}
        height={CHIP_H_TARGET_STOP}
        pointer-events="none"
      >
        <div
          bind:this={labelElements[1]}
          class="w-max whitespace-nowrap rounded px-2 py-1 text-[10px] font-mono shadow-lg text-center"
          style:min-width="140px"
          style:background-color={drawable.style.stopColor}
          style:color={contrastTextColour(drawable.style.stopColor)}
        >
          {labelTexts[1]}
        </div>
      </foreignObject>

      <foreignObject
        x={labelX(labelCenterX, labelWidths[2])}
        y={L.yE - CHIP_H_RR / 2}
        width={labelWidths[2]}
        height={CHIP_H_RR}
        pointer-events="none"
      >
        <div
          bind:this={labelElements[2]}
          class="w-max whitespace-nowrap rounded px-2 py-1 text-[10px] font-mono shadow-lg text-center"
          style:min-width="144px"
          style:background-color={statusLabel ? drawable.style.stopColor : drawable.style.targetColor}
          style:color={contrastTextColour(statusLabel ? drawable.style.stopColor : drawable.style.targetColor)}
        >
          {labelTexts[2]}
        </div>
      </foreignObject>
    {/if}

    {#if selected && toChartPoint}
      {@const pT = handlePos('target', L)}
      {@const pS = handlePos('stop', L)}
      {@const pL = handlePos('t0', L)}
      {@const pR = handlePos('t1', L)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <rect
        x={pT.x}
        y={pT.y}
        width={HANDLE}
        height={HANDLE}
        rx="2"
        fill="white"
        stroke="rgb(59, 130, 246)"
        stroke-width="1.5"
        role="button"
        tabindex="-1"
        aria-label="Drag target price"
        class="cursor-ns-resize"
        style:pointer-events="auto"
        onpointerdown={e => handleDown('target', e)}
        onpointermove={handleMove}
        onpointerup={handleUp}
        onpointercancel={handleUp}
        onlostpointercapture={handleUp}
      />
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <rect
        x={pS.x}
        y={pS.y}
        width={HANDLE}
        height={HANDLE}
        rx="2"
        fill="white"
        stroke="rgb(59, 130, 246)"
        stroke-width="1.5"
        role="button"
        tabindex="-1"
        aria-label="Drag stop price"
        class="cursor-ns-resize"
        style:pointer-events="auto"
        onpointerdown={e => handleDown('stop', e)}
        onpointermove={handleMove}
        onpointerup={handleUp}
        onpointercancel={handleUp}
        onlostpointercapture={handleUp}
      />
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <rect
        x={pL.x}
        y={pL.y}
        width={HANDLE}
        height={HANDLE}
        rx="2"
        fill="white"
        stroke="rgb(59, 130, 246)"
        stroke-width="1.5"
        role="button"
        tabindex="-1"
        aria-label="Drag band start time"
        class="cursor-ew-resize"
        style:pointer-events="auto"
        onpointerdown={e => handleDown('t0', e)}
        onpointermove={handleMove}
        onpointerup={handleUp}
        onpointercancel={handleUp}
        onlostpointercapture={handleUp}
      />
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <rect
        x={pR.x}
        y={pR.y}
        width={HANDLE}
        height={HANDLE}
        rx="2"
        fill="white"
        stroke="rgb(59, 130, 246)"
        stroke-width="1.5"
        role="button"
        tabindex="-1"
        aria-label="Drag band end time"
        class="cursor-ew-resize"
        style:pointer-events="auto"
        onpointerdown={e => handleDown('t1', e)}
        onpointermove={handleMove}
        onpointerup={handleUp}
        onpointercancel={handleUp}
        onlostpointercapture={handleUp}
      />
    {/if}
  </g>
{/if}

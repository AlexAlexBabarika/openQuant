<script lang="ts">
  import { onDestroy } from 'svelte';
  import { placementGesture } from '$lib/features/drawables/placement/gesture';
  import { chartKeyAction } from '$lib/features/drawables/placement/keyboard';
  import type { OHLCVCandle } from '$lib/core/types';
  import {
    drawables,
    getTool,
    CURSOR,
    deepCloneDrawableSnapshot,
    type BundledDrawable,
    type ActiveTool,
    type CoordMap,
    type ChartPoint,
    type PlacementMachine,
    type Drawable,
    type PopupAction,
    type ScreenPoint,
    type DrawableComputeState,
    resolvePopupActions,
  } from '$lib/features/drawables';
  import ChartDrawablesCompute from './ChartDrawablesCompute.svelte';
  import DrawablesSvgScene from './DrawablesSvgScene.svelte';
  import DrawablePopup from './DrawablePopup.svelte';

  let {
    coordMap = null as CoordMap | null,
    symbol = '',
    activeTool,
    onActiveToolChange,
    candles = [] as OHLCVCandle[],
    provider = 'yfinance',
    interval = '1d',
    seriesIdentity = '',
    toChartPoint,
    containerEl = null as HTMLDivElement | null,
    onPlacementActiveChange,
  }: {
    coordMap: CoordMap | null;
    symbol: string;
    activeTool: ActiveTool;
    /** Prefer this over nested $bindable so App state always updates when placement finishes. */
    onActiveToolChange: (t: ActiveTool) => void;
    candles: OHLCVCandle[];
    provider: string;
    interval: string;
    seriesIdentity?: string;
    toChartPoint: (e: PointerEvent) => ChartPoint | null;
    containerEl: HTMLDivElement | null;
    /** Lets the chart disable pan/zoom while the user is placing a drawable. */
    onPlacementActiveChange?: (active: boolean) => void;
  } = $props();

  function setActiveTool(t: ActiveTool): void {
    onActiveToolChange(t);
  }

  /** Avoid new filtered array when `items` ref and symbol are unchanged (reduces downstream compute churn). */
  let lastStoreItems: BundledDrawable[] | undefined;
  let lastSymbolForItems: string | undefined;
  let cachedItemsForSymbol: BundledDrawable[] = [];

  let lastCandleTime = $derived(
    candles.length > 0
      ? Math.floor(
          new Date(candles[candles.length - 1].timestamp).getTime() / 1000,
        )
      : null,
  );

  let barStepSeconds = $derived(
    candles.length >= 2
      ? Math.max(
          1,
          Math.floor(
            new Date(candles[candles.length - 1].timestamp).getTime() / 1000,
          ) -
            Math.floor(
              new Date(candles[candles.length - 2].timestamp).getTime() / 1000,
            ),
        )
      : null,
  );

  let itemsForSymbol = $derived.by(() => {
    const all = drawables.items;
    const sym = symbol;
    if (all === lastStoreItems && sym === lastSymbolForItems) {
      return cachedItemsForSymbol;
    }
    lastStoreItems = all;
    lastSymbolForItems = sym;
    cachedItemsForSymbol = all.filter(d => d.symbol === sym);
    return cachedItemsForSymbol;
  });

  let placement = $state<{
    type: string;
    machine: PlacementMachine<unknown>;
    gesture: ReturnType<typeof placementGesture>;
    symbol: string;
    preview: Drawable | null;
  } | null>(null);

  let viewIdentity = $derived(JSON.stringify([symbol, provider, interval, seriesIdentity]));
  let gestureIdentity = $derived(JSON.stringify([viewIdentity, activeTool]));
  let lastViewIdentity: string | undefined;
  let lastGestureIdentity: string | undefined;
  function cancelPlacement() {
    const previous = placement;
    placement = null;
    previous?.gesture.cancel();
  }
  $effect(() => {
    const view = viewIdentity;
    const gesture = gestureIdentity;
    if (view !== lastViewIdentity) {
      drawables.select(null);
      anchorPointsMap.clear();
      anchorTick += 1;
      lastViewIdentity = view;
    }
    if (gesture !== lastGestureIdentity) {
      cancelPlacement();
      lastGestureIdentity = gesture;
    }
  });
  onDestroy(cancelPlacement);

  $effect(() => {
    onPlacementActiveChange?.(placement !== null);
  });

  let computedData = $state<Map<string, unknown>>(new Map());
  let computedStates = $state<Map<string, DrawableComputeState>>(new Map());

  const anchorPointsMap = new Map<string, ScreenPoint>();
  let anchorTick = $state(0);

  function setAnchorPoint(id: string, pt: ScreenPoint | null): void {
    const prev = anchorPointsMap.get(id);
    if (pt === null) {
      if (prev === undefined) return;
      anchorPointsMap.delete(id);
    } else {
      if (prev && prev.x === pt.x && prev.y === pt.y) return;
      anchorPointsMap.set(id, pt);
    }
    anchorTick += 1;
  }

  let popupAnchor = $derived.by(() => {
    anchorTick;
    const sel = visibleSelection();
    if (!sel) return null;
    const pt = anchorPointsMap.get(sel.id);
    return pt ?? null;
  });

  let popupActions = $derived.by(() => {
    const sel = visibleSelection();
    if (!sel) return [] as PopupAction[];
    const tool = getTool(sel.type);
    return tool ? resolvePopupActions(tool) : [];
  });

  function onPopupAction(id: PopupAction['id'], action: PopupAction): void {
    const sel = visibleSelection();
    if (!sel) return;
    if (id === 'delete') {
      drawables.remove(sel.id);
      return;
    }
    if (id === 'custom' && action.id === 'custom') {
      action.handler(sel);
    }
  }

  function refreshPlacementPreview() {
    if (!placement) return;
    const prev = placement.machine.preview;
    const tool = getTool(placement.type);
    if (!prev || !tool) {
      placement = { ...placement, preview: null };
      return;
    }
    const previewDrawable: Drawable = {
      id: '__preview__',
      type: placement.type,
      symbol: placement.symbol,
      geometry: prev.geometry,
      params: tool.defaults.params,
      style: tool.defaults.style,
      createdAt: 0,
    };
    placement = { ...placement, preview: previewDrawable };
  }

  export function handlePointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    if (activeTool === CURSOR) {
      const target = e.target as Element | null;
      const hitId = target
        ?.closest('[data-drawable-id]')
        ?.getAttribute('data-drawable-id');
      if (hitId) {
        drawables.select(hitId);
      } else {
        drawables.select(null);
      }
      return;
    }

    const pt = toChartPoint(e);
    if (!pt || !coordMap) return;
    if (!placement) {
      const tool = getTool(activeTool);
      if (!tool) return;
      const machine = tool.createPlacement({
        coordMap,
        symbol,
        lastCandleTime,
        barStepSeconds,
      });
      const toolType = tool.type;
      const startSymbol = symbol;
      const captureEl = containerEl;
      const pointerId = e.pointerId;
      captureEl?.setPointerCapture?.(pointerId);
      const gesture = placementGesture(machine, gestureIdentity, pointerId, () => gestureIdentity, (geometry: unknown) => {
        drawables.add({
          id: crypto.randomUUID(),
          type: toolType,
          symbol: startSymbol,
          geometry,
          params: deepCloneDrawableSnapshot(tool.defaults.params),
          style: deepCloneDrawableSnapshot(tool.defaults.style),
          createdAt: Date.now(),
        } as BundledDrawable);
        placement = null;
        setActiveTool(CURSOR);
      }, () => {
        if (captureEl?.hasPointerCapture?.(pointerId)) captureEl.releasePointerCapture(pointerId);
      });
      placement = { type: toolType, machine, gesture, symbol: startSymbol, preview: null };
    }
    placement.gesture.down(e.pointerId, pt);
    e.preventDefault();
    refreshPlacementPreview();
  }

  export function handlePointerMove(e: PointerEvent) {
    if (!placement) return;
    const pt = toChartPoint(e);
    if (!pt) return;
    placement.gesture.move(e.pointerId, pt);
    refreshPlacementPreview();
  }

  export function handlePointerUp(e: PointerEvent) {
    if (!placement) return;
    const current = placement;
    current.gesture.end(e, e.type === 'pointerup' ? toChartPoint(e) : null);
    if (current.gesture.closed) {
      placement = null;
      if (activeTool === current.type) setActiveTool(CURSOR);
    }
    refreshPlacementPreview();
  }

  export function handleKeyDown(e: KeyboardEvent) {
    const selection = visibleSelection();
    switch (chartKeyAction(e, placement !== null, selection !== null)) {
      case 'cancel':
        cancelPlacement();
        setActiveTool(CURSOR);
        break;
      case 'deselect':
        drawables.select(null);
        break;
      case 'delete':
        drawables.remove(selection!.id);
        e.preventDefault();
        break;
    }
  }

  function visibleSelection() {
    anchorTick;
    if (viewIdentity !== lastViewIdentity) return null;
    return drawables.selectedForSymbol(symbol, anchorPointsMap.keys());
  }
</script>

{#if coordMap}
  <ChartDrawablesCompute
    bind:computedData
    bind:computedStates
    {symbol}
    {candles}
    {provider}
    {interval}
    items={itemsForSymbol}
  />

  {#key gestureIdentity}
  <DrawablesSvgScene
    {coordMap}
    items={itemsForSymbol}
    {computedData}
    {computedStates}
    creating={activeTool !== CURSOR}
    selectedId={drawables.selected?.id ?? null}
    {placement}
    {toChartPoint}
    onPatchGeometry={(id, geometry) => drawables.update(id, { geometry })}
    onSelectDrawable={id => drawables.select(id)}
    onAnchorPoint={(id, pt) => setAnchorPoint(id, pt)}
  />
  {/key}

  {#if popupAnchor && popupActions.length > 0}
    <DrawablePopup
      anchor={popupAnchor}
      actions={popupActions}
      onAction={onPopupAction}
    />
  {/if}
{/if}

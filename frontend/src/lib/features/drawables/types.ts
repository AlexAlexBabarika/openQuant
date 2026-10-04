// frontend/src/lib/features/drawables/types.ts
import type { Component } from 'svelte';
import type { OHLCVCandle } from '$lib/core/types';

/** A pixel coordinate on the chart container. */
export interface ScreenPoint {
  x: number;
  y: number;
}

/** A chart-space coordinate (time in unix seconds, price in instrument units). */
export interface ChartPoint {
  time: number;
  price: number;
}

/**
 * Maps chart-space ↔ screen-space. Provided by the chart to Renderers and
 * placement machines. `version` bumps whenever pan/zoom/resize invalidates
 * cached coordinates, so consumers can depend on it in `$derived`.
 */
export interface CoordMap {
  version: number;
  plotWidth: number;
  /** Pixel height of the main price pane (for vertical guides / overlays). */
  plotHeight: number;
  timeToX: (t: number) => number | null;
  xToTime: (x: number) => number | null;
  priceToY: (p: number) => number | null;
  yToPrice: (y: number) => number | null;
}

/** A single drawable instance stored in the drawables store. */
export interface Drawable<Geo = unknown, Params = unknown, Style = unknown> {
  id: string;
  type: string;
  symbol: string;
  geometry: Geo;
  params: Params;
  style: Style;
  createdAt: number;
}

/**
 * Popup action descriptor. Default is delete only; tool settings live in the
 * left-toolbar tool dropdown. Tools may override via `DrawableTool.popupActions`.
 */
export type PopupAction =
  | { id: 'delete'; label: string }
  | { id: 'custom'; label: string; handler: (drawable: Drawable) => void };

/** Context passed to `createPlacement`. Provides the chart mappers the machine needs. */
export interface PlacementCtx {
  coordMap: CoordMap;
  symbol: string;
  /** Unix seconds of last loaded candle; band tools anchor their right edge here. */
  lastCandleTime?: number | null;
  /** Seconds between the last two bars; used for minimum horizontal span past the last candle. */
  barStepSeconds?: number | null;
}

/**
 * State machine that turns raw pointer events into a completed geometry.
 * Tools return an instance from `createPlacement(ctx)`.
 */
export interface PlacementMachine<Geo> {
  onPointerDown(pt: ChartPoint): void;
  onPointerMove(pt: ChartPoint): void;
  onPointerUp(pt: ChartPoint): void;
  /** Preview geometry while placing (for live rendering). Null before first event. */
  readonly preview: { geometry: Geo } | null;
  /** Called once when placement is final. */
  onComplete(cb: (geometry: Geo) => void): void;
  /** Called if placement is cancelled (e.g. Escape). */
  cancel(): void;
  /** True after onComplete or cancel was called. Machine should not be used further. */
  readonly done: boolean;
}

export interface ComputeCtx {
  candles: readonly OHLCVCandle[];
  provider: string;
  symbol: string;
  interval: string;
  signal: AbortSignal;
}

/** The contract every registered tool must satisfy. */
export interface DrawableTool<
  Geo = unknown,
  Params = unknown,
  Style = unknown,
  Data = void,
> {
  type: string;
  label: string;
  icon: Component;
  defaults: { params: Params; style: Style };

  schemaVersion: number;
  migrate?: (raw: unknown) => Drawable<Geo, Params, Style> | null;

  createPlacement(ctx: PlacementCtx): PlacementMachine<Geo>;
  compute?: (
    drawable: Drawable<Geo, Params, Style>,
    ctx: ComputeCtx,
  ) => Data | Promise<Data>;
  /** Defaults to true; false keeps geometry-only results across candle updates. */
  computeUsesCandles?: boolean;

  Renderer: Component<RendererProps<Geo, Params, Style, Data>>;
  Settings: Component<SettingsProps<Geo, Params, Style>>;
  popupActions?: PopupAction[];
}

export interface DrawableComputeState {
  status: 'pending' | 'success' | 'error';
  workKey: string;
  error?: string;
}

/** Minimal props for placement preview (no selection or mutation callbacks). */
export interface PreviewRendererProps<Geo, Params, Style, Data> {
  drawable: Drawable<Geo, Params, Style>;
  data: Data | undefined;
  computeState?: DrawableComputeState;
  coordMap: CoordMap;
  /** Chart hit-test for drawable handle drags (optional). */
  toChartPoint?: (e: PointerEvent) => ChartPoint | null;
}

/** Interactive callbacks for a committed drawable on the chart. */
export interface RendererInteraction<Geo> {
  selected: boolean;
  onGeometryChange: (geo: Geo) => void;
  onRequestSelect: () => void;
  onAnchorPoint: (pt: ScreenPoint | null) => void;
}

/** Full renderer props — enforced by `DrawableTool.Renderer` typing above. */
export type RendererProps<Geo, Params, Style, Data> = PreviewRendererProps<
  Geo,
  Params,
  Style,
  Data
> &
  RendererInteraction<Geo>;

/** Merge preview props with inert handlers for placement preview rendering. */
export function previewPlacementRendererProps<Geo, Params, Style, Data>(
  preview: PreviewRendererProps<Geo, Params, Style, Data>,
): RendererProps<Geo, Params, Style, Data> {
  return {
    ...preview,
    selected: false,
    onGeometryChange: () => {},
    onRequestSelect: () => {},
    onAnchorPoint: () => {},
  };
}

/**
 * Settings prop shape — enforced by `DrawableTool.Settings` typing above.
 * The modal owns staged copies of `params` and `style`; the component mutates
 * their properties in place via `bind:`. No live-apply — the modal commits
 * on Ok.
 */
export interface SettingsProps<_Geo, Params, Style> {
  params: Params;
  style: Style;
}

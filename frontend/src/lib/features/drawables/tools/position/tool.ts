import TrendingUp from '@lucide/svelte/icons/trending-up';
import TrendingDown from '@lucide/svelte/icons/trending-down';
import type { DrawableTool, Drawable } from '../../types';
import { positionBandPlacement } from '../../placement/positionBand';
import type { PositionGeo } from '../../placement/positionBand';
import {
  computePositionMetrics,
  DEFAULT_POSITION_STYLE,
  normalizePositionStyle,
  type PositionParams,
  type PositionStyle,
  type PositionMetricsResponse,
} from './compute';
import { POSITION_LONG_TYPE, POSITION_SHORT_TYPE } from './constants';
import { extractDrawableFieldBag } from '../../drawableFieldBag';
import Renderer from './Renderer.svelte';
import Settings from './Settings.svelte';

export type {
  PositionGeo,
  PositionParams,
  PositionStyle,
  PositionMetricsResponse,
};
export type PositionLongDrawable = Drawable<
  PositionGeo,
  PositionParams,
  PositionStyle
> & { type: typeof POSITION_LONG_TYPE };
export type PositionShortDrawable = Drawable<
  PositionGeo,
  PositionParams,
  PositionStyle
> & { type: typeof POSITION_SHORT_TYPE };

const defaultParams: PositionParams = {};

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function migratePositionEntry(
  raw: unknown,
  expectedType: typeof POSITION_LONG_TYPE | typeof POSITION_SHORT_TYPE,
): Drawable<PositionGeo, PositionParams, PositionStyle> | null {
  const bag = extractDrawableFieldBag(raw);
  if (!bag || bag.type !== expectedType) return null;

  const g = bag.geometry;
  if (!isRecord(g)) return null;

  let geometry: PositionGeo;

  if (
    typeof g.startTime === 'number' &&
    typeof g.endTime === 'number' &&
    Number.isFinite(g.startTime) &&
    Number.isFinite(g.endTime)
  ) {
    geometry = {
      startTime: g.startTime,
      endTime: g.endTime,
      entryPrice: g.entryPrice as number,
      stopPrice: g.stopPrice as number,
      targetPrice: g.targetPrice as number,
    };
  } else if (
    typeof g.entryTime === 'number' &&
    typeof g.stopTime === 'number' &&
    typeof g.targetTime === 'number'
  ) {
    geometry = {
      startTime: Math.min(g.entryTime, g.stopTime, g.targetTime),
      endTime: Math.max(g.entryTime, g.stopTime, g.targetTime),
      entryPrice: g.entryPrice as number,
      stopPrice: g.stopPrice as number,
      targetPrice: g.targetPrice as number,
    };
  } else {
    return null;
  }

  return {
    id: bag.id,
    type: expectedType,
    symbol: bag.symbol,
    createdAt: bag.createdAt,
    geometry,
    params: {},
    style: normalizePositionStyle(bag.style),
  };
}

function createPositionTool(
  type: typeof POSITION_LONG_TYPE | typeof POSITION_SHORT_TYPE,
  label: string,
  icon: DrawableTool['icon'],
  side: 'long' | 'short',
): DrawableTool<
  PositionGeo,
  PositionParams,
  PositionStyle,
  PositionMetricsResponse
> {
  return {
    type,
    label,
    icon,
    defaults: {
      params: { ...defaultParams },
      style: { ...DEFAULT_POSITION_STYLE },
    },
    schemaVersion: 2,
    migrate: raw => migratePositionEntry(raw, type),
    createPlacement: ctx => positionBandPlacement(ctx, side),
    computeUsesCandles: false,
    compute: (d, ctx) => computePositionMetrics(side, d, ctx),
    Renderer,
    Settings,
  };
}

export const positionLongTool = createPositionTool(
  POSITION_LONG_TYPE,
  'Long position',
  TrendingUp,
  'long',
);

export const positionShortTool = createPositionTool(
  POSITION_SHORT_TYPE,
  'Short position',
  TrendingDown,
  'short',
);

/** Crosshair-style toolbar entries (single popover). */
export const POSITION_TOOLBAR_MODES = [
  {
    type: positionLongTool.type,
    label: positionLongTool.label,
    icon: positionLongTool.icon,
  },
  {
    type: positionShortTool.type,
    label: positionShortTool.label,
    icon: positionShortTool.icon,
  },
] as const;

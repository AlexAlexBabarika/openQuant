// frontend/src/lib/drawables/toolDefaults.ts
import { safeLocalStorageGet, safeLocalStorageSet } from '$lib/core/storage';
import { normalizePositionStyle } from './tools/position/compute';
import { isPositionToolType } from './tools/position/constants';

export const TOOL_DEFAULTS_STORAGE_KEY = 'openQuant.drawables.toolDefaults.v1';

type Stored = Record<string, { params: unknown; style: unknown }>;

function readAll(): Stored {
  const parsed = safeLocalStorageGet<unknown>(TOOL_DEFAULTS_STORAGE_KEY, {
    warnLabel: '[drawables] loadToolDefaults read failed, using empty map',
  });
  if (!parsed || typeof parsed !== 'object') return {};
  return parsed as Stored;
}

export function loadToolDefaults(
  type: string,
): { params: unknown; style: unknown } | null {
  const stored = readAll()[type];
  if (!stored || typeof stored !== 'object' || Array.isArray(stored))
    return null;
  if (isPositionToolType(type)) {
    return { params: {}, style: normalizePositionStyle(stored.style) };
  }
  return stored;
}

export function saveToolDefaults(
  type: string,
  defaults: { params: unknown; style: unknown },
): void {
  const all = readAll();
  all[type] = defaults;
  safeLocalStorageSet(TOOL_DEFAULTS_STORAGE_KEY, all);
}

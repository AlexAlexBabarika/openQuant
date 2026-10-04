// frontend/src/lib/drawables/persistence.ts
import { safeLocalStorageGet, safeLocalStorageSet } from '$lib/core/storage';
import type { BundledDrawable } from './bundledDrawable';
import {
  extractDrawableFieldBag,
  narrowBundledDrawable,
} from './bundledNarrow';
import { getTool } from './registry';

export const DRAWABLES_STORAGE_KEY = 'openQuant.drawables.v1';

export function drawablesStorageKey(userId: string | null = null): string {
  const owner =
    userId === null ? 'guest' : `user.${encodeURIComponent(userId)}`;
  return `openQuant.drawables.v2.${owner}`;
}

function hydrateEntry(entry: unknown): BundledDrawable | null {
  if (!entry || typeof entry !== 'object') return null;
  const e = entry as { schemaVersion?: number; type?: unknown };
  if (typeof e.type !== 'string') return null;
  const tool = getTool(e.type);
  if (!tool) return null;

  let candidate: unknown = entry;
  if (e.schemaVersion !== tool.schemaVersion) {
    if (!tool.migrate) return null;
    const migrated = tool.migrate(entry);
    if (!migrated) return null;
    candidate = migrated;
  }

  const fields = extractDrawableFieldBag(candidate);
  if (!fields) return null;
  return narrowBundledDrawable(fields);
}

export function loadAll(userId: string | null = null): BundledDrawable[] {
  let parsed = safeLocalStorageGet<unknown>(drawablesStorageKey(userId), {
    warnLabel: '[drawables] loadAll failed, using empty list',
  });
  if (parsed === null && userId === null) {
    parsed = safeLocalStorageGet<unknown>(DRAWABLES_STORAGE_KEY, {
      warnLabel: '[drawables] legacy load failed, using empty list',
    });
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((entry: unknown): BundledDrawable[] => {
    const d = hydrateEntry(entry);
    return d ? [d] : [];
  });
}

export function saveAll(
  items: readonly BundledDrawable[],
  userId: string | null = null,
): void {
  const stamped = items.flatMap((d: BundledDrawable) => {
    const tool = getTool(d.type);
    if (!tool) return [];
    return [{ ...d, schemaVersion: tool.schemaVersion }];
  });
  safeLocalStorageSet(drawablesStorageKey(userId), stamped);
}

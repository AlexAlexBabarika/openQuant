import type { OHLCVCandle } from '$lib/core/types';

/** FNV-1a 32-bit; hex digest for logging / keys (not cryptographic). */
export function fnv1a32Hex(s: string): string {
  return (hashString(0x811c9dc5, s) >>> 0).toString(16);
}

function hashString(h: number, s: string): number {
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h;
}

/**
 * Fingerprint of the full candle series: any change to any bar’s OHLCV or
 * timestamp changes the result. Used in drawable `compute` `workKey` so we
 * do not skip work when only the array reference changes.
 */
export function candleBatchSignature(cs: OHLCVCandle[]): string {
  if (cs.length === 0) return '0';
  let hash = 0x811c9dc5;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (i > 0) hash = hashString(hash, '\x1e');
    hash = hashString(
      hash,
      `${c.timestamp}\x1f${c.open}\x1f${c.high}\x1f${c.low}\x1f${c.close}\x1f${c.volume}`,
    );
  }
  return `${cs.length}:${(hash >>> 0).toString(16)}`;
}

/** Same shape as {@link candleBatchSignature}: count + FNV-1a over row records (not cryptographic). */
export function bundledDrawablesFingerprint(
  items: readonly {
    id: string;
    type: string;
    geometry: unknown;
    params: unknown;
    style: unknown;
  }[],
): string {
  if (items.length === 0) return '0';
  const rows: string[] = new Array(items.length);
  for (let i = 0; i < items.length; i++) {
    const d = items[i];
    rows[i] = `${d.id}\x1f${d.type}\x1f${JSON.stringify({
      geometry: d.geometry,
      params: d.params,
      style: d.style,
    })}`;
  }
  return `${items.length}:${fnv1a32Hex(rows.join('\x1e'))}`;
}

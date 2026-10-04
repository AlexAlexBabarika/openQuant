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
 * Full-series dirty key, including historical OHLCV edits. Numeric fields use
 * fixed-width bytes to avoid decimal-string allocation on large histories.
 */
export function candleBatchSignature(cs: OHLCVCandle[]): string {
  if (cs.length === 0) return '0';
  let hash = 0x811c9dc5;
  const numberBytes = new DataView(new ArrayBuffer(8));
  function hashNumber(value: number): void {
    numberBytes.setFloat64(0, value === 0 ? 0 : value, true);
    for (let i = 0; i < 8; i++) {
      hash = Math.imul(hash ^ numberBytes.getUint8(i), 0x01000193);
    }
  }
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    hash = hashString(hash, c.timestamp);
    hash = Math.imul(hash ^ 0x1f, 0x01000193);
    hashNumber(c.open);
    hashNumber(c.high);
    hashNumber(c.low);
    hashNumber(c.close);
    hashNumber(c.volume);
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

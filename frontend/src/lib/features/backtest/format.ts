/**
 * Display formatting for dashboard values, and the sign classification that
 * drives green/red tinting. Pure functions, unit-tested. Currency is USD by
 * convention (the engine is currency-agnostic; the dashboard labels P&L in $).
 */

const EM_DASH = '—';

/** Sign bucket used for green (`pos`) / red (`neg`) tinting. */
export type Sign = 'pos' | 'neg' | 'zero';

export function signOf(x: number | null | undefined): Sign {
  if (x == null || x === 0 || Number.isNaN(x)) return 'zero';
  return x > 0 ? 'pos' : 'neg';
}

/** A fraction (0.1234) as a percent string ("12.34%"). */
export function formatPct(x: number | null | undefined, digits = 2): string {
  if (x == null || Number.isNaN(x)) return EM_DASH;
  return `${(x * 100).toFixed(digits)}%`;
}

/** A fraction as a signed percent ("+12.34%" / "-5.00%"). */
export function formatSignedPct(
  x: number | null | undefined,
  digits = 2,
): string {
  if (x == null || Number.isNaN(x)) return EM_DASH;
  const s = (x * 100).toFixed(digits);
  return x > 0 ? `+${s}%` : `${s}%`;
}

export function formatNumber(x: number | null | undefined, digits = 2): string {
  if (x == null || Number.isNaN(x)) return EM_DASH;
  return x.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatCurrency(
  x: number | null | undefined,
  digits = 2,
): string {
  if (x == null || Number.isNaN(x)) return EM_DASH;
  return x.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** A signed currency P&L ("+$1,200.00" / "-$340.50"). */
export function formatSignedCurrency(
  x: number | null | undefined,
  digits = 2,
): string {
  if (x == null || Number.isNaN(x)) return EM_DASH;
  const body = formatCurrency(Math.abs(x), digits);
  return x < 0 ? `-${body}` : `+${body}`;
}

export function formatRatio(x: number | null | undefined, digits = 2): string {
  if (x == null || Number.isNaN(x)) return EM_DASH;
  return x.toFixed(digits);
}

export function formatInt(x: number | null | undefined): string {
  if (x == null || Number.isNaN(x)) return EM_DASH;
  return Math.round(x).toLocaleString('en-US');
}

export function formatBars(x: number | null | undefined): string {
  if (x == null || Number.isNaN(x)) return EM_DASH;
  const n = Math.round(x);
  return `${n.toLocaleString('en-US')} bar${n === 1 ? '' : 's'}`;
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export function monthName(month: number): string {
  return MONTHS[month] ?? '';
}

/** A unix-seconds timestamp as "YYYY-MM-DD" (UTC). */
export function formatUnixDate(t: number | null | undefined): string {
  if (t == null || Number.isNaN(t)) return EM_DASH;
  return new Date(t * 1000).toISOString().slice(0, 10);
}

/** An ISO-8601 timestamp as "YYYY-MM-DD". */
export function formatIsoDate(iso: string | null | undefined): string {
  if (!iso) return EM_DASH;
  return iso.slice(0, 10);
}

/** An ISO-8601 timestamp as "YYYY-MM-DD HH:MM UTC". */
export function formatIsoMinute(iso: string | null | undefined): string {
  const date = new Date(iso ?? '');
  if (Number.isNaN(date.getTime())) return EM_DASH;
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

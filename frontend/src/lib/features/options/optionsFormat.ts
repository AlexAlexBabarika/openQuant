/** Readouts for people. Exact values stay in titles, exact-value tables, CSV and reports. */
type Value = number | null | undefined;
const finite = (value: Value): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const UNAVAILABLE = 'Unavailable';

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const usdSigned = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: 'exceptZero',
});
const usdWhole = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const usdWholeSigned = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
  signDisplay: 'exceptZero',
});
const price = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const general = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 6 });

export function formatUsd(
  value: Value,
  { signed = false, whole = false }: { signed?: boolean; whole?: boolean } = {},
): string {
  if (!finite(value)) return UNAVAILABLE;
  const format = whole
    ? signed
      ? usdWholeSigned
      : usdWhole
    : signed
      ? usdSigned
      : usd;
  return format.format(value);
}

/** Underlying prices and strikes: up to two decimals, grouped. */
export function formatPrice(value: Value): string {
  return finite(value) ? price.format(value) : UNAVAILABLE;
}

export function formatPercent(value: Value, digits = 1): string {
  return finite(value)
    ? new Intl.NumberFormat('en-US', {
        style: 'percent',
        maximumFractionDigits: digits,
      }).format(value)
    : UNAVAILABLE;
}

/** Four significant figures; tiny nonzero exposures switch to scientific notation. */
export function formatGreek(
  value: Value,
  { signed = false }: { signed?: boolean } = {},
): string {
  if (!finite(value)) return UNAVAILABLE;
  return new Intl.NumberFormat('en-US', {
    maximumSignificantDigits: 4,
    notation: value !== 0 && Math.abs(value) < 1e-4 ? 'scientific' : 'standard',
    signDisplay: signed ? 'exceptZero' : 'auto',
  }).format(value);
}

/** Days, quantities and other plain numbers. */
export function formatNumber(value: Value): string {
  return finite(value) ? general.format(value) : UNAVAILABLE;
}

import type { PriceFormatCustom } from 'lightweight-charts';

const formatters = new Map<string, Intl.NumberFormat>();

function priceDigits(value: number): number {
  const magnitude = Math.abs(value);
  if (!Number.isFinite(value) || magnitude === 0 || magnitude >= 1) return 2;
  return Math.min(100, Math.max(2, 5 - Math.floor(Math.log10(magnitude))));
}

/** Display precision, not a provider's tick size. */
export function formatMarketPrice(
  value: number | null | undefined,
  useGrouping = false,
): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const digits = priceDigits(value);
  if (digits > 12) {
    return value
      .toPrecision(6)
      .replace(/(\.\d*?[1-9])0+(?=e|$)|\.0+(?=e|$)/, '$1');
  }
  const key = `${digits}:${useGrouping}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', {
      useGrouping,
      minimumFractionDigits: 2,
      maximumFractionDigits: digits,
    });
    formatters.set(key, formatter);
  }
  return formatter.format(value);
}

export function marketPriceFormat(reference: number): PriceFormatCustom {
  const digits = priceDigits(reference);
  return {
    type: 'custom',
    formatter: formatMarketPrice,
    minMove: 10 ** -digits,
    base: 10 ** digits,
  };
}

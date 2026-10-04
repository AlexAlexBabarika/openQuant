import { describe, expect, it } from 'vitest';
import type { BarPrice } from 'lightweight-charts';
import { formatMarketPrice, marketPriceFormat } from './priceFormat';

describe('market price display precision', () => {
  it.each([
    [123.456, '123.46'],
    [0, '0.00'],
    [0.5, '0.50'],
    [0.123456, '0.123456'],
    [0.00000123456, '0.00000123456'],
    [-0.00000123456, '-0.00000123456'],
    [1.23456e-15, '1.23456e-15'],
    [null, '—'],
    [undefined, '—'],
    [NaN, '—'],
    [Infinity, '—'],
  ])('formats %s as %s', (value, expected) => {
    expect(formatMarketPrice(value)).toBe(expected);
  });

  it('keeps neighboring micro-prices distinguishable', () => {
    expect(formatMarketPrice(0.00000123456)).not.toBe(
      formatMarketPrice(0.00000123457),
    );
  });

  it('retains sidebar grouping without changing chart labels', () => {
    expect(formatMarketPrice(1234.56, true)).toBe('1,234.56');
    expect(formatMarketPrice(1234.56)).toBe('1234.56');
  });

  it('uses the same formatter for axis ticks without a cent-sized floor', () => {
    const format = marketPriceFormat(0.00000123456);
    expect(format.type).toBe('custom');
    expect(format.formatter(0.00000123456 as BarPrice)).toBe('0.00000123456');
    expect(format.minMove).toBe(1e-11);
    expect(format.base).toBe(1e11);
    expect(marketPriceFormat(100).minMove).toBe(0.01);
  });

  it('accepts the chart library tickmark fallback calling Array.map', () => {
    const format = marketPriceFormat(0.00000123456);
    const prices = [0.00000123456, 0.00000123457, 0.00000123458] as BarPrice[];
    expect(prices.map(format.formatter)).toEqual([
      '0.00000123456',
      '0.00000123457',
      '0.00000123458',
    ]);
    expect(
      ([1234.56, 1234.57] as BarPrice[]).map(
        marketPriceFormat(1234.56).formatter,
      ),
    ).toEqual(['1234.56', '1234.57']);
  });
});

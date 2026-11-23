import { describe, it, expect } from 'vitest';
import {
  formatBars,
  formatCurrency,
  formatInt,
  formatIsoDate,
  formatIsoMinute,
  formatPct,
  formatRatio,
  formatSignedCurrency,
  formatSignedPct,
  formatUnixDate,
  monthName,
  signOf,
} from './format';

describe('signOf', () => {
  it('buckets by sign, treating 0/null/NaN as zero', () => {
    expect(signOf(0.1)).toBe('pos');
    expect(signOf(-0.1)).toBe('neg');
    expect(signOf(0)).toBe('zero');
    expect(signOf(null)).toBe('zero');
    expect(signOf(NaN)).toBe('zero');
  });
});

describe('percent formatting', () => {
  it('formats fractions as percents', () => {
    expect(formatPct(0.1234)).toBe('12.34%');
    expect(formatPct(0.1234, 1)).toBe('12.3%');
    expect(formatPct(null)).toBe('—');
  });

  it('adds an explicit sign', () => {
    expect(formatSignedPct(0.05)).toBe('+5.00%');
    expect(formatSignedPct(-0.05)).toBe('-5.00%');
    expect(formatSignedPct(0)).toBe('0.00%');
  });
});

describe('currency formatting', () => {
  it('formats USD amounts', () => {
    expect(formatCurrency(1234.5)).toBe('$1,234.50');
    expect(formatCurrency(null)).toBe('—');
  });

  it('signs P&L explicitly', () => {
    expect(formatSignedCurrency(1200)).toBe('+$1,200.00');
    expect(formatSignedCurrency(-340.5)).toBe('-$340.50');
  });
});

describe('scalar formatting', () => {
  it('formats ratios, ints, and bar counts', () => {
    expect(formatRatio(1.6561)).toBe('1.66');
    expect(formatInt(2520.4)).toBe('2,520');
    expect(formatBars(1)).toBe('1 bar');
    expect(formatBars(19)).toBe('19 bars');
    expect(formatRatio(null)).toBe('—');
  });
});

describe('dates and months', () => {
  it('formats unix and iso timestamps to YYYY-MM-DD', () => {
    expect(formatUnixDate(1388534400)).toBe('2014-01-01');
    expect(formatIsoDate('2014-03-11T00:00:00+00:00')).toBe('2014-03-11');
    expect(formatUnixDate(null)).toBe('—');
    expect(formatIsoDate(null)).toBe('—');
  });

  it('formats an iso timestamp to the minute in UTC', () => {
    expect(formatIsoMinute('2026-10-19T19:32:04.510417+00:00')).toBe(
      '2026-10-19 19:32 UTC',
    );
    expect(formatIsoMinute('2026-10-19T21:32:04+02:00')).toBe(
      '2026-10-19 19:32 UTC',
    );
    expect(formatIsoMinute(null)).toBe('—');
    expect(formatIsoMinute('not a date')).toBe('—');
  });

  it('names months from a 0-based index', () => {
    expect(monthName(0)).toBe('Jan');
    expect(monthName(11)).toBe('Dec');
  });
});

import { describe, expect, it } from 'vitest';
import {
  formatGreek,
  formatNumber,
  formatPercent,
  formatPrice,
  formatTime,
  formatUsd,
} from './optionsFormat';

describe('options readout formatting', () => {
  it('formats money as dollars and cents with an explicit sign when asked', () => {
    expect(formatUsd(2024.6332556364023, { signed: true })).toBe('+$2,024.63');
    expect(formatUsd(-259.04)).toBe('-$259.04');
    expect(formatUsd(499.3420885178282)).toBe('$499.34');
    expect(formatUsd(-1183.4, { whole: true })).toBe('-$1,183');
    expect(formatUsd(0.001, { signed: true })).toBe('$0.00');
  });

  it('formats prices without trailing zeros on whole strikes', () => {
    expect(formatPrice(343.46)).toBe('343.46');
    expect(formatPrice(345)).toBe('345');
    expect(formatPrice(1374.248074378933)).toBe('1,374.25');
  });

  it('formats fractions as percentages to one decimal', () => {
    expect(formatPercent(0.5623)).toBe('56.2%');
    expect(formatPercent(0.031, 1)).toBe('3.1%');
  });

  it('formats Greeks to four significant figures', () => {
    expect(formatGreek(0.532164)).toBe('0.5322');
    expect(formatGreek(99.99630519765367, { signed: true })).toBe('+100');
    expect(formatGreek(-0.0012345)).toBe('-0.001235');
  });

  it('keeps missing values distinct from zero', () => {
    for (const format of [formatUsd, formatPrice, formatGreek, formatNumber])
      expect(format(null)).toBe('Unavailable');
    expect(formatPercent(Number.NaN)).toBe('Unavailable');
    expect(formatGreek(0)).toBe('0');
  });

  it('formats quote and fetch times with their zone, never as raw ISO', () => {
    // Noon UTC stays on Oct 14 in every zone the runner might use.
    const text = formatTime('2026-10-14T08:00:05-04:00');
    expect(text).toMatch(/^Oct 14, 2026, \d{1,2}:\d{2}:05\s[AP]M \S+$/);
    expect(text).not.toContain('T08');
    expect(formatTime(null)).toBeNull();
    expect(formatTime(undefined)).toBeNull();
    expect(formatTime('not a time')).toBe('not a time');
  });
});

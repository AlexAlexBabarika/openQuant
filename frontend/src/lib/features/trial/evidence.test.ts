import { describe, expect, it } from 'vitest';
import {
  chartBounds,
  chartX,
  equityPath,
  finalEquity,
  formatDate,
  formatMoney,
  formatPercent,
  validCost,
} from './evidence';

describe('trial evidence formatting', () => {
  it('formats engine fractions as percentages without rounding tiny losses to negative zero', () => {
    expect(formatPercent(0.12345, true)).toBe('+12.35%');
    expect(formatPercent(-0.0532, true)).toBe('-5.32%');
    expect(formatPercent(-0.0000001, true)).toBe('0.00%');
    expect(formatPercent(Infinity)).toBe('—');
  });

  it('shows exact currency and UTC dates rather than local timezone shifts', () => {
    expect(formatMoney(10000.25)).toBe('$10,000.25');
    expect(formatMoney(NaN)).toBe('—');
    expect(formatDate(1704067200)).toBe('Jan 1, 2024');
    expect(formatDate('2024-01-01T00:00:00Z')).toBe('Jan 1, 2024');
    expect(formatDate('invalid')).toBe('—');
    expect(finalEquity([])).toBe('No equity data');
    expect(finalEquity([{ t: 1, value: 9812.34 }])).toBe('$9,812.34');
  });

  it('permits finite fractional bps only within the API bounds', () => {
    for (const value of [0, 0.25, 50]) expect(validCost(value)).toBe(true);
    for (const value of [undefined, NaN, Infinity, -1, 50.01])
      expect(validCost(value)).toBe(false);
  });
});

describe('trial equity geometry', () => {
  it('uses one shared domain across all full-period series', () => {
    const first = [
      { t: 10, value: 10000 },
      { t: 20, value: 11000 },
    ];
    const second = [
      { t: 15, value: 8000 },
      { t: 30, value: 12000 },
    ];
    const bounds = chartBounds([first, second]);
    expect(bounds).toEqual({ start: 10, end: 30, min: 7600, max: 12400 });
    expect(chartX(10, bounds!)).toBe(78);
    expect(chartX(30, bounds!)).toBe(930);
    expect(chartX(15, bounds!)).toBe(291);
    expect(chartX(10, bounds!, 320)).toBe(78);
    expect(chartX(30, bounds!, 320)).toBe(290);
    expect(equityPath(first, bounds!)).toBe('M78.00,167.00 L504.00,114.92');
    expect(first[0]).toEqual({ t: 10, value: 10000 });
  });

  it('keeps flat or single-bar series finite and never bridges unavailable points', () => {
    const flat = [
      { t: 10, value: 10000 },
      { t: 10, value: 10000 },
    ];
    const bounds = chartBounds([flat]);
    expect(bounds).toEqual({ start: 10, end: 11, min: 9900, max: 10100 });
    expect(equityPath(flat, bounds!)).toBe('M78.00,167.00 L78.00,167.00');
    const gap = [flat[0], { t: NaN, value: 10000 }, { t: 11, value: 10000 }];
    expect(equityPath(gap, bounds!)).toBe('M78.00,167.00 M930.00,167.00');
  });

  it('represents missing or wholly invalid series as empty, not a made-up curve', () => {
    expect(chartBounds([[], []])).toBeNull();
    expect(chartBounds([[{ t: Infinity, value: 10000 }]])).toBeNull();
  });
});

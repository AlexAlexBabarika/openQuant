import { describe, expect, it } from 'vitest';
import {
  clampRgb,
  converter,
  parse,
  toGamut,
  wcagContrast,
  type Color,
} from 'culori';
import {
  heatmapCellLabel,
  heatmapColor,
  heatmapLegend,
  heatmapMetric,
  heatmapScale,
  heatmapValue,
} from './heatmap';

describe('heatmap scale', () => {
  it('maps every legend sample through the cell color function, including signed data', () => {
    const scale = heatmapScale([[-2, -1, 0, 1, 2]]);
    const legend = heatmapLegend(scale);
    expect(legend.map(stop => stop.position)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(legend.map(stop => stop.value)).toEqual([-2, -1, 0, 1, 2]);
    expect(legend.map(stop => converter('oklch')(stop.color)?.h)).toEqual([
      250, 187.5, 125, 62.5, 0,
    ]);
    for (const stop of legend)
      expect(stop.color).toBe(heatmapColor(stop.value, scale));
  });

  it('uses one neutral midpoint for a constant dataset, including zero', () => {
    for (const value of [-1, 0, 1]) {
      const scale = heatmapScale([[value, null, value]]);
      expect(scale.state).toBe('constant');
      expect(heatmapLegend(scale)).toEqual([
        { position: 0.5, value, color: 'oklch(0.6 0.15 125)' },
      ]);
      expect(heatmapColor(value, scale)).toBe('oklch(0.6 0.15 125)');
    }
  });

  it('excludes null and nonfinite results from the scale', () => {
    const missing = heatmapScale([[null, NaN, Infinity, -Infinity]]);
    expect(missing.state).toBe('missing');
    expect(heatmapLegend(missing)).toEqual([]);
    for (const value of [null, NaN, Infinity, -Infinity]) {
      expect(heatmapColor(value, missing)).toBe('transparent');
      expect(heatmapValue(value)).toBe('—');
    }
    expect(heatmapScale([[null, -2, Infinity, 3]])).toEqual({
      min: -2,
      max: 3,
      state: 'range',
    });
  });

  it('keeps numeric cell text readable across the complete sRGB ramp', () => {
    const scale = heatmapScale([[0, 100]]);
    for (let value = 0; value <= 100; value++) {
      for (const map of [
        (color: Color) => clampRgb(color),
        toGamut('rgb', 'oklch'),
      ]) {
        expect(
          wcagContrast(
            map(parse(heatmapColor(value, scale))!),
            'oklch(0.141 0.005 285.823)',
          ),
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('heatmap values', () => {
  it('retains exact metric values, units and parameter coordinates', () => {
    expect(
      heatmapCellLabel('total_return', 0.123456789, 'fast', 5, 'slow', 20),
    ).toBe('Total return: +0.123456789 fraction (1 = 100%); fast=5; slow=20');
    expect(
      heatmapCellLabel('sharpe', -0.123456789, 'fast', 5, 'slow', 20),
    ).toBe('Sharpe: -0.123456789 ratio (unitless); fast=5; slow=20');
    expect(heatmapValue(1e-9)).toBe('+1e-9');
    expect(heatmapValue(0)).toBe('0');
    expect(heatmapCellLabel('sharpe', null, 'a', 1, 'b', 2)).toBe(
      'Sharpe: no result; a=1; b=2',
    );
    expect(heatmapMetric('expectancy').unit).toBe('USD');
    expect(heatmapMetric('max_drawdown_length').unit).toBe('bars');
    expect(heatmapMetric('custom')).toEqual({
      label: 'custom',
      unit: 'raw units',
    });
  });
});

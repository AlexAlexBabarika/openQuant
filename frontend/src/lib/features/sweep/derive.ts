/**
 * Pure derivations over trial rows and walk-forward windows. No Svelte, no DOM —
 * each is independently unit-tested, the way `features/backtest/derive.ts` is.
 */
import type { TrialRow, WindowResult } from './types';

export function reconcileVariedParams(
  selected: string[],
  names: string[],
): string[] {
  const retained = selected.filter(name => names.includes(name));
  return retained.length ? retained : names.slice(0, 2);
}

const num = (v: number | string): number =>
  typeof v === 'number' ? v : Number(v);
const metric = (t: TrialRow, m: string): number => {
  const v = t.metrics[m];
  return v == null ? -Infinity : v;
};

export interface Heatmap {
  xParam: string;
  yParam: string;
  xValues: number[];
  yValues: number[];
  cells: (number | null)[][]; // [yIndex][xIndex]
  min: number;
  max: number;
}

export function heatmapMatrix(
  trials: TrialRow[],
  xParam: string,
  yParam: string,
  metricName: string,
): Heatmap {
  const xValues = [...new Set(trials.map(t => num(t.params[xParam])))].sort(
    (a, b) => a - b,
  );
  const yValues = [...new Set(trials.map(t => num(t.params[yParam])))].sort(
    (a, b) => a - b,
  );
  const xi = new Map(xValues.map((v, i) => [v, i]));
  const yi = new Map(yValues.map((v, i) => [v, i]));
  const cells: (number | null)[][] = yValues.map(() => xValues.map(() => null));
  let min = Infinity;
  let max = -Infinity;
  for (const t of trials) {
    const x = xi.get(num(t.params[xParam]));
    const y = yi.get(num(t.params[yParam]));
    if (x === undefined || y === undefined) continue;
    const v = t.metrics[metricName];
    if (v == null) continue;
    cells[y][x] = v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { xParam, yParam, xValues, yValues, cells, min, max };
}

export function sortTrials(
  trials: TrialRow[],
  metricName: string,
  dir: 'asc' | 'desc',
): TrialRow[] {
  const sign = dir === 'desc' ? -1 : 1;
  return [...trials].sort(
    (a, b) => sign * (metric(a, metricName) - metric(b, metricName)),
  );
}

export function filterTrials(
  trials: TrialRow[],
  metricName: string,
  min: number,
): TrialRow[] {
  return trials.filter(t => metric(t, metricName) >= min);
}

export interface ParallelCoords {
  axes: string[];
  lines: { trialId: number; coords: number[] }[]; // coords normalized to [0,1]
}

export function parallelCoordsModel(
  trials: TrialRow[],
  paramAxes: string[],
  metricName: string,
): ParallelCoords {
  const axes = [...paramAxes, metricName];
  const valueOf = (t: TrialRow, axis: string): number =>
    axis === metricName ? metric(t, metricName) : num(t.params[axis]);
  const ranges = axes.map(axis => {
    const vs = trials.map(t => valueOf(t, axis)).filter(Number.isFinite);
    const lo = Math.min(...vs);
    const hi = Math.max(...vs);
    return { lo, hi, span: hi - lo || 1 };
  });
  const lines = trials.map(t => ({
    trialId: t.trial_id,
    coords: axes.map((axis, i) => {
      const v = valueOf(t, axis);
      return Number.isFinite(v) ? (v - ranges[i].lo) / ranges[i].span : 0;
    }),
  }));
  return { axes, lines };
}

export interface StabilityEntry {
  values: (number | string)[];
  distinct: number;
}

export function paramStability(
  windows: WindowResult[],
  paramNames: string[],
): Record<string, StabilityEntry> {
  const out: Record<string, StabilityEntry> = {};
  for (const name of paramNames) {
    const values = windows.map(w => w.best_params[name]);
    out[name] = { values, distinct: new Set(values).size };
  }
  return out;
}

export function walkForwardAggregate(
  windows: WindowResult[],
  metricName: string,
) {
  const is = windows.map(w => w.is_metric);
  const oos = windows.map(w => {
    const v = w.oos_metrics[metricName];
    return v == null ? 0 : v;
  });
  return { is, oos };
}

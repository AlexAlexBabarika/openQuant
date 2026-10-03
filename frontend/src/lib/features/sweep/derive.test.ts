import { describe, it, expect } from 'vitest';
import {
  reconcileVariedParams,
  heatmapMatrix,
  sortTrials,
  filterTrials,
  parallelCoordsModel,
  paramStability,
} from './derive';

describe('parameter selection after an editor change', () => {
  it('removes undeclared parameters and defaults to the new schema when none remain', () => {
    expect(reconcileVariedParams(['qty'], ['fast', 'slow', 'side'])).toEqual([
      'fast',
      'slow',
    ]);
    expect(reconcileVariedParams(['qty', 'fast'], ['fast', 'slow'])).toEqual([
      'fast',
    ]);
    expect(reconcileVariedParams(['qty'], [])).toEqual([]);
  });
});
import type { TrialRow, WindowResult } from './types';

const trials: TrialRow[] = [
  {
    trial_id: 0,
    params: { a: 1, b: 10 },
    metrics: { sharpe: 0.5 },
    cached: false,
  },
  {
    trial_id: 1,
    params: { a: 1, b: 20 },
    metrics: { sharpe: 1.5 },
    cached: false,
  },
  {
    trial_id: 2,
    params: { a: 2, b: 10 },
    metrics: { sharpe: 0.9 },
    cached: false,
  },
  {
    trial_id: 3,
    params: { a: 2, b: 20 },
    metrics: { sharpe: 2.0 },
    cached: true,
  },
];

describe('heatmapMatrix', () => {
  it('lays out a 2-param grid with axes sorted and metric cells filled', () => {
    const m = heatmapMatrix(trials, 'a', 'b', 'sharpe');
    expect(m.xValues).toEqual([1, 2]); // a
    expect(m.yValues).toEqual([10, 20]); // b
    // cell[y][x]
    expect(m.cells[0][0]).toBe(0.5); // a=1,b=10
    expect(m.cells[1][1]).toBe(2.0); // a=2,b=20
    expect(m.min).toBe(0.5);
    expect(m.max).toBe(2.0);
  });
});

describe('sortTrials / filterTrials', () => {
  it('sorts by a metric descending', () => {
    const s = sortTrials(trials, 'sharpe', 'desc');
    expect(s.map(t => t.trial_id)).toEqual([3, 1, 2, 0]);
  });
  it('filters by a metric threshold', () => {
    expect(filterTrials(trials, 'sharpe', 1.0).map(t => t.trial_id)).toEqual([
      1, 3,
    ]);
  });
});

describe('parallelCoordsModel', () => {
  it('builds one normalized polyline per trial across the chosen axes', () => {
    const model = parallelCoordsModel(trials, ['a', 'b'], 'sharpe');
    expect(model.axes).toEqual(['a', 'b', 'sharpe']);
    expect(model.lines).toHaveLength(4);
    // each line has a normalized [0,1] coordinate per axis
    for (const line of model.lines) {
      expect(line.coords).toHaveLength(3);
      for (const c of line.coords) expect(c).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('paramStability', () => {
  it('reports the spread of a winning param across windows', () => {
    const windows: WindowResult[] = [
      {
        window: { index: 0, is_start: 0, is_end: 1, oos_start: 1, oos_end: 2 },
        best_params: { a: 1 },
        is_metric: 1,
        oos_metrics: {},
      },
      {
        window: { index: 1, is_start: 0, is_end: 1, oos_start: 1, oos_end: 2 },
        best_params: { a: 3 },
        is_metric: 1,
        oos_metrics: {},
      },
    ];
    const s = paramStability(windows, ['a']);
    expect(s.a.values).toEqual([1, 3]);
    expect(s.a.distinct).toBe(2); // jumped -> unstable
  });
});

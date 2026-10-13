import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { LineStyle } from 'lightweight-charts';
import InputsDiff from './InputsDiff.svelte';
import MetricsDiff from './MetricsDiff.svelte';
import LineageView from './LineageView.svelte';
import EquityOverlay from './EquityOverlay.svelte';
import TradesDiff from './TradesDiff.svelte';
import { equityComparisonLines, recordedValue } from './presentation';
import type {
  EquityOverlay as Overlay,
  RunLineage,
  TradesDiff as Trades,
} from '$lib/features/runs/runTypes';

describe('explanatory comparison', () => {
  it('distinguishes unavailable, zero, false and unknown structured values', () => {
    expect(recordedValue(null)).toBe('Unavailable');
    expect(recordedValue(undefined)).toBe('Unavailable');
    expect(recordedValue(Infinity)).toBe('Unavailable');
    expect(recordedValue(0)).toBe('0');
    expect(recordedValue(false)).toBe('false');
    expect(recordedValue({ custom: 10 })).toBe('{"custom":10}');
    expect(recordedValue(0, false)).toBe('Unavailable');
  });

  it('renders categorized recorded quality and missing holdout without claiming equality', () => {
    const lineage: RunLineage = {
      rows: [
        {
          path: 'meta.data_quality',
          label: 'Recorded data quality',
          category: 'Dataset & quality',
          a: { available: true, value: { missing_bars: 0 } },
          b: { available: true, value: { missing_bars: 2 } },
          status: 'changed',
        },
        {
          path: 'config.holdout',
          label: 'Recorded holdout',
          category: 'Date range & holdout',
          a: { available: false, value: null },
          b: { available: false, value: null },
          status: 'unavailable',
        },
      ],
      limitations: { a: [], b: [] },
    };
    const html = render(LineageView, { props: { lineage } }).body;
    expect(html).toContain('Dataset &amp; quality');
    expect(html).toContain('Date range &amp; holdout');
    expect(html).toContain('missing_bars');
    expect(html).toContain('Not comparable');
    expect(html).toContain('1 with unavailable inputs');
    expect(html).not.toContain('Same recorded value');
    expect(html).toContain(
      'do not prove reproducibility or explain performance',
    );
  });

  it('keeps absent inputs explicit and escapes unknown recorded content', () => {
    const html = render(InputsDiff, {
      props: {
        rows: [
          {
            path: 'config.custom',
            a: null,
            b: '<script>unsafe()</script>',
            available: { a: false, b: true },
            status: 'unavailable',
          },
        ],
      },
    }).body;
    expect(html).toContain('Unavailable');
    expect(html).toContain('Not comparable');
    expect(html).toContain('&lt;script>');
    expect(html).not.toContain('<script>unsafe()');
    expect(render(InputsDiff, { props: { rows: [] } }).body).toContain(
      'Missing context is unavailable, not unchanged',
    );
  });

  it('renders neutral metric deltas and unknown metrics without inventing missing evidence', () => {
    const html = render(MetricsDiff, {
      props: {
        rows: [
          {
            metric: 'turnover',
            label: 'Turnover (recorded units)',
            category: 'Turnover',
            a: 0,
            b: 1.2,
            delta: 1.2,
            abs_delta: 1.2,
            status: 'changed',
          },
          {
            metric: 'max_drawdown',
            category: 'Drawdown',
            a: null,
            b: -0.2,
            delta: null,
            abs_delta: null,
            status: 'unavailable',
          },
          {
            metric: 'unknown_metric',
            a: { detail: '<img src=x>' },
            b: false,
            delta: null,
            abs_delta: null,
          },
        ],
      },
    }).body;
    expect(html).toContain('+1.2');
    expect(html).toContain('Not comparable');
    expect(html).toContain('Other observed metrics');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img src=x>');
    expect(html).toContain('positive delta is not necessarily better');
    expect(html).toContain('do not establish which input caused');
    expect(html).not.toContain('text-emerald');
    expect(html).not.toContain('text-destructive');
  });

  it('distinguishes equity series beyond color and discloses residual coverage', () => {
    const overlay: Overlay = {
      a: [
        { t: 1, value: 100 },
        { t: 2, value: 110 },
      ],
      b: [
        { t: 2, value: 120 },
        { t: 3, value: 90 },
      ],
      residual: [{ t: 2, value: 10 }],
      alignment: { common: 1, only_a: 1, only_b: 1 },
      available: { a: true, b: true },
    };
    const lines = equityComparisonLines(overlay);
    expect(lines[0].lineStyle).toBe(LineStyle.Solid);
    expect(lines[1].lineStyle).toBe(LineStyle.Dashed);
    expect(lines[0].data).toBe(overlay.a);
    expect(lines[1].data).toBe(overlay.b);
    const html = render(EquityOverlay, { props: { overlay } }).body;
    expect(html).toContain('A solid · B dashed');
    expect(html).toContain('1 shared timestamps');
    expect(html).toContain('residuals use shared timestamps only');
    expect(html).toContain('UTC');
  });

  it('does not draw a residual from disjoint or unavailable equity', () => {
    const overlay: Overlay = {
      a: [{ t: 1, value: 100 }],
      b: [],
      residual: [],
      available: { a: true, b: false },
      alignment: { common: 0, only_a: 1, only_b: 0 },
    };
    const html = render(EquityOverlay, { props: { overlay } }).body;
    expect(html).toContain('B: Unavailable');
    expect(html).toContain('no shared recorded equity points');
  });

  it('shows duplicate trade occurrences, unknown path fields and incomplete records', () => {
    const trades: Trades = {
      changed: [1, 2].map(occurrence => ({
        key: ['AAPL', 't1', 'buy'],
        occurrence,
        fields: { custom_fill: { a: 'auction', b: 'close' } },
      })),
      unchanged: [],
      unavailable: [
        {
          key: ['MSFT', 't2', 'buy'],
          occurrence: 1,
          fields: { quantity: { a: null, b: 0, status: 'unavailable' } },
        },
      ],
      only_in_a: [],
      only_in_b: [
        {
          key: ['AAPL', 't1', 'buy'],
          occurrence: 3,
          trade: { pnl: 2, custom_field: '<script>unsafe()</script>' },
        },
      ],
      count: { a: 3, b: 4 },
      available: { a: true, b: true },
    };
    const html = render(TradesDiff, { props: { trades } }).body;
    expect(html).toContain('occurrence 1');
    expect(html).toContain('occurrence 2');
    expect(html).toContain('occurrence 3');
    expect(html).toContain('custom_fill');
    expect(html).toContain('Not comparable');
    expect(html).toContain('Incomplete recorded fields');
    expect(html).toContain('not execution identity or causal attribution');
    expect(html).not.toContain('<script>unsafe()');
  });

  it('does not describe absent trade history as zero trades', () => {
    const trades: Trades = {
      changed: [],
      unchanged: [],
      only_in_a: [],
      only_in_b: [],
      available: { a: false, b: true },
      count: { a: null, b: 0 },
    };
    const html = render(TradesDiff, { props: { trades } }).body;
    expect(html).toContain('A: Unavailable');
    expect(html).toContain('B: 0');
    expect(html).toContain('missing paths are not treated as zero trades');
  });

  it('accepts legacy comparison payloads without new optional metadata', () => {
    const html = render(MetricsDiff, {
      props: {
        rows: [{ metric: 'legacy', a: 1, b: 2, delta: 1, abs_delta: 1 }],
      },
    }).body;
    expect(html).toContain('legacy');
    expect(html).toContain('+1');
    const trades = { changed: [], unchanged: [], only_in_a: [], only_in_b: [] };
    expect(render(TradesDiff, { props: { trades } }).body).toContain(
      'Unavailable',
    );
  });
});

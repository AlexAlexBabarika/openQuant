import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import LineageView from '../../../components/backtest/compare/LineageView.svelte';
import RecentRunsPanel from '../../../components/backtest/RecentRunsPanel.svelte';
import type { RunLineage } from './runTypes';

const lineage: RunLineage = {
  rows: [
    {
      path: 'params',
      label: 'Resolved parameters',
      a: { available: true, value: { window: 10 } },
      b: { available: true, value: { window: 20 } },
      status: 'changed',
    },
    {
      path: 'meta.seed',
      label: 'Random seed',
      a: { available: true, value: 0 },
      b: { available: false, value: null },
      status: 'unavailable',
    },
    {
      path: 'config.universe',
      label: 'Portfolio universe',
      a: { available: true, value: null },
      b: { available: true, value: null },
      status: 'unchanged',
    },
  ],
  limitations: {
    a: [],
    b: [
      'Random seed was not recorded; original replay assumptions cannot be verified.',
    ],
  },
};

describe('experiment lineage', () => {
  it('distinguishes account-scoped notebook metadata from shared server snapshots', () => {
    const html = render(RecentRunsPanel, {
      props: { open: true, onOpenRun: () => {}, onCompare: () => {} },
    }).body;
    expect(html).toContain('separated by account');
    expect(html).toContain('server-local and not account-scoped');
    expect(html).not.toContain('original account');
  });
  it('renders changed, unavailable and explicitly empty metadata distinctly', () => {
    const html = render(LineageView, { props: { lineage } }).body;
    for (const text of [
      'What changed?',
      '1 changed',
      '1 with unavailable inputs',
      'Resolved parameters',
      'window',
      '20',
      'Random seed',
      '>0<',
      'Unavailable',
      'Not comparable',
      'None (recorded)',
      'Same recorded value',
      'Run B',
      'Random seed was not recorded',
    ]) {
      expect(html).toContain(text);
    }
  });

  it('states limits rather than promising exact replay or causal performance attribution', () => {
    const html = render(LineageView, { props: { lineage } }).body;
    for (const text of [
      'not proof of reproducibility',
      'defaults from overrides',
      'current engine',
      'Original provider state',
      'runtime/dependency versions',
      'exact historical reproduction is not guaranteed',
    ])
      expect(html).toContain(text);
  });

  it('keeps a missing legacy payload distinct from a comparison with no changes', () => {
    const html = render(LineageView).body;
    expect(html).toContain('Lineage is unavailable');
    expect(html).toContain('Numerical differences remain available');
    expect(html).not.toContain('0 changed');
  });

  it('escapes stored labels and values rather than interpreting them as markup', () => {
    const html = render(LineageView, {
      props: {
        lineage: {
          ...lineage,
          rows: [
            {
              path: 'name',
              label: '<script>bad()</script>',
              a: { available: true, value: '<img src=x onerror=bad()>' },
              b: { available: true, value: 'safe' },
              status: 'changed',
            },
          ],
        },
      },
    }).body;
    expect(html).not.toContain('<script>bad()');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script>');
    expect(html).toContain('&lt;img');
  });
});

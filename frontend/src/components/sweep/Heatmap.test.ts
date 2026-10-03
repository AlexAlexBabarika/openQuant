import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Heatmap from './Heatmap.svelte';
import type { TrialRow } from '$lib/features/sweep/types';

const trial = (
  id: number,
  a: number,
  b: number,
  value: number | null,
): TrialRow => ({
  trial_id: id,
  params: { a, b },
  metrics: { sharpe: value },
  cached: false,
});
const output = (trials: TrialRow[], ontrial?: (id: number) => void) =>
  render(Heatmap, {
    props: { trials, xParam: 'a', yParam: 'b', metric: 'sharpe', ontrial },
  }).body;
const elements = (html: string, tag: string) => [
  ...html.matchAll(
    new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`, 'g'),
  ),
];
const attribute = (attrs: string, name: string) =>
  attrs.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

describe('rendered heatmap', () => {
  it('gives the five legend samples exactly the same colors as their cells', () => {
    const html = output([-2, -1, 0, 1, 2].map((v, i) => trial(i, i, 1, v)));
    const cells = elements(html, 'button');
    const swatches = elements(html, 'span').filter(e =>
      attribute(e[1], 'class')?.split(' ').includes('swatch'),
    );
    expect(cells).toHaveLength(5);
    expect(swatches).toHaveLength(5);
    expect(swatches.map(e => attribute(e[1], 'style'))).toEqual(
      cells.map(e => attribute(e[1], 'style')),
    );
    expect(html).toContain(
      'Low → high numeric value; color is not profitability.',
    );
  });

  it('renders signed, unrounded values and exposes units and coordinates in each accessible name', () => {
    const cells = elements(
      output([trial(1, 5, 20, -0.123456789), trial(2, 10, 20, 0.000001)]),
      'button',
    );
    expect(attribute(cells[0][1], 'aria-label')).toBe(
      'Sharpe: -0.123456789 ratio (unitless); a=5; b=20',
    );
    expect(cells[0][2]).toBe('-0.123456789');
    expect(cells[1][2]).toBe('+0.000001');
  });

  it('marks holes and missing/nonfinite results with visible text and no-result names', () => {
    const cells = elements(
      output(
        [trial(1, 1, 1, 2), trial(2, 2, 2, null), trial(3, 3, 2, Infinity)],
        () => {},
      ),
      'button',
    );
    expect(cells).toHaveLength(6);
    const missing = cells.filter(e =>
      attribute(e[1], 'aria-label')?.includes('no result'),
    );
    expect(missing).toHaveLength(5);
    for (const cell of missing) {
      expect(cell[2]).toBe('—');
      expect(attribute(cell[1], 'style')).toBe('background:transparent');
    }
    expect(
      missing.find(e =>
        attribute(e[1], 'aria-label')?.endsWith('a=2; b=1'),
      )?.[1],
    ).toMatch(/\bdisabled\b/);
  });

  it('explains a constant scale, no-result scale, and empty dataset', () => {
    const constant = output([trial(1, 1, 1, 0), trial(2, 2, 1, 0)]);
    expect(constant).toContain('All finite results equal 0 ratio (unitless).');
    expect(
      elements(constant, 'button').map(e => attribute(e[1], 'style')),
    ).toEqual([
      'background:oklch(0.6 0.15 125)',
      'background:oklch(0.6 0.15 125)',
    ]);
    for (const trials of [[], [trial(1, 1, 1, null)], [trial(1, 1, 1, NaN)]]) {
      const html = output(trials);
      expect(html).toContain('No finite results for Sharpe.');
      expect(html).not.toMatch(/Infinity|NaN/);
    }
  });

  it('does not offer an action when no trial loader exists', () => {
    expect(elements(output([trial(1, 1, 1, 0)]), 'button')[0][1]).toMatch(
      /\bdisabled\b/,
    );
    expect(
      elements(
        output([trial(1, 1, 1, 0)], () => {}),
        'button',
      )[0][1],
    ).not.toMatch(/\bdisabled\b/);
  });
});

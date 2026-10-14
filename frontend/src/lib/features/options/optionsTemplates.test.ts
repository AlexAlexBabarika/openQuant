import { describe, expect, it } from 'vitest';
import {
  createOptionsDraft,
  OPTIONS_TEMPLATES,
  spotGrid,
  templateStrategy,
} from './optionsTemplates';
import { optionsErrors } from './optionsState.svelte';

describe('manual options templates', () => {
  it.each(OPTIONS_TEMPLATES)('creates bounded editable %s legs', id => {
    const d = createOptionsDraft();
    d.strategy = templateStrategy(id);
    expect(optionsErrors(d)).toEqual({});
    expect(d.strategy.legs.every(l => l.enabled)).toBe(true);
    expect(d.strategy.exercise_style).toBe('european');
    expect(d.strategy.settlement).toBe('cash');
    expect(d.strategy.currency).toBe('USD');
  });
  it('has independent drafts without provider or stock context', () => {
    const a = createOptionsDraft();
    const b = createOptionsDraft();
    a.strategy.legs[0].quantity = 9;
    expect(b.strategy.legs[0].quantity).toBe(1);
    expect(b.spot).toBe(100);
    expect(b.spot_grid).toHaveLength(81);
  });
  it('matches stock coverage exactly with signed option legs', () => {
    for (const id of ['covered_call', 'protective_put'] as const) {
      const [stock, option] = templateStrategy(id, 120).legs;
      expect(stock.kind).toBe('underlying');
      expect(stock.quantity).toBe(
        Math.abs(option.quantity) * option.multiplier,
      );
      expect(stock.multiplier).toBe(1);
      expect(stock.strike).toBeNull();
      expect(stock.entry_premium).toBe(120);
      expect(option.quantity).toBe(id === 'covered_call' ? -1 : 1);
    }
  });
  it('balances verticals and butterfly exposure, with iron-condor outer long wings', () => {
    for (const id of [
      'bull_call',
      'bear_call',
      'bull_put',
      'bear_put',
      'butterfly',
    ] as const)
      expect(
        templateStrategy(id).legs.reduce((q, l) => q + l.quantity, 0),
      ).toBe(0);
    const condor = templateStrategy('iron_condor').legs;
    expect(condor.map(l => l.quantity)).toEqual([1, -1, -1, 1]);
    condor.forEach((l, i) =>
      expect(l.strike).toBeCloseTo([80, 90, 110, 120][i]),
    );
    const fly = templateStrategy('iron_butterfly').legs;
    expect(fly[1].strike).toBe(fly[2].strike);
  });
  it('keeps strikes bounded at extreme allowed spots', () => {
    for (const spot of [0.000001, 1000000]) {
      for (const [id] of OPTIONS_TEMPLATES) {
        const d = createOptionsDraft();
        d.spot = spot;
        d.strategy = templateStrategy(id, spot);
        expect(optionsErrors(d)).toEqual({});
      }
    }
  });
  it('builds an aligned bounded display grid with exact endpoints', () => {
    const grid = spotGrid(0, 1000000, 201);
    expect(grid).toHaveLength(201);
    expect(grid[0]).toBe(0);
    expect(grid[200]).toBe(1000000);
    expect(grid.slice(1).every((s, i) => s > grid[i])).toBe(true);
  });
});

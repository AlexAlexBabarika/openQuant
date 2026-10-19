import { describe, expect, it } from 'vitest';
import {
  createOptionsDraft,
  OPTIONS_TEMPLATES,
  spotGrid,
  templateStrategy,
  applyOptionsTemplate,
  templateGlyph,
} from './optionsTemplates';
import { optionsErrors } from './optionsState.svelte';

describe('manual options templates', () => {
  it.each(OPTIONS_TEMPLATES)(
    'replaces %s legs without dropping manual metadata or request assumptions',
    id => {
      const d = createOptionsDraft();
      Object.assign(d.strategy, {
        underlying: 'Manual index',
        valuation_date: '2026-10-14',
        expiry_date: '2026-11-13',
        days_to_expiry: 30,
        entry_fee_per_contract: 0.65,
      });
      d.scenarios = [{ name: 'Later', elapsed_days: 2, iv_shift_pp: 5 }];
      d.surface = { axis: 'elapsed_days', spots: [50, 150], steps: [0, 30] };
      const before = structuredClone(d);
      applyOptionsTemplate(d, id);
      expect(d.strategy.legs).toEqual(templateStrategy(id, d.spot).legs);
      expect({
        ...d,
        strategy: {
          ...d.strategy,
          name: before.strategy.name,
          template: before.strategy.template,
          legs: before.strategy.legs,
        },
      }).toEqual(before);
      expect(optionsErrors(d)).toEqual({});
    },
  );
  it('uses a bounded synthetic seed without silently repairing an invalid request spot', () => {
    for (const spot of [NaN, Infinity, -5, 0, 1000001]) {
      const d = createOptionsDraft();
      d.spot = spot;
      applyOptionsTemplate(d, 'iron_condor');
      expect(d.strategy.legs).toEqual(
        templateStrategy('iron_condor', 100).legs,
      );
      expect(Object.is(d.spot, spot)).toBe(true);
      expect(optionsErrors(d).spot).toBeTruthy();
    }
  });
  it.each(OPTIONS_TEMPLATES)('creates bounded editable %s legs', id => {
    const d = createOptionsDraft();
    d.strategy = templateStrategy(id);
    expect(optionsErrors(d)).toEqual({});
    expect(d.strategy.legs.every(l => l.enabled)).toBe(true);
    expect(d.strategy.exercise_style).toBe('european');
    expect(d.strategy.settlement).toBe('cash');
    expect(d.strategy.currency).toBe('USD');
  });
  it('rounds strikes to round steps and premiums to cents', () => {
    const strikes = (spot: number) =>
      templateStrategy('iron_condor', spot).legs.map(l => l.strike);
    expect(strikes(100)).toEqual([87.5, 95, 105, 112.5]);
    expect(strikes(343.46)).toEqual([305, 325, 365, 385]);
    expect(
      templateStrategy('iron_condor', 343.46).legs.map(l => l.entry_premium),
    ).toEqual([3.43, 10.3, 10.3, 3.43]);
  });
  it('sizes spreads and wings to one and two expected moves (spot × IV × √years)', () => {
    const condor = (iv: number, days: number) =>
      templateStrategy('iron_condor', 343.46, iv, days).legs.map(
        l => l.strike!,
      );
    const width = (strikes: number[]) => strikes[3] - strikes[0];
    expect(width(condor(0.4, 30))).toBeGreaterThan(
      1.8 * width(condor(0.2, 30)),
    );
    expect(width(condor(0.2, 120))).toBeGreaterThan(
      1.8 * width(condor(0.2, 30)),
    );
    // Unusable or zero inputs still give a bounded, distinct, valid condor.
    expect(condor(NaN, 30)).toEqual(condor(0.2, 30));
    for (const [iv, days] of [
      [0, 0],
      [5, 3650],
    ])
      for (const spot of [1, 343.46, 833333]) {
        const d = createOptionsDraft();
        d.spot = spot;
        d.strategy = templateStrategy('iron_condor', spot, iv, days);
        const strikes = d.strategy.legs.map(l => l.strike);
        expect(new Set(strikes).size).toBe(4);
        expect(optionsErrors(d)).toEqual({});
      }
  });
  it.each(OPTIONS_TEMPLATES)(
    'keeps %s strikes short decimals and distinct at any spot',
    id => {
      const options = (spot: number) =>
        templateStrategy(id, spot).legs.filter(l => l.kind !== 'underlying');
      const distinct = (spot: number) =>
        new Set(options(spot).map(l => l.strike)).size;
      for (const spot of [1, 17.3, 343.46, 5123.7]) {
        for (const leg of options(spot)) {
          expect(String(leg.strike)).toMatch(/^\d+(\.\d{1,3})?$/);
          expect(String(leg.entry_premium)).toMatch(/^\d+(\.\d{1,2})?$/);
        }
        expect(distinct(spot)).toBe(distinct(100));
      }
    },
  );
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
      expect(l.strike).toBeCloseTo([87.5, 95, 105, 112.5][i]),
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

describe('templateGlyph', () => {
  const ys = (path: string) =>
    path
      .slice(1)
      .split('L')
      .map(p => Number(p.split(',')[1]));

  it('draws each template by its own expiry payoff shape', () => {
    const call = ys(templateGlyph('long_call'));
    expect(call[0]).toBe(16);
    expect(call[1]).toBe(16);
    expect(call[call.length - 1]).toBe(2);
    const put = ys(templateGlyph('long_put'));
    expect(put[0]).toBe(2);
    expect(put[put.length - 1]).toBe(16);
    const condor = ys(templateGlyph('iron_condor'));
    expect(Math.min(...condor)).toBe(2);
    expect(condor[0]).toBe(16);
    expect(condor[condor.length - 1]).toBe(16);
  });

  it('stays inside its 100 × 18 box', () => {
    for (const [id] of OPTIONS_TEMPLATES) {
      const path = templateGlyph(id);
      expect(path).toMatch(/^M[\d.]+,[\d.]+(L[\d.]+,[\d.]+)+$/);
      for (const y of ys(path)) expect(y >= 2 && y <= 16).toBe(true);
    }
  });
});

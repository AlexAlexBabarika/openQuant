import { describe, expect, it } from 'vitest';
import { fitPriceDomain, fittedSpotGrid, needsRefit } from './optionsGrid';
import { expiryBreakevens } from './optionsPayoff';
import {
  applyOptionsTemplate,
  createOptionsDraft,
  spotGrid,
} from './optionsTemplates';
import type { OptionsDraft } from './optionsTypes';

function draftWith(update: (d: OptionsDraft) => void): OptionsDraft {
  const draft = createOptionsDraft();
  update(draft);
  return draft;
}

describe('fitPriceDomain', () => {
  it('covers every strike and spot for an AAPL iron condor', () => {
    const domain = fitPriceDomain(343.46, [275, 310, 380, 410])!;
    expect(domain.min).toBeGreaterThanOrEqual(0);
    expect(domain.min).toBeLessThan(275);
    expect(domain.max).toBeGreaterThan(410);
  });

  it('pads a single strike at spot by 6% of spot', () => {
    expect(fitPriceDomain(100, [100])).toEqual({ min: 94, max: 106 });
  });

  it('includes breakevens and never goes below zero', () => {
    expect(fitPriceDomain(100, [100], [112])!.max).toBeGreaterThan(112);
    expect(fitPriceDomain(5, [1, 10])!.min).toBe(0);
  });
});

describe('expiryBreakevens', () => {
  it('finds the long call breakeven at strike plus premium', () => {
    expect(expiryBreakevens(createOptionsDraft())).toEqual([105]);
  });

  it('finds both iron condor breakevens from the net credit', () => {
    const draft = draftWith(d => applyOptionsTemplate(d, 'iron_condor'));
    // Long 80P @1, short 90P @3, short 110C @3, long 120C @1: credit 4.
    expect(expiryBreakevens(draft)).toEqual([86, 114]);
  });

  it('treats shares linearly in a covered call', () => {
    const draft = draftWith(d => applyOptionsTemplate(d, 'covered_call'));
    // 100 shares @100, short 110C @2: breakeven 98.
    expect(expiryBreakevens(draft)).toEqual([98]);
  });

  it('charges entry fees once per option contract', () => {
    const draft = draftWith(d => {
      d.strategy.entry_fee_per_contract = 100;
    });
    expect(expiryBreakevens(draft)).toEqual([106]);
  });

  it('ignores disabled legs', () => {
    const draft = draftWith(d => {
      applyOptionsTemplate(d, 'straddle');
      d.strategy.legs[1].enabled = false;
    });
    expect(expiryBreakevens(draft)).toEqual([105]);
  });

  it('returns nothing for mixed expiries', () => {
    const draft = draftWith(d => {
      applyOptionsTemplate(d, 'straddle');
      d.strategy.legs[1].days_to_expiry = 60;
    });
    expect(expiryBreakevens(draft)).toEqual([]);
  });
});

describe('fittedSpotGrid', () => {
  it('spans strikes, spot and breakevens with 81 points', () => {
    const grid = fittedSpotGrid(createOptionsDraft());
    expect(grid).toHaveLength(81);
    expect(grid[0]).toBe(94);
    expect(grid[80]).toBe(111);
  });

  it('frames an AAPL iron condor around its strikes', () => {
    const draft = draftWith(d => {
      d.spot = 343.46;
      applyOptionsTemplate(d, 'iron_condor');
    });
    const grid = fittedSpotGrid(draft);
    expect(grid[0]).toBeLessThan(275);
    expect(grid[80]).toBeGreaterThan(410);
  });
});

describe('needsRefit', () => {
  const before = draftWith(d => {
    d.spot_grid = spotGrid(50, 150);
  });

  it('keeps the grid when a strike moves inside it', () => {
    const after = structuredClone(before);
    after.strategy.legs[0].strike = 105;
    expect(needsRefit(before, after)).toBe(false);
  });

  it('refits when spot changes', () => {
    const after = structuredClone(before);
    after.spot = 343.46;
    expect(needsRefit(before, after)).toBe(true);
  });

  it('refits when the legs change shape', () => {
    const after = structuredClone(before);
    applyOptionsTemplate(after, 'iron_condor');
    expect(needsRefit(before, after)).toBe(true);
  });

  it('refits when a strike leaves the inner 90% of the grid', () => {
    const after = structuredClone(before);
    after.strategy.legs[0].strike = 146;
    expect(needsRefit(before, after)).toBe(true);
  });
});

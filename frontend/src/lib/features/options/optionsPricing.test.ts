import { describe, expect, it } from 'vitest';
import {
  carryModelTags,
  modelPricingRequest,
  modelUnitPrices,
  pricingKey,
} from './optionsPricing';
import { applyOptionsTemplate, createOptionsDraft } from './optionsTemplates';
import type { OptionsAnalysis } from './optionsTypes';
import { optionsErrors } from './optionsValidation';

function analysisWith(
  legs: { quantity: number; multiplier: number; value: number }[],
): OptionsAnalysis {
  const draft = createOptionsDraft();
  draft.strategy.legs = legs.map(l => ({
    kind: 'call',
    quantity: l.quantity,
    strike: 100,
    entry_premium: 0,
    multiplier: l.multiplier,
    enabled: true,
  }));
  return {
    request: draft,
    legs: legs.map((l, i) => ({
      leg_index: i,
      enabled: true,
      resolved_implied_volatility: 0.2,
      gross_entry_cost: 0,
      entry_fees: 0,
      net_entry_cost: 0,
      theoretical_value_today: l.value,
      pnl_today: l.value,
      greeks: { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 },
    })),
  } as unknown as OptionsAnalysis;
}

describe('modelUnitPrices', () => {
  it('turns signed leg values into per-unit prices in cents', () => {
    expect(
      modelUnitPrices(
        analysisWith([
          { quantity: -2, multiplier: 100, value: -482 },
          { quantity: 1, multiplier: 100, value: 241.234 },
        ]),
      ),
    ).toEqual([2.41, 2.41]);
  });

  it('reports unavailable values as null, never zero', () => {
    expect(
      modelUnitPrices(
        analysisWith([{ quantity: 1, multiplier: 100, value: Number.NaN }]),
      ),
    ).toEqual([null]);
  });
});

describe('modelPricingRequest', () => {
  it('prices every leg, including disabled ones, with a minimal valid grid', () => {
    const draft = createOptionsDraft();
    applyOptionsTemplate(draft, 'straddle');
    draft.strategy.legs[1].enabled = false;
    draft.scenarios = [{ name: 'Later', elapsed_days: 5, iv_shift_pp: 0 }];
    const request = modelPricingRequest(draft);
    expect(request.strategy.legs.every(l => l.enabled)).toBe(true);
    expect(request.spot_grid).toEqual([50, 150]);
    expect(request.scenarios).toEqual([]);
    expect(optionsErrors(request)).toEqual({});
    expect(draft.strategy.legs[1].enabled).toBe(false);
  });
});

describe('pricingKey', () => {
  it('ignores premiums but not contracts or assumptions', () => {
    const draft = createOptionsDraft();
    const key = pricingKey(draft, [true]);
    const premium = structuredClone(draft);
    premium.strategy.legs[0].entry_premium = 9;
    expect(pricingKey(premium, [true])).toBe(key);
    const strike = structuredClone(draft);
    strike.strategy.legs[0].strike = 105;
    expect(pricingKey(strike, [true])).not.toBe(key);
    const iv = structuredClone(draft);
    iv.volatility = 0.3;
    expect(pricingKey(iv, [true])).not.toBe(key);
    expect(pricingKey(draft, [false])).not.toBe(key);
  });
});

describe('carryModelTags', () => {
  it('keeps tags through contract edits and drops them when a premium is typed', () => {
    const before = createOptionsDraft();
    applyOptionsTemplate(before, 'bull_call');
    const after = structuredClone(before);
    after.strategy.legs[0].strike = 95;
    after.strategy.legs[1].entry_premium = 7;
    expect(carryModelTags(before, after, [true, true])).toEqual([true, false]);
  });

  it('follows unchanged legs when legs are added or removed elsewhere', () => {
    const before = createOptionsDraft();
    applyOptionsTemplate(before, 'bull_call');
    const appended = structuredClone(before);
    appended.strategy.legs.push({ ...before.strategy.legs[0], strike: 130 });
    expect(carryModelTags(before, appended, [true, false])).toEqual([
      true,
      false,
      false,
    ]);
    const removed = structuredClone(before);
    removed.strategy.legs.splice(0, 1);
    expect(carryModelTags(before, removed, [true, false])).toEqual([false]);
  });
});

describe('malformed pricing replies', () => {
  it('yields no prices instead of throwing', () => {
    expect(modelUnitPrices({} as OptionsAnalysis)).toEqual([]);
  });
});

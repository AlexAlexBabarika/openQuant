import { describe, expect, it } from 'vitest';
import { optionsErrors, workingDraftShape } from './optionsValidation';
import { createOptionsDraft } from './optionsTemplates';
import type { OptionsDraft } from './optionsTypes';

describe('expanded canonical frontend bounds', () => {
  it('accepts paired leap-year dates, manual quotes and independent leg IV without implying premiums', () => {
    const d = createOptionsDraft();
    Object.assign(d.strategy, {
      underlying: 'Manual index',
      valuation_date: '2024-02-28',
      expiry_date: '2024-03-01',
      days_to_expiry: 2,
    });
    Object.assign(d.strategy.legs[0], {
      implied_volatility: 0.3,
      bid: 3,
      ask: 5,
      quote_as_of: '2024-02-28T12:30:01.123456+02:30',
    });
    d.scenarios = [{ name: 'shift', elapsed_days: 2, iv_shift_pp: 5 }];
    d.surface = { axis: 'iv_shift_pp', spots: [0, 1000000], steps: [-20, 100] };
    const before = structuredClone(d);
    expect(optionsErrors(d)).toEqual({});
    expect(d).toEqual(before);
  });
  it.each([
    ['strategy.underlying', (d: OptionsDraft) => (d.strategy.underlying = ' ')],
    [
      'strategy.underlying',
      (d: OptionsDraft) => (d.strategy.underlying = 'x'.repeat(81)),
    ],
    [
      'strategy.valuation_date',
      (d: OptionsDraft) => (d.strategy.expiry_date = '2024-02-29'),
    ],
    [
      'strategy.expiry_date',
      (d: OptionsDraft) =>
        Object.assign(d.strategy, {
          valuation_date: '2024-02-01',
          expiry_date: '2024-02-30',
        }),
    ],
    [
      'strategy.valuation_date',
      (d: OptionsDraft) =>
        Object.assign(d.strategy, {
          valuation_date: '0000-01-01',
          expiry_date: '0000-01-31',
        }),
    ],
    [
      'strategy.expiry_date',
      (d: OptionsDraft) =>
        Object.assign(d.strategy, {
          valuation_date: '2024-02-02',
          expiry_date: '2024-02-01',
          days_to_expiry: 0,
        }),
    ],
    [
      'strategy.expiry_date',
      (d: OptionsDraft) =>
        Object.assign(d.strategy, {
          valuation_date: '2024-02-01',
          expiry_date: '2024-02-02',
          days_to_expiry: 30,
        }),
    ],
    [
      'legs.0.implied_volatility',
      (d: OptionsDraft) => (d.strategy.legs[0].implied_volatility = 5.1),
    ],
    ['legs.0.bid', (d: OptionsDraft) => (d.strategy.legs[0].bid = 5)],
    [
      'legs.0.bid',
      (d: OptionsDraft) =>
        Object.assign(d.strategy.legs[0], {
          bid: 5,
          ask: 4,
          quote_as_of: '2024-02-29T12:00Z',
        }),
    ],
    [
      'legs.0.bid',
      (d: OptionsDraft) =>
        Object.assign(d.strategy.legs[0], { bid: 3, ask: 4 }),
    ],
    [
      'legs.0.ask',
      (d: OptionsDraft) =>
        Object.assign(d.strategy.legs[0], {
          bid: 3,
          ask: Infinity,
          quote_as_of: '2024-02-29T12:00Z',
        }),
    ],
    [
      'legs.0.quote_as_of',
      (d: OptionsDraft) =>
        (d.strategy.legs[0].quote_as_of = '2023-02-29T12:00Z'),
    ],
    [
      'legs.0.quote_as_of',
      (d: OptionsDraft) =>
        (d.strategy.legs[0].quote_as_of = '2024-02-29T24:00Z'),
    ],
    [
      'legs.0.quote_as_of',
      (d: OptionsDraft) =>
        (d.strategy.legs[0].quote_as_of = '2024-02-29T12:00+24:00'),
    ],
    [
      'legs.0.quote_as_of',
      (d: OptionsDraft) =>
        (d.strategy.legs[0].quote_as_of = '2024-02-29T12:00'),
    ],
    [
      'legs.0.implied_volatility',
      (d: OptionsDraft) =>
        Object.assign(d.strategy.legs[0], {
          kind: 'underlying',
          strike: null,
          multiplier: 1,
          quote_as_of: '2024-02-29T12:00Z',
        }),
    ],
    [
      'scenarios.0.iv_shift_pp',
      (d: OptionsDraft) => {
        d.strategy.legs[0].implied_volatility = 0.01;
        d.scenarios = [
          { name: 'negative leg IV', elapsed_days: 0, iv_shift_pp: -2 },
        ];
      },
    ],
    [
      'surface.steps',
      (d: OptionsDraft) => {
        d.strategy.legs[0].implied_volatility = 4.99;
        d.surface = { axis: 'iv_shift_pp', spots: [50, 150], steps: [0, 2] };
      },
    ],
    [
      'surface.steps',
      (d: OptionsDraft) =>
        (d.surface = { axis: 'elapsed_days', spots: [0, 1], steps: [0, 31] }),
    ],
    [
      'surface.steps',
      (d: OptionsDraft) =>
        (d.surface = { axis: 'elapsed_days', spots: [0, 1], steps: [0, 0] }),
    ],
    [
      'surface.spots',
      (d: OptionsDraft) =>
        (d.surface = { axis: 'elapsed_days', spots: [2, 1], steps: [0, 1] }),
    ],
    [
      'surface.spots',
      (d: OptionsDraft) =>
        (d.surface = {
          axis: 'elapsed_days',
          spots: [0, 1000001],
          steps: [0, 1],
        }),
    ],
    [
      'surface.axis',
      (d: OptionsDraft) =>
        (d.surface = {
          axis: 'bad' as 'elapsed_days',
          spots: [0, 1],
          steps: [0, 1],
        }),
    ],
  ])('rejects invalid expanded field %s', (key, update) => {
    const d = createOptionsDraft();
    update(d);
    expect(optionsErrors(d)[key]).toBeTruthy();
  });
  it('allows timestamp-only metadata and ignores disabled leg IV in shifts', () => {
    const d = createOptionsDraft();
    d.strategy.legs[0].quote_as_of = '2024-02-29T12:30Z';
    d.strategy.legs.push({
      ...d.strategy.legs[0],
      enabled: false,
      implied_volatility: 0,
    });
    d.scenarios = [{ name: 'down', elapsed_days: 0, iv_shift_pp: -20 }];
    expect(optionsErrors(d)).toEqual({});
  });
  it('accepts the maximum 861-cell surface configuration and rejects size/nonfinite extensions', () => {
    const d = createOptionsDraft();
    d.surface = {
      axis: 'elapsed_days',
      spots: Array.from({ length: 41 }, (_, i) => i),
      steps: Array.from({ length: 21 }, (_, i) => i),
    };
    expect(optionsErrors(d)).toEqual({});
    d.surface.spots.push(41);
    expect(optionsErrors(d)['surface.spots']).toBeTruthy();
    d.surface.spots.pop();
    d.surface.steps.push(21);
    expect(optionsErrors(d)['surface.steps']).toBeTruthy();
    d.surface.steps.pop();
    d.surface.steps[0] = NaN;
    expect(optionsErrors(d)['surface.steps']).toBeTruthy();
  });
  it('allows structurally bounded incomplete fields for recovery but forbids noncanonical fields', () => {
    const d = createOptionsDraft();
    d.spot = NaN;
    d.strategy.name = '';
    d.strategy.legs = [];
    expect(workingDraftShape(d)).toBe(true);
    expect(optionsErrors(d)).not.toEqual({});
    expect(optionsErrors({} as OptionsDraft).draft).toBeTruthy();
    expect(workingDraftShape({ ...d, unexpected: true })).toBe(false);
    const leg = createOptionsDraft();
    Object.assign(leg.strategy.legs[0], { expiry_date: '2024-01-01' });
    expect(optionsErrors(leg).draft).toBeTruthy();
  });
});

import { readFileSync } from 'node:fs';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearAccessToken, setAccessToken } from '$lib/core/api';
import OptionsFinder from '../../../components/options/OptionsFinder.svelte';
import {
  applyFinderCandidate,
  editFinderContract,
  finderErrors,
  manualFinderContract,
  OptionsToolFlight,
  parseFinderSpots,
  seedFinderUniverse,
} from './optionsFinder';
import type { FinderCandidate, FinderRequest } from './optionsResearchTypes';
import { createOptionsDraft } from './optionsTemplates';

const request = (): FinderRequest => {
  const analysis = createOptionsDraft();
  return {
    analysis,
    universe: seedFinderUniverse(analysis),
    thesis: 'neutral',
    constraints: { max_entry_debit: 1000, max_loss: 1000 },
    scenario_spots: [80, 100, 120],
  };
};
const candidate = (r: FinderRequest): FinderCandidate => ({
  candidate_id: 'test-candidate',
  rank: 1,
  score: 0,
  request: structuredClone(r.analysis),
  summary: {
    gross_entry_cost: 0,
    entry_fees: 0,
    net_entry_cost: 0,
    entry_debit: 0,
    entry_credit: 0,
    theoretical_value_today: 0,
    pnl_today: 0,
    max_profit: null,
    max_loss: 0,
    profit_unbounded: true,
    loss_unbounded: false,
    breakevens: [],
    zero_intervals: [],
  },
  evidence: [{ spot: 100, elapsed_days: 30, pnl: 0 }],
});

afterEach(() => {
  clearAccessToken();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('explicit bounded finder universe', () => {
  it('seeds enabled options only and normalizes search units without changing signed drafts', () => {
    const draft = createOptionsDraft();
    const leg = draft.strategy.legs[0];
    leg.quantity = -3;
    leg.implied_volatility = 0;
    draft.strategy.legs.push({ ...leg, enabled: false });
    draft.strategy.legs.push({
      kind: 'underlying',
      quantity: -10,
      entry_premium: 100,
      multiplier: 1,
      strike: null,
      enabled: true,
    });
    const seeded = seedFinderUniverse(draft);
    expect(seeded).toHaveLength(1);
    expect(seeded[0].quantity).toBe(1);
    expect(seeded[0].implied_volatility).toBe(0);
    seeded[0].entry_premium = 0;
    expect(leg.quantity).toBe(-3);
    expect(leg.entry_premium).not.toBe(0);
  });
  it('requires an explicit manual premium, not a guessed model price', () => {
    const r = request();
    r.universe = [manualFinderContract(r.analysis)];
    expect(finderErrors(r)['universe.0.entry_premium']).toBeTruthy();
    r.universe[0].entry_premium = 0;
    expect(finderErrors(r)).toEqual({});
  });
  it('asks for contract expiry dates when the strategy is dated without a common expiry', () => {
    const r = request();
    r.analysis.strategy.valuation_date = '2026-10-17';
    r.analysis.strategy.legs[0].expiry_date = '2026-11-16';
    r.universe = [manualFinderContract(r.analysis)];
    r.universe[0].entry_premium = 0;
    expect(finderErrors(r)['universe.0.expiry_date']).toMatch(/expiry date/);
    r.universe[0].expiry_date = '2026-11-16';
    expect(finderErrors(r)).toEqual({});
  });
  it('preserves provenance for premium/IV edits and removes it for identity edits', () => {
    const leg = request().universe[0];
    leg.source = {
      provider: 'tradier',
      environment: 'sandbox',
      contract_symbol: 'XYZ-test',
      underlying: 'XYZ',
      fetched_at: '2026-10-15T10:00Z',
      bid_as_of: null,
      ask_as_of: '2026-10-15T09:59Z',
    };
    leg.bid = 0;
    leg.ask = 1;
    leg.quote_as_of = '2026-10-15T09:59Z';
    expect(
      editFinderContract(leg, { entry_premium: 0, implied_volatility: 0 })
        .source,
    ).toEqual(leg.source);
    for (const edit of [
      { strike: 105 },
      { kind: 'put' as const },
      { expiry_date: '2026-11-14' },
      { days_to_expiry: 31 },
      { multiplier: 10 },
    ]) {
      const updated = editFinderContract(leg, edit);
      expect(updated.source).toBeNull();
      expect(updated.bid).toBeNull();
      expect(updated.ask).toBeNull();
      expect(updated.quote_as_of).toBeNull();
      expect(leg.source).not.toBeNull();
    }
  });
  it('validates all universe rows up to 24, including zero IV/premium and a 24th invalid row', () => {
    const r = request();
    r.universe = Array.from({ length: 24 }, (_, i) => ({
      ...r.universe[0],
      strike: 100 + i,
      entry_premium: 0,
      implied_volatility: 0,
    }));
    expect(finderErrors(r)).toEqual({});
    r.universe[23].multiplier = 0;
    expect(finderErrors(r)['universe.23.multiplier']).toBeTruthy();
    r.universe.push(r.universe[0]);
    expect(finderErrors(r).universe).toBeTruthy();
    r.universe = [];
    expect(finderErrors(r).universe).toBeTruthy();
  });
  it.each([
    { quantity: -1 },
    { enabled: false },
    { kind: 'underlying' as const },
  ])('rejects non-unit/enabled option universe: %j', update => {
    const r = request();
    Object.assign(r.universe[0], update);
    expect(finderErrors(r)['universe.0']).toBeTruthy();
  });
  it('validates per-contract horizons and refuses mismatched source underlying', () => {
    const r = request();
    r.universe[0].expiry_date = '2026-12-18';
    expect(finderErrors(r)['universe.0.expiry_date']).toBeTruthy();
    r.analysis.strategy.valuation_date = '2026-10-15';
    r.analysis.strategy.expiry_date = '2026-11-14';
    r.universe[0].days_to_expiry = 64;
    expect(finderErrors(r)).toEqual({});
    r.universe[0].days_to_expiry = 63;
    expect(finderErrors(r)['universe.0.expiry_date']).toBeTruthy();
    r.analysis.strategy.underlying = 'XYZ';
    r.universe[0].source = {
      provider: 'tradier',
      environment: 'production',
      contract_symbol: 'ABC-test',
      underlying: 'ABC',
      fetched_at: '2026-10-15T10:00Z',
    };
    expect(finderErrors(r)['universe.0.source']).toContain('underlying');
  });
  it.each([
    ['', []],
    ['0, 100, 120', [0, 100, 120]],
    [' 80 100\n120 ', [80, 100, 120]],
  ])('parses explicit spots %s without sorting or defaults', (text, values) => {
    expect(parseFinderSpots(text as string)).toEqual(values);
  });
  it.each([
    '100, 80',
    '100, 100',
    '0, Infinity',
    '80, nope',
    '-1, 100',
    '1000001',
    '1,2,3,4,5,6,7,8,9,10',
    '',
  ])('rejects invalid scenario spots: %s', text => {
    const r = request();
    r.scenario_spots = parseFinderSpots(text);
    expect(finderErrors(r).scenario_spots).toBeTruthy();
  });
  it('bounds size, money and computational limits without coercing null/nonfinite to zero', () => {
    const r = request();
    r.constraints = {
      max_entry_debit: NaN,
      max_loss: -1,
      max_total_contracts: 101,
      max_legs: 0,
    };
    r.limit = 21;
    r.max_evaluations = 2001;
    expect(Object.keys(finderErrors(r))).toEqual(
      expect.arrayContaining([
        'constraints.max_entry_debit',
        'constraints.max_loss',
        'constraints.max_total_contracts',
        'constraints.max_legs',
        'limit',
        'max_evaluations',
      ]),
    );
    r.constraints = {
      max_entry_debit: 0,
      max_loss: 0,
      max_total_contracts: 100,
      max_legs: 4,
    };
    r.limit = 20;
    r.max_evaluations = 2000;
    expect(finderErrors(r)).toEqual({});
    r.analysis.spot = NaN;
    expect(finderErrors(r)['analysis.spot']).toBeTruthy();
  });
  it('applies only an explicit nonstale candidate strategy and preserves other context/source ownership', () => {
    const r = request(),
      result = candidate(r),
      draft = structuredClone(r.analysis);
    result.request.strategy.legs[0].quantity = -2;
    result.request.strategy.legs[0].entry_premium = 0;
    const before = JSON.stringify(draft.spot_grid);
    expect(applyFinderCandidate(draft, r, result)).toBe(true);
    expect(draft.strategy.legs[0].quantity).toBe(-2);
    expect(draft.strategy.legs[0].entry_premium).toBe(0);
    expect(JSON.stringify(draft.spot_grid)).toBe(before);
    expect(result.request.strategy).not.toBe(draft.strategy);
    const stale = structuredClone(r.analysis);
    stale.rate = 0.04;
    const original = structuredClone(stale);
    expect(applyFinderCandidate(stale, r, result)).toBe(false);
    expect(stale).toEqual(original);
    result.request.strategy.legs = Array(17).fill(
      result.request.strategy.legs[0],
    );
    expect(applyFinderCandidate(structuredClone(r.analysis), r, result)).toBe(
      false,
    );
  });
});

describe('document/query/session request fencing', () => {
  it('cancels prior flights and rejects success/error/finally after query or document replacement', () => {
    const gate = new OptionsToolFlight();
    let key = 'guest:doc1:query1';
    const first = gate.start(() => key, vi.fn());
    expect(first.current()).toBe(true);
    const second = gate.start(() => key, vi.fn());
    expect(first.signal.aborted).toBe(true);
    expect(first.current()).toBe(false);
    key = 'guest:doc1:query2';
    expect(second.current()).toBe(false);
    key = 'account:doc2:query1';
    expect(second.current()).toBe(false);
    gate.cancel();
    expect(second.signal.aborted).toBe(true);
    second.finish();
    first.finish();
  });
  it('rejects a result after account token generation changes even before reactive scope cleanup', () => {
    const gate = new OptionsToolFlight();
    const run = gate.start(() => 'unchanged-key', vi.fn());
    setAccessToken('test-only');
    expect(run.current()).toBe(false);
    clearAccessToken();
    expect(run.current()).toBe(false);
    gate.cancel();
  });
  it('times out and aborts only a current request, and cleans up its timer', () => {
    vi.useFakeTimers();
    const gate = new OptionsToolFlight(),
      timeout = vi.fn();
    const run = gate.start(() => 'doc', timeout);
    vi.advanceTimersByTime(15000);
    expect(timeout).toHaveBeenCalledOnce();
    expect(run.signal.aborted).toBe(true);
    expect(run.current()).toBe(false);
    const complete = gate.start(() => 'doc', timeout);
    complete.finish();
    vi.advanceTimersByTime(20000);
    expect(timeout).toHaveBeenCalledOnce();
    gate.cancel();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('old finally cannot clear the replacement deadline; cancellation fences rejected promises', async () => {
    vi.useFakeTimers();
    const gate = new OptionsToolFlight(),
      timeout = vi.fn();
    const old = gate.start(() => 'doc', timeout),
      current = gate.start(() => 'doc', timeout);
    old.finish();
    vi.advanceTimersByTime(15000);
    expect(timeout).toHaveBeenCalledOnce();
    expect(current.current()).toBe(false);
    const rejected = gate.start(() => 'doc', timeout);
    gate.cancel();
    const publish = vi.fn();
    await Promise.reject(new Error('obsolete'))
      .catch(() => {
        if (rejected.current()) publish();
      })
      .finally(() => {
        if (rejected.current()) publish();
        rejected.finish();
      });
    expect(publish).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('finder controlled native component contract', () => {
  it('renders read-only with no auto requests or draft mutations and no guessed universe', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const onEdit = vi.fn(),
      draft = createOptionsDraft(),
      before = structuredClone(draft);
    const html = render(OptionsFinder, {
      props: { draft, onEdit, documentKey: 'guest:1', readOnly: true },
    }).body;
    expect(html).toContain('Read-only source mode');
    expect(html).toContain('Contract universe');
    expect(html).toContain('0/24');
    expect(html).toMatch(/<fieldset disabled/);
    expect(html).toContain('no directional filter');
    expect(html).toContain('not probability-weighted');
    expect(html).toContain('No search submitted');
    expect(fetch).not.toHaveBeenCalled();
    expect(onEdit).not.toHaveBeenCalled();
    expect(draft).toEqual(before);
  });
  it('compiles without warnings and retains compact wrapping and forced-colors keyboard focus', () => {
    const source = readFileSync(
      new URL(
        '../../../components/options/OptionsFinder.svelte',
        import.meta.url,
      ),
      'utf8',
    );
    const compiled = compile(source, {
      generate: 'client',
      filename: 'OptionsFinder.svelte',
    });
    expect(compiled.warnings).toEqual([]);
    expect(source).toContain('onEdit(current');
    expect(source).not.toMatch(/localStorage|sessionStorage/);
    expect(compiled.css?.code).toContain('forced-colors');
    expect(compiled.css?.code).toContain(':focus-visible');
    expect(compiled.css?.code).toContain('flex-wrap: wrap');
  });
});

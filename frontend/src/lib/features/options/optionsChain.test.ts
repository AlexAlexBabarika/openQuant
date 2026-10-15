import { readFileSync } from 'node:fs';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OptionsChainPicker from '../../../components/options/OptionsChainPicker.svelte';
import {
  applyChainImport,
  chainFilterErrors,
  chainPremium,
  chainRows,
  chainSpread,
  needsChainModelAcknowledgment,
  proposeChainImport,
  type ChainFilters,
  type ChainImportSettings,
} from './optionsChain';
import type { ChainQuote, ChainResponse } from './optionsResearchTypes';
import { createOptionsDraft } from './optionsTemplates';
import { optionsErrors } from './optionsValidation';

const quote = (): ChainQuote => ({
  contract_symbol: 'XYZ261218C00100000',
  underlying: 'XYZ',
  kind: 'call',
  strike: 100,
  expiration: '2026-12-18',
  multiplier: 100,
  bid: 0,
  ask: 2,
  bid_as_of: '2026-10-15T10:00:00Z',
  ask_as_of: '2026-10-15T10:01:00Z',
  implied_volatility: 0,
  volume: 0,
  open_interest: null,
  source: {
    provider: 'tradier',
    environment: 'sandbox',
    contract_symbol: 'XYZ261218C00100000',
    underlying: 'XYZ',
    fetched_at: '2026-10-15T11:00:00Z',
    bid_as_of: '2026-10-15T10:00:00Z',
    ask_as_of: '2026-10-15T10:01:00Z',
    observed_exercise_style: 'american',
    observed_settlement: 'physical',
  },
});
const choices = (): ChainImportSettings => ({
  side: 'sell',
  size: 2,
  premiumChoice: 'custom',
  customPremium: 0,
  multiplier: 100,
  valuationDate: '2026-10-15',
  ivChoice: 'quote',
  customIv: NaN,
  acknowledgeModel: true,
  acknowledgeQuote: false,
  setUnderlying: true,
});
const response = (quotes: ChainQuote[]): ChainResponse => ({
  provider: 'tradier',
  environment: 'sandbox',
  symbol: 'XYZ',
  expiration: '2026-12-18',
  fetched_at: '2026-10-15T11:00:00Z',
  quotes,
  truncated: false,
  warnings: [],
});
const filters = (): ChainFilters => ({
  kind: 'all',
  minStrike: null,
  maxStrike: null,
  sort: 'strike',
  descending: false,
  page: 0,
});

afterEach(() => vi.unstubAllGlobals());

describe('explicit observed quote premium choices', () => {
  it('preserves zero bid/IV/volume and unknown OI, with independent side times', () => {
    const q = quote();
    expect(chainPremium(q, 'bid', NaN)).toBe(0);
    expect(chainPremium(q, 'ask', NaN)).toBe(2);
    expect(chainPremium(q, 'mid', NaN)).toBe(1);
    expect(chainSpread(q)).toBe(2);
    expect(chainPremium(q, '', 0)).toBeNull();
    expect(chainPremium(q, 'custom', 0)).toBe(0);
    expect(chainPremium(q, 'custom', NaN)).toBeNull();
  });
  it('never substitutes fetched_at for absent/invalid quote timestamps', () => {
    const q = quote();
    q.bid_as_of = null;
    expect(chainPremium(q, 'bid', 0)).toBeNull();
    expect(chainPremium(q, 'mid', 0)).toBeNull();
    expect(chainPremium(q, 'ask', 0)).toBe(2);
    q.ask_as_of = '2026-02-30T10:00:00Z';
    expect(chainPremium(q, 'ask', 0)).toBeNull();
    expect(chainPremium(q, 'custom', 0)).toBe(0);
  });
  it('disables one-sided/crossed midpoint and preserves unknown versus zero spread', () => {
    const q = quote();
    q.ask = null;
    expect(chainSpread(q)).toBeNull();
    expect(chainPremium(q, 'mid', 0)).toBeNull();
    q.bid = 3;
    q.ask = 2;
    expect(chainSpread(q)).toBe(-1);
    expect(chainPremium(q, 'mid', 0)).toBeNull();
    q.bid = 0;
    q.ask = 0;
    expect(chainSpread(q)).toBe(0);
    expect(chainPremium(q, 'mid', 0)).toBe(0);
  });
});

describe('bounded deterministic chain table', () => {
  it('filters kind/strike, sorts with unknowns last in both directions and stable identity ties', () => {
    const base = quote();
    const r = response([
      { ...base, contract_symbol: 'C', bid: null, strike: 110 },
      { ...base, contract_symbol: 'B', bid: 0, strike: 100 },
      { ...base, contract_symbol: 'A', bid: 0, strike: 100 },
      { ...base, contract_symbol: 'P', kind: 'put', bid: 2, strike: 90 },
    ]);
    const f = filters();
    f.sort = 'bid';
    expect(chainRows(r, f).quotes.map(q => q.contract_symbol)).toEqual([
      'A',
      'B',
      'P',
      'C',
    ]);
    f.descending = true;
    expect(chainRows(r, f).quotes.map(q => q.contract_symbol)).toEqual([
      'P',
      'A',
      'B',
      'C',
    ]);
    f.kind = 'call';
    f.minStrike = 100;
    f.maxStrike = 100;
    expect(chainRows(r, f).quotes.map(q => q.contract_symbol)).toEqual([
      'A',
      'B',
    ]);
    expect(r.quotes[0].contract_symbol).toBe('C');
    f.minStrike = 101;
    expect(chainFilterErrors(f).maxStrike).toBeTruthy();
    f.minStrike = NaN;
    expect(chainFilterErrors(f).minStrike).toBeTruthy();
  });
  it.each(['volume', 'open_interest', 'spread'] as const)(
    'sorts zero and missing values distinctly for %s',
    sort => {
      const a = quote(),
        b = quote();
      b.contract_symbol = 'B';
      b.volume = null;
      b.open_interest = 0;
      b.ask = null;
      const f = { ...filters(), sort };
      const sorted = chainRows(response([a, b]), f).quotes;
      expect(sorted[0]).toBe(sort === 'open_interest' ? b : a);
    },
  );
  it('pages a maximum chain in 50-row windows, clamps navigation, and rejects oversize', () => {
    const rows = Array.from({ length: 2000 }, (_, i) => ({
      ...quote(),
      strike: i + 1,
      contract_symbol: `row-${i}`,
    }));
    const r = response(rows),
      f = filters();
    expect(chainRows(r, f)).toMatchObject({ total: 2000, pages: 40, page: 0 });
    expect(chainRows(r, f).quotes).toHaveLength(50);
    f.page = 999;
    expect(chainRows(r, f)).toMatchObject({ page: 39 });
    expect(chainRows(r, f).quotes[0].strike).toBe(1951);
    f.minStrike = 1000000;
    expect(chainRows(r, f)).toMatchObject({
      quotes: [],
      total: 0,
      pages: 1,
      page: 0,
    });
    r.quotes.push(quote());
    expect(() => chainRows(r, filters())).toThrow('bound');
  });
});

describe('hypothetical model imports through the controlled draft', () => {
  it('requires model acknowledgment for American/physical/unknown, including omitted classifications', () => {
    const q = quote(),
      s = choices();
    s.acknowledgeModel = false;
    expect(needsChainModelAcknowledgment(q)).toBe(true);
    expect(
      proposeChainImport(createOptionsDraft(), q, s).errors.acknowledgeModel,
    ).toBeTruthy();
    delete q.source.observed_exercise_style;
    delete q.source.observed_settlement;
    expect(needsChainModelAcknowledgment(q)).toBe(true);
    q.source.observed_exercise_style = 'european';
    q.source.observed_settlement = 'cash';
    expect(needsChainModelAcknowledgment(q)).toBe(false);
    expect(proposeChainImport(createOptionsDraft(), q, s).errors).toEqual({});
  });
  it('appends a signed contract with actual dates/multiplier/zero IV and source, without copying legacy quotes or changing existing premiums', () => {
    const draft = createOptionsDraft(),
      original = structuredClone(draft),
      q = quote();
    Object.assign(q.source, {
      api_key: 'test-must-not-export',
      raw_body: 'test-must-not-export',
    });
    const proposed = proposeChainImport(draft, q, choices());
    expect(proposed.errors).toEqual({});
    expect(draft).toEqual(original);
    expect(applyChainImport(draft, q, choices())).toBe(true);
    expect(draft.strategy.legs[0]).toEqual(original.strategy.legs[0]);
    const imported = draft.strategy.legs[1];
    expect(imported).toMatchObject({
      quantity: -2,
      entry_premium: 0,
      multiplier: 100,
      implied_volatility: 0,
      days_to_expiry: 64,
      expiry_date: '2026-12-18',
      enabled: true,
    });
    expect(imported.bid).toBeUndefined();
    expect(imported.ask).toBeUndefined();
    expect(imported.quote_as_of).toBeUndefined();
    expect(imported.source).toEqual(
      q.source && {
        provider: 'tradier',
        environment: 'sandbox',
        contract_symbol: q.contract_symbol,
        underlying: 'XYZ',
        fetched_at: q.source.fetched_at,
        bid_as_of: q.bid_as_of,
        ask_as_of: q.ask_as_of,
        observed_exercise_style: 'american',
        observed_settlement: 'physical',
      },
    );
    expect(JSON.stringify(draft)).not.toContain('must-not-export');
    expect(draft.strategy).toMatchObject({
      underlying: 'XYZ',
      valuation_date: '2026-10-15',
      template: 'custom',
      exercise_style: 'european',
      settlement: 'cash',
    });
    expect(optionsErrors(draft)).toEqual({});
  });
  it('never picks a premium or IV mode automatically and requires explicit observation use', () => {
    const draft = createOptionsDraft(),
      q = quote(),
      s = choices();
    s.premiumChoice = '';
    s.ivChoice = '';
    expect(proposeChainImport(draft, q, s).errors).toMatchObject({
      premiumChoice: expect.any(String),
      ivChoice: expect.any(String),
    });
    s.premiumChoice = 'bid';
    s.ivChoice = 'draft';
    expect(
      proposeChainImport(draft, q, s).errors.acknowledgeQuote,
    ).toBeTruthy();
    s.acknowledgeQuote = true;
    const result = proposeChainImport(draft, q, s);
    expect(result.errors).toEqual({});
    expect(result.draft?.strategy.legs[1].implied_volatility).toBeNull();
    expect(result.draft?.strategy.legs[1].entry_premium).toBe(0);
    q.bid_as_of = null;
    expect(proposeChainImport(draft, q, s).errors.premiumChoice).toBeTruthy();
  });
  it('requires unknown multiplier and IV to be explicitly supplied instead of defaulting to 100 or zero', () => {
    const draft = createOptionsDraft(),
      q = quote(),
      s = choices();
    q.multiplier = null;
    q.implied_volatility = null;
    s.multiplier = NaN;
    expect(proposeChainImport(draft, q, s).errors).toMatchObject({
      multiplier: expect.any(String),
      ivChoice: expect.any(String),
    });
    s.multiplier = 10;
    s.ivChoice = 'custom';
    s.customIv = 0;
    const proposed = proposeChainImport(draft, q, s);
    expect(proposed.errors).toEqual({});
    expect(proposed.draft?.strategy.legs[1].multiplier).toBe(10);
    expect(proposed.draft?.strategy.legs[1].implied_volatility).toBe(0);
    q.multiplier = 100;
    expect(proposeChainImport(draft, q, s).errors.multiplier).toBeTruthy();
  });
  it('refuses underlying replacement, missing identity confirmation and source mismatch', () => {
    const draft = createOptionsDraft(),
      q = quote(),
      s = choices();
    s.setUnderlying = false;
    expect(proposeChainImport(draft, q, s).errors.underlying).toBeTruthy();
    draft.strategy.underlying = 'ABC';
    expect(proposeChainImport(draft, q, s).errors.underlying).toContain(
      'differs',
    );
    const before = structuredClone(draft);
    expect(applyChainImport(draft, q, s)).toBe(false);
    expect(draft).toEqual(before);
    draft.strategy.underlying = 'xyz';
    expect(proposeChainImport(draft, q, s).errors).toEqual({});
    q.source.contract_symbol = 'wrong';
    expect(proposeChainImport(draft, q, s).errors.source).toBeTruthy();
  });
  it.each(['', '2026-02-30', '0000-01-01', '2026-12-19', '2010-01-01'])(
    'requires an explicit valid bounded UTC anchor, not fetched time: %s',
    valuationDate => {
      const proposed = proposeChainImport(createOptionsDraft(), quote(), {
        ...choices(),
        valuationDate,
      });
      expect(proposed.draft).toBeNull();
      expect(Object.keys(proposed.errors).length).toBeGreaterThan(0);
    },
  );
  it('handles leap-day and zero-day expiry without treating zero as missing', () => {
    const q = quote(),
      s = choices();
    q.expiration = '2028-02-29';
    s.valuationDate = '2028-02-29';
    const draft = createOptionsDraft();
    draft.scenarios = [];
    draft.surface = null;
    const proposed = proposeChainImport(draft, q, s);
    expect(proposed.errors).toEqual({});
    expect(proposed.draft?.strategy.legs[1].days_to_expiry).toBe(0);
  });
  it('preserves existing anchors, enforces 16-leg cap including disabled rows and rejects out-of-horizon existing scenarios', () => {
    const draft = createOptionsDraft(),
      q = quote(),
      s = choices();
    draft.strategy.valuation_date = '2026-10-15';
    draft.strategy.expiry_date = '2026-11-14';
    s.valuationDate = '2026-10-16';
    expect(proposeChainImport(draft, q, s).errors.valuationDate).toBeTruthy();
    s.valuationDate = '2026-10-15';
    expect(proposeChainImport(draft, q, s).draft?.strategy.expiry_date).toBe(
      '2026-11-14',
    );
    draft.strategy.legs = Array.from({ length: 15 }, () =>
      structuredClone(draft.strategy.legs[0]),
    );
    expect(proposeChainImport(draft, q, s).draft?.strategy.legs).toHaveLength(
      16,
    );
    draft.strategy.legs.push({ ...draft.strategy.legs[0], enabled: false });
    expect(proposeChainImport(draft, q, s).errors.legs).toBeTruthy();
    draft.strategy.legs = [draft.strategy.legs[0]];
    draft.scenarios = [{ name: 'after', elapsed_days: 10, iv_shift_pp: 0 }];
    q.expiration = '2026-10-16';
    expect(
      proposeChainImport(draft, q, s).errors['draft.scenarios.0.elapsed_days'],
    ).toBeTruthy();
  });
  it.each([0, -1, 1.5, 10001, NaN])(
    'rejects invalid import sizes %s without changing signed legs',
    size => {
      const draft = createOptionsDraft();
      expect(applyChainImport(draft, quote(), { ...choices(), size })).toBe(
        false,
      );
      expect(draft.strategy.legs).toHaveLength(1);
    },
  );
});

describe('native chain picker contract', () => {
  it('renders disconnected settings guidance without network, secrets input or storage', () => {
    const fetch = vi.fn(),
      onEdit = vi.fn(),
      draft = createOptionsDraft();
    vi.stubGlobal('fetch', fetch);
    const html = render(OptionsChainPicker, {
      props: { draft, onEdit, documentKey: 'guest:doc', readOnly: true },
    }).body;
    expect(html).toContain('Read-only source mode');
    expect(html).toContain('Settings → API keys');
    expect(html).toContain('No connection check submitted');
    expect(html).toMatch(/<fieldset disabled/);
    expect(html).not.toContain('type="password"');
    expect(fetch).not.toHaveBeenCalled();
    expect(onEdit).not.toHaveBeenCalled();
  });
  it('compiles with no warnings and preserves native table, explicit actions and forced-color focus', () => {
    const source = readFileSync(
      new URL(
        '../../../components/options/OptionsChainPicker.svelte',
        import.meta.url,
      ),
      'utf8',
    );
    const compiled = compile(source, {
      generate: 'client',
      filename: 'OptionsChainPicker.svelte',
    });
    expect(compiled.warnings).toEqual([]);
    expect(source).toContain('<table>');
    expect(source).toContain('scope="col"');
    expect(source).toContain('scope="row"');
    expect(source).toContain('tabindex="0"');
    expect(source).not.toMatch(/localStorage|sessionStorage|type="password"/);
    expect(source).toContain('onEdit(current');
    expect(source).toContain('proposeChainImport($state.snapshot(draft)');
    expect(source).toContain('getChainStatus(run.signal)');
    expect(source).toContain(
      'getOptionChain(query.symbol, query.expiration, query.environment, run.signal)',
    );
    expect(compiled.css?.code).toContain('forced-colors');
    expect(compiled.css?.code).toContain(':focus-visible');
    expect(compiled.css?.code).toContain('flex-wrap: wrap');
  });
});

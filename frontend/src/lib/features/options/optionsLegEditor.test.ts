import { readFileSync } from 'node:fs';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import OptionsLegEditor from '../../../components/options/OptionsLegEditor.svelte';
import OptionsAssumptionsEditor from '../../../components/options/OptionsAssumptionsEditor.svelte';
import {
  addOptionLeg,
  clearCommonDates,
  commonDateHorizon,
  editLegContract,
  editOptionLeg,
  legSide,
  manualQuoteAge,
  moveOptionLeg,
  optionsEditorErrors,
  quoteMidpoint,
  removeOptionLeg,
  setCommonDate,
  setLegKind,
  setLegSize,
  useQuoteMidpoint,
  validQuoteTimestamp,
} from './optionsLegEditor';
import type { OptionLeg } from './optionsTypes';
import { createOptionsDraft } from './optionsTemplates';
import { optionsErrors } from './optionsState.svelte';

describe('controlled options leg editing', () => {
  it('serializes explicit buy/sell with a nonnegative integer size', () => {
    const leg = createOptionsDraft().strategy.legs[0];
    setLegSize(leg, 3, 'sell');
    expect(legSide(leg)).toBe('sell');
    expect(leg.quantity).toBe(-3);
    setLegSize(leg, 9);
    expect(leg.quantity).toBe(-9);
    expect(JSON.parse(JSON.stringify(leg)).quantity).toBe(-9);
    setLegSize(leg, 2, 'buy');
    expect(leg.quantity).toBe(2);
    setLegSize(leg, 0, 'sell');
    expect(legSide(leg)).toBe('sell');
    setLegSize(leg, 1);
    expect(leg.quantity).toBe(-1);
  });
  it('does not silently accept a negative size and preserves invalid numbers for validation', () => {
    const d = createOptionsDraft(),
      leg = d.strategy.legs[0];
    for (const size of [0, 0.5, 10001, NaN, Infinity, -1]) {
      setLegSize(leg, size);
      expect(optionsErrors(d)['legs.0.quantity']).toBeTruthy();
    }
  });
  it('adds and duplicates at most 16 independent legs including metadata', () => {
    const d = createOptionsDraft();
    Object.assign(d.strategy.legs[0], {
      implied_volatility: 0.4,
      bid: 2,
      ask: 4,
      quote_as_of: '2026-10-14T11:00Z',
    });
    expect(addOptionLeg(d, 0)).toBe(true);
    expect(d.strategy.legs[1]).toEqual(d.strategy.legs[0]);
    expect(d.strategy.legs[1]).not.toBe(d.strategy.legs[0]);
    editOptionLeg(d, 1, l => {
      l.bid = 3;
      l.enabled = false;
    });
    expect(d.strategy.legs[0].bid).toBe(2);
    expect(d.strategy.legs[0].enabled).toBe(true);
    while (d.strategy.legs.length < 16) expect(addOptionLeg(d)).toBe(true);
    expect(addOptionLeg(d)).toBe(false);
    expect(addOptionLeg(d, 0)).toBe(false);
    expect(d.strategy.legs).toHaveLength(16);
    expect(optionsErrors(d)).toEqual({});
    expect(optionsEditorErrors(d)).toEqual({});
  });
  it('reorders/removes with bounds, leaving all enabled state and original metadata intact', () => {
    const d = createOptionsDraft();
    expect(removeOptionLeg(d, 0)).toBe(false);
    expect(addOptionLeg(d, 9)).toBe(false);
    addOptionLeg(d);
    editOptionLeg(d, 1, l => {
      l.strike = 123.45;
      l.enabled = false;
    });
    expect(moveOptionLeg(d, 0, -1)).toBe(false);
    expect(moveOptionLeg(d, 1, 1)).toBe(false);
    expect(moveOptionLeg(d, 1, -1)).toBe(true);
    expect(d.strategy.legs[0].strike).toBe(123.45);
    expect(d.strategy.legs[0].enabled).toBe(false);
    expect(d.strategy.template).toBe('custom');
    expect(removeOptionLeg(d, 99)).toBe(false);
    expect(removeOptionLeg(d, 0)).toBe(true);
    expect(d.strategy.legs[0].strike).toBe(100);
  });
  it('uses shares invariants without carrying forbidden option metadata', () => {
    const d = createOptionsDraft(),
      leg = d.strategy.legs[0];
    Object.assign(leg, {
      quantity: -100,
      implied_volatility: 0.4,
      bid: 2,
      ask: 4,
      quote_as_of: '2026-10-14T11:00Z',
    });
    setLegKind(leg, 'underlying', d.spot);
    expect(leg).toMatchObject({
      quantity: -100,
      strike: null,
      multiplier: 1,
      implied_volatility: null,
      bid: null,
      ask: null,
      quote_as_of: null,
    });
    expect(optionsErrors(d)).toEqual({});
    expect(optionsEditorErrors(d)).toEqual({});
    setLegKind(leg, 'put', 120);
    expect(leg).toMatchObject({
      kind: 'put',
      quantity: -1,
      strike: 120,
      multiplier: 100,
    });
    editOptionLeg(d, 0, l => {
      l.enabled = false;
    });
    expect(optionsErrors(d).legs).toBeTruthy();
  });
});

describe('common UTC calendar horizon', () => {
  it.each([
    ['2024-02-28', '2024-03-01', 2],
    ['2025-02-28', '2025-03-01', 1],
    ['2026-03-08', '2026-03-09', 1],
    ['2026-11-01', '2026-11-02', 1],
    ['2026-10-14', '2026-10-14', 0],
    ['0001-01-01', '0001-01-02', 1],
    ['9999-12-30', '9999-12-31', 1],
    ['2020-01-01', '2029-12-29', 3650],
  ])('derives exact days for %s → %s', (start, end, days) => {
    expect(commonDateHorizon(start, end)).toBe(days);
    const d = createOptionsDraft();
    setCommonDate(d, 'expiry_date', end);
    expect(d.strategy.days_to_expiry).toBe(30);
    expect(optionsEditorErrors(d)['strategy.valuation_date']).toBeTruthy();
    setCommonDate(d, 'valuation_date', start);
    expect(d.strategy.days_to_expiry).toBe(days);
    expect(optionsEditorErrors(d)).toEqual({});
  });
  it.each([
    ['2026-02-29', '2026-03-01'],
    ['2024-02-30', '2024-03-01'],
    ['2026-10-14', '2026-10-13'],
    ['2020-01-01', '2030-01-01'],
    ['0000-01-01', '0001-01-01'],
    ['2026-1-01', '2026-01-02'],
  ])('retains invalid dates %s → %s with no horizon clamping', (start, end) => {
    expect(commonDateHorizon(start, end)).toBeNull();
    const d = createOptionsDraft();
    setCommonDate(d, 'valuation_date', start);
    setCommonDate(d, 'expiry_date', end);
    expect(d.strategy.days_to_expiry).toBe(30);
    expect(Object.keys(optionsEditorErrors(d)).length).toBeGreaterThan(0);
    expect(d.strategy.expiry_date).toBe(end);
  });
  it('rejects mismatched imported dates, does not alter scenarios/surfaces, explicitly clears dates', () => {
    const d = createOptionsDraft();
    d.scenarios = [{ name: 'Expiry', elapsed_days: 30, iv_shift_pp: 0 }];
    d.surface = { axis: 'elapsed_days', spots: [50, 150], steps: [0, 30] };
    setCommonDate(d, 'valuation_date', '2026-10-14');
    setCommonDate(d, 'expiry_date', '2026-10-20');
    expect(d.strategy.days_to_expiry).toBe(6);
    expect(d.scenarios[0].elapsed_days).toBe(30);
    expect(d.surface.steps).toEqual([0, 30]);
    expect(optionsErrors(d)['scenarios.0.elapsed_days']).toBeTruthy();
    d.strategy.days_to_expiry = 7;
    expect(optionsEditorErrors(d)['strategy.days_to_expiry']).toBeTruthy();
    clearCommonDates(d);
    expect(d.strategy.days_to_expiry).toBe(7);
    expect(optionsEditorErrors(d)).toEqual({});
  });
});

describe('manual unverified quotes and IV', () => {
  it.each([
    '2026-10-14T11:00Z',
    '2024-02-29T23:59:59.123456+02:30',
    '2026-10-14T11:00:00-05:00',
  ])('accepts explicit timestamp %s', timestamp => {
    expect(validQuoteTimestamp(timestamp)).toBe(true);
  });
  it.each([
    '',
    '2026-10-14',
    '2026-10-14T11:00',
    '2026-10-14 11:00Z',
    '2026-02-29T11:00Z',
    '2026-10-14T24:00Z',
    '2026-10-14T11:60Z',
    '2026-10-14T11:00:60Z',
    '2026-10-14T11:00+24:00',
    '0000-01-01T00:00Z',
    '2026-10-14T11:00:00.' + '1'.repeat(48) + 'Z',
  ])('rejects invalid/unzoned %s', timestamp => {
    expect(validQuoteTimestamp(timestamp)).toBe(false);
  });
  it('changes premium only through explicit validated midpoint action', () => {
    const d = createOptionsDraft(),
      leg = d.strategy.legs[0];
    const premium = leg.entry_premium;
    editOptionLeg(d, 0, l => {
      l.bid = 2;
      l.ask = 4;
    });
    expect(leg.entry_premium).toBe(premium);
    expect(optionsEditorErrors(d)['legs.0.quote_as_of']).toBeTruthy();
    expect(useQuoteMidpoint(d, 0)).toBe(false);
    leg.quote_as_of = '2026-10-14T11:00:00Z';
    expect(quoteMidpoint(leg)).toBe(3);
    expect(leg.entry_premium).toBe(premium);
    expect(useQuoteMidpoint(d, 0)).toBe(true);
    expect(leg.entry_premium).toBe(3);
    for (const [bid, ask] of [
      [5, 4],
      [-1, 4],
      [2, 1000001],
      [NaN, 4],
    ]) {
      Object.assign(leg, { bid, ask });
      expect(quoteMidpoint(leg)).toBeNull();
      expect(useQuoteMidpoint(d, 0)).toBe(false);
      expect(leg.entry_premium).toBe(3);
    }
    expect(useQuoteMidpoint(d, 99)).toBe(false);
    Object.assign(leg, { bid: 0, ask: 0 });
    expect(quoteMidpoint(leg)).toBe(0);
  });
  it('allows timestamp-only metadata, rejects half/crossed pairs and validates disabled leg metadata', () => {
    const d = createOptionsDraft(),
      leg = d.strategy.legs[0];
    leg.quote_as_of = '2026-10-14T11:00Z';
    expect(optionsEditorErrors(d)).toEqual({});
    expect(quoteMidpoint(leg)).toBeNull();
    leg.bid = 0;
    expect(optionsEditorErrors(d)['legs.0.ask']).toBeTruthy();
    leg.ask = 0;
    leg.enabled = false;
    leg.implied_volatility = 5.1;
    expect(optionsEditorErrors(d)['legs.0.implied_volatility']).toBeTruthy();
    for (const iv of [null, 0, 0.2, 5]) {
      leg.implied_volatility = iv;
      expect(optionsEditorErrors(d)).toEqual({});
    }
    leg.kind = 'underlying';
    expect(optionsEditorErrors(d)['legs.0.kind']).toBeTruthy();
  });
  it('exposes declared timestamp age without claiming freshness or provider verification', () => {
    const now = Date.parse('2026-10-14T12:00Z');
    expect(manualQuoteAge(null, now)).toContain('age unknown');
    expect(manualQuoteAge('2026-02-29T11:00Z', now)).toContain('Invalid');
    expect(manualQuoteAge('2026-10-14T11:00Z', now)).toContain('1 hour');
    expect(manualQuoteAge('2026-10-13T12:00Z', now)).toContain('1 day');
    expect(manualQuoteAge('2026-10-14T11:59Z', now)).toContain('1 minute');
    expect(manualQuoteAge('2026-10-14T13:00Z', now)).toContain('future');
    expect(manualQuoteAge('2026-10-14T11:00Z', now)).toContain(
      'Not a freshness check',
    );
  });
  it('validates manual identity but accepts legacy omitted extensions', () => {
    const d = createOptionsDraft();
    expect(optionsEditorErrors(d)).toEqual({});
    d.strategy.underlying = ' ';
    expect(optionsEditorErrors(d)['strategy.underlying']).toBeTruthy();
    d.strategy.underlying = 'A'.repeat(81);
    expect(optionsEditorErrors(d)['strategy.underlying']).toBeTruthy();
    d.strategy.underlying = 'Manual research index';
    expect(optionsEditorErrors(d)).toEqual({});
  });
});

describe('controlled editor shell rendering (not browser validation)', () => {
  it('renders one labelled set of controls with signed quantities presented as Buy/Sell and nonnegative size', () => {
    const draft = createOptionsDraft();
    draft.strategy.legs[0].quantity = -2;
    addOptionLeg(draft);
    const onEdit = vi.fn();
    const html = render(OptionsLegEditor, { props: { draft, onEdit } }).body;
    expect(html.match(/<fieldset/g)).toHaveLength(2);
    expect(html.match(/<span>Side<\/span>/g)).toHaveLength(2);
    expect(html).toContain('Sell / short');
    expect(html).toContain('value="2"');
    expect(html).not.toContain('value="-2"');
    expect(html).toContain('Move leg 2 up');
    expect(html).toContain('Duplicate leg 1');
    expect(html).toContain('Manual quote inputs · unverified');
    expect(html).toContain('not real-time');
    expect(html).toContain('not executable fills');
    expect(onEdit).not.toHaveBeenCalled();
  });
  it('renders unique error IDs with valid descriptions even for maximum legs', () => {
    const draft = createOptionsDraft();
    while (draft.strategy.legs.length < 16) addOptionLeg(draft);
    draft.strategy.name = '';
    draft.strategy.legs.forEach(l => {
      l.quantity = 0;
      l.ask = 2;
    });
    const errors = { ...optionsErrors(draft), ...optionsEditorErrors(draft) };
    const html = render(OptionsLegEditor, {
      props: { draft, onEdit: vi.fn(), fieldErrors: errors },
    }).body;
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
    expect(ids.length).toBeGreaterThan(16);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [, description] of html.matchAll(/aria-describedby="([^"]+)"/g))
      expect(ids).toContain(description);
    expect(html.match(/<fieldset/g)).toHaveLength(16);
    expect(html).toMatch(/disabled[^>]*>Add leg/);
  });
  it('accepts undo/redo callbacks from parent without owning history', () => {
    const html = render(OptionsLegEditor, {
      props: {
        draft: createOptionsDraft(),
        onEdit: vi.fn(),
        canUndo: true,
        canRedo: true,
        onUndo: vi.fn(),
        onRedo: vi.fn(),
      },
    }).body;
    expect(html).not.toMatch(/disabled[^>]*>Undo/);
    expect(html).not.toMatch(/disabled[^>]*>Redo/);
    const noCallbacks = render(OptionsLegEditor, {
      props: {
        draft: createOptionsDraft(),
        onEdit: vi.fn(),
        canUndo: true,
        canRedo: true,
      },
    }).body;
    expect(noCallbacks).toMatch(/disabled[^>]*>Undo/);
    expect(noCallbacks).toMatch(/disabled[^>]*>Redo/);
  });
  it('renders common identity/dates only in assumptions and visibly flags mixed imported dates', () => {
    const draft = createOptionsDraft();
    draft.strategy.underlying = 'Manual test index';
    draft.strategy.valuation_date = '2026-10-14';
    draft.strategy.expiry_date = '2026-10-13';
    const onEdit = vi.fn();
    const html = render(OptionsAssumptionsEditor, {
      props: { draft, onEdit },
    }).body;
    expect(html.match(/type="date"/g)).toHaveLength(2);
    expect(html).toContain('Manual test index');
    expect(html).toContain('nonnegative common days to expiry');
    expect(html).toContain('Use days instead of dates');
    expect(html).toContain('Choose a date on or after the valuation date.');
    expect(onEdit).not.toHaveBeenCalled();
    const legs = render(OptionsLegEditor, { props: { draft, onEdit } }).body;
    expect(legs).not.toContain('type="date"');
    expect(legs).not.toContain('Underlying identity');
  });
  it('omits option quote/IV fields for share legs and preserves null IV semantics', () => {
    const draft = createOptionsDraft();
    setLegKind(draft.strategy.legs[0], 'underlying', draft.spot);
    const html = render(OptionsLegEditor, {
      props: { draft, onEdit: vi.fn() },
    }).body;
    expect(html).not.toContain('Manual quote inputs');
    expect(html).not.toContain('IV fraction');
    expect(html).toContain('Entry · USD/share');
    expect(html).toContain('Not applicable');
  });
  it('offers an explicit repair path for imported share legs with forbidden option fields', () => {
    const draft = createOptionsDraft();
    const leg = draft.strategy.legs[0];
    leg.kind = 'underlying';
    leg.bid = 3;
    const html = render(OptionsLegEditor, {
      props: { draft, onEdit: vi.fn(), fieldErrors: optionsErrors(draft) },
    }).body;
    expect(html).toContain('Reset share fields for leg 1');
    expect(html).toContain('Underlying shares cannot carry option IV');
    expect(html).toContain('Underlying uses no strike and multiplier 1.');
    setLegKind(leg, 'underlying', draft.spot);
    expect(optionsEditorErrors(draft)).toEqual({});
    expect(optionsErrors(draft)).toEqual({});
  });
  it.each(['OptionsLegEditor', 'OptionsAssumptionsEditor'])(
    'compiles %s without duplicate responsive control branches or constrained height',
    name => {
      const source = readFileSync(
        new URL(`../../../components/options/${name}.svelte`, import.meta.url),
        'utf8',
      );
      const compiled = compile(source, {
        generate: 'client',
        filename: `${name}.svelte`,
      });
      expect(compiled.warnings).toEqual([]);
      expect(compiled.css?.code).toContain('@container');
      expect(compiled.css?.code).toContain('minmax(0, 1fr)');
      expect(source).not.toMatch(
        /max-height|overflow:\s*hidden|display:\s*none/,
      );
      expect(source).not.toContain('$state<OptionsDraft>');
    },
  );
});

describe('observed contract provenance', () => {
  const observed = (): OptionLeg => ({
    kind: 'call',
    quantity: 1,
    strike: 5000,
    entry_premium: 10,
    multiplier: 100,
    enabled: true,
    expiry_date: '2026-12-18',
    bid: 9.5,
    ask: 10.5,
    quote_as_of: '2026-10-17T15:00:00Z',
    source: {
      provider: 'tradier',
      environment: 'sandbox',
      contract_symbol: 'SPX261218C05000000',
      underlying: 'SPX',
      fetched_at: '2026-10-17T15:00:01Z',
    },
  });
  const cleared = { source: null, bid: null, ask: null, quote_as_of: null };
  it.each([
    ['strike', { strike: 5100 }],
    ['kind', { kind: 'put' as const }],
    ['multiplier', { multiplier: 10 }],
    ['expiry', { expiry_date: '2027-01-15' }],
  ])('drops provenance and quotes when the %s changes', (_, update) => {
    const leg = observed();
    editLegContract(leg, update);
    expect(leg).toMatchObject({ ...update, ...cleared, entry_premium: 10 });
  });
  it('keeps provenance when the contract is unchanged', () => {
    const leg = observed();
    editLegContract(leg, { strike: 5000, days_to_expiry: null });
    expect(leg.source?.contract_symbol).toBe('SPX261218C05000000');
    expect(leg.bid).toBe(9.5);
  });
  it('drops provenance when a call is switched to a put', () => {
    const leg = observed();
    setLegKind(leg, 'put', 5000);
    expect(leg).toMatchObject({ kind: 'put', ...cleared });
  });
  it('routes strike and multiplier typing through the same rule', () => {
    const source = readFileSync(
      new URL(
        '../../../components/options/OptionsLegEditor.svelte',
        import.meta.url,
      ),
      'utf8',
    );
    expect(source).toContain('editLegContract(l, { strike:');
    expect(source).toContain('editLegContract(l, { multiplier:');
  });
});

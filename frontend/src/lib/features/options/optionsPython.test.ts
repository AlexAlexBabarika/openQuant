import { describe, expect, it } from 'vitest';
import { createOptionsDraft } from './optionsTemplates';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { python } from '@codemirror/lang-python';
import { history, undoDepth } from '@codemirror/commands';
import {
  boundedOptionsStdout,
  exportOptionsPython,
  optionsPythonCompletions,
  optionsPythonExtensions,
  optionsPythonSourceError,
  OPTIONS_PYTHON_FIELDS,
  OPTIONS_PYTHON_HELPERS,
  OPTIONS_SOURCE_LIMIT,
  OPTIONS_STDOUT_LIMIT,
} from './optionsPython';

describe('options Python export', () => {
  it('exports readable supported sandbox code without imports or external calls', () => {
    const d = createOptionsDraft();
    const source = exportOptionsPython(d);
    expect(source).toContain('request = {\n');
    expect(source).toContain('result = analyze_options(request)');
    expect(source).toContain('"enabled": True');
    expect(source).not.toMatch(/^\s*(from|import) /m);
    expect(source.length).toBeLessThan(OPTIONS_SOURCE_LIMIT);
    expect(source).toContain('European cash-settled');
    expect(d).toEqual(createOptionsDraft());
  });
  it('escapes names, preserves signed quantities and emits Python null/boolean literals', () => {
    const d = createOptionsDraft();
    d.strategy.name = 'Quote " / newline\n and unicode π';
    d.strategy.legs = [
      {
        kind: 'underlying',
        quantity: -100,
        strike: null,
        entry_premium: 123.45,
        multiplier: 1,
        enabled: false,
      },
    ];
    d.scenarios = [{ name: 'Day 5', elapsed_days: 5, iv_shift_pp: -5 }];
    const source = exportOptionsPython(d);
    expect(source).toContain('"name": "Quote \\" / newline\\n and unicode π"');
    expect(source).toContain('"strike": None');
    expect(source).toContain('"quantity": -100');
    expect(source).toContain('"enabled": False');
    expect(source).toContain('"iv_shift_pp": -5');
    expect(source).not.toContain(': null');
  });
  it('does not silently export nonfinite or incomplete editor fields', () => {
    const d = createOptionsDraft();
    d.spot = NaN;
    expect(() => exportOptionsPython(d)).toThrow('finite');
    d.spot = undefined as unknown as number;
    expect(() => exportOptionsPython(d)).toThrow('complete');
  });
  it('fits the API source limit with maximum bounded editable structure', () => {
    const d = createOptionsDraft();
    d.strategy.name = 'n'.repeat(120);
    d.strategy.legs = Array.from({ length: 16 }, () => ({
      ...d.strategy.legs[0],
    }));
    d.spot_grid = Array.from({ length: 201 }, (_, i) => i * Math.PI);
    d.scenarios = Array.from({ length: 3 }, (_, i) => ({
      name: `${i}${'s'.repeat(79)}`,
      elapsed_days: i,
      iv_shift_pp: i,
    }));
    expect(exportOptionsPython(d).length).toBeLessThan(OPTIONS_SOURCE_LIMIT);
  });

  it('preserves optional dates, per-leg quotes/IV, surface precision and explicit nulls', () => {
    const d = createOptionsDraft();
    d.strategy.underlying = 'Manual XYZ';
    d.strategy.valuation_date = '2026-10-14';
    d.strategy.expiry_date = '2026-11-13';
    Object.assign(d.strategy.legs[0], {
      quantity: -3,
      implied_volatility: 0.3123456789012345,
      bid: 4.000000000000001,
      ask: 5,
      quote_as_of: '2026-10-14T11:00:00+00:00',
    });
    d.rate = -0.0123456789012345;
    d.dividend_yield = -0;
    d.surface = {
      axis: 'iv_shift_pp',
      spots: [0, 100.00000000000001],
      steps: [-5.123456789012345, 0],
    };
    const before = structuredClone(d);
    const source = exportOptionsPython(d);
    for (const [key, value] of [
      ['underlying', '"Manual XYZ"'],
      ['valuation_date', '"2026-10-14"'],
      ['expiry_date', '"2026-11-13"'],
      ['quantity', '-3'],
      ['implied_volatility', '0.3123456789012345'],
      ['bid', '4.000000000000001'],
      ['quote_as_of', '"2026-10-14T11:00:00+00:00"'],
      ['rate', '-0.0123456789012345'],
      ['dividend_yield', '-0.0'],
      ['axis', '"iv_shift_pp"'],
    ])
      expect(source).toContain(`"${key}": ${value}`);
    expect(source).toContain('[-5.123456789012345, 0]');
    expect(source).toContain('[0, 100.00000000000001]');
    d.surface = null;
    d.strategy.legs[0].implied_volatility = null;
    expect(exportOptionsPython(d)).toContain('"surface": None');
    expect(exportOptionsPython(d)).toContain('"implied_volatility": None');
    expect(before.surface?.axis).toBe('iv_shift_pp');
  });

  it('omits only undefined optional fields and still rejects incomplete required fields', () => {
    const d = createOptionsDraft();
    d.surface = undefined;
    d.strategy.underlying = undefined;
    d.strategy.valuation_date = undefined;
    d.strategy.expiry_date = undefined;
    Object.assign(d.strategy.legs[0], {
      implied_volatility: undefined,
      bid: undefined,
      ask: undefined,
      quote_as_of: undefined,
    });
    const source = exportOptionsPython(d);
    for (const key of [
      'surface',
      'underlying',
      'valuation_date',
      'expiry_date',
      'implied_volatility',
      'bid',
      'ask',
      'quote_as_of',
    ])
      expect(source).not.toContain(`"${key}":`);
    d.strategy.legs[0].entry_premium = undefined as unknown as number;
    expect(() => exportOptionsPython(d)).toThrow('complete');
  });

  it('uses compact literals for large requests without changing numeric precision', () => {
    const d = createOptionsDraft();
    d.strategy.name = 'a'.repeat(120);
    d.strategy.underlying = 'b'.repeat(80);
    d.strategy.legs = Array.from({ length: 16 }, () => ({
      ...d.strategy.legs[0],
      strike: 99.12345678901234,
      entry_premium: 5.123456789012345,
      implied_volatility: 0.2345678901234567,
      bid: 4.123456789012345,
      ask: 5.123456789012345,
      quote_as_of:
        '2026-10-14T11:00:00.123456789012345678901234567890123456789012345Z',
    }));
    d.spot_grid = Array.from({ length: 201 }, (_, i) => i * Math.PI);
    d.scenarios = Array.from({ length: 3 }, (_, i) => ({
      name: `${i}${'s'.repeat(79)}`,
      elapsed_days: i,
      iv_shift_pp: i,
    }));
    d.surface = {
      axis: 'elapsed_days',
      spots: Array.from({ length: 41 }, (_, i) => i * Math.PI),
      steps: Array.from({ length: 21 }, (_, i) => i * Math.SQRT2),
    };
    const before = structuredClone(d);
    const source = exportOptionsPython(d);
    expect(source.length).toBeLessThanOrEqual(OPTIONS_SOURCE_LIMIT);
    expect(source).toContain('0.2345678901234567');
    expect(source).toContain('628.3185307179587');
    expect(d).toEqual(before);
  });

  it('never silently truncates an export that cannot fit the source bound', () => {
    const d = createOptionsDraft();
    d.strategy.name = '\u0001'.repeat(20000);
    expect(() => exportOptionsPython(d)).toThrow('Nothing was truncated');
  });
});

describe('options editor extensions', () => {
  function completions(doc: string, explicit = false) {
    const state = EditorState.create({ doc, extensions: [python()] });
    return optionsPythonCompletions(
      new CompletionContext(state, doc.length, explicit),
    );
  }

  it('provides documented injected helpers and every canonical request field', () => {
    const result = completions('analy');
    expect(result?.from).toBe(0);
    expect(result?.options).toEqual([
      ...OPTIONS_PYTHON_HELPERS,
      ...OPTIONS_PYTHON_FIELDS,
    ]);
    for (const helper of OPTIONS_PYTHON_HELPERS) {
      expect(typeof helper.apply).toBe('function');
      expect(helper.info).toBeTruthy();
      expect(helper.detail).toContain('dict');
    }
    expect(OPTIONS_PYTHON_FIELDS.map(field => field.label)).toEqual(
      expect.arrayContaining([
        ...Object.keys(createOptionsDraft()),
        ...Object.keys(createOptionsDraft().strategy),
        ...Object.keys(createOptionsDraft().strategy.legs[0]),
        'implied_volatility',
        'bid',
        'ask',
        'quote_as_of',
        'underlying',
        'valuation_date',
        'expiry_date',
        'surface',
        'axis',
        'spots',
        'steps',
      ]),
    );
    expect(
      result?.options.some(option =>
        /import|open|eval|exec|provider/i.test(option.label),
      ),
    ).toBe(false);
    expect(completions('')?.options).toBeUndefined();
    expect(completions('', true)?.options).toBeTruthy();
  });

  it('offers fields in dictionary keys, not arbitrary strings or comments', () => {
    expect(completions('# analy', true)).toBeNull();
    expect(completions('print("analy', true)).toBeNull();
    expect(completions('{"implied_', true)?.options).toEqual(
      OPTIONS_PYTHON_FIELDS,
    );
  });

  it('rejects whole oversized edits and leaves history unchanged, with repair allowed', () => {
    let rejected = 0;
    let state = EditorState.create({
      doc: 'a',
      extensions: [history(), ...optionsPythonExtensions(() => rejected++)],
    });
    state = state.update({
      changes: { from: 1, insert: 'b'.repeat(OPTIONS_SOURCE_LIMIT - 1) },
    }).state;
    expect(state.doc.length).toBe(OPTIONS_SOURCE_LIMIT);
    expect(undoDepth(state)).toBe(1);
    const rejectedState = state.update({
      changes: { from: 2, to: 3, insert: 'paste'.repeat(5000) },
    }).state;
    expect(rejectedState.doc.toString()).toBe(state.doc.toString());
    expect(undoDepth(rejectedState)).toBe(1);
    expect(rejected).toBe(1);
    const oversized = EditorState.create({
      doc: 'x'.repeat(OPTIONS_SOURCE_LIMIT + 5),
      extensions: optionsPythonExtensions(() => rejected++),
    });
    expect(oversized.doc.length).toBe(OPTIONS_SOURCE_LIMIT + 5);
    expect(
      oversized.update({ changes: { from: 0, to: 5 } }).state.doc.length,
    ).toBe(OPTIONS_SOURCE_LIMIT);
  });

  it('blocks empty/oversized runs without changing source and bounds UTF-8 console output', () => {
    expect(optionsPythonSourceError(' \n')).toContain('Enter');
    expect(
      optionsPythonSourceError('a'.repeat(OPTIONS_SOURCE_LIMIT)),
    ).toBeNull();
    expect(
      optionsPythonSourceError('a'.repeat(OPTIONS_SOURCE_LIMIT + 1)),
    ).toContain('Nothing was truncated');
    expect(boundedOptionsStdout('canonical\n')).toEqual({
      text: 'canonical\n',
      truncated: false,
    });
    expect(boundedOptionsStdout('a'.repeat(OPTIONS_STDOUT_LIMIT))).toEqual({
      text: 'a'.repeat(OPTIONS_STDOUT_LIMIT),
      truncated: false,
    });
    const bounded = boundedOptionsStdout('π'.repeat(8191) + '😀');
    expect(new TextEncoder().encode(bounded.text).length).toBe(16382);
    expect(bounded).toEqual({ text: 'π'.repeat(8191), truncated: true });
    expect(boundedOptionsStdout('😀'.repeat(4096)).truncated).toBe(false);
  });
});

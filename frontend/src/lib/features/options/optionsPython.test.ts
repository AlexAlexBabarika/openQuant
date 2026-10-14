import { describe, expect, it } from 'vitest';
import { createOptionsDraft } from './optionsTemplates';
import { exportOptionsPython, OPTIONS_SOURCE_LIMIT } from './optionsPython';

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
});

import { describe, expect, it } from 'vitest';
import { createOptionsDraft } from './optionsTemplates';
import {
  firstExpiryDays,
  optionsErrors,
  resolvedLegDays,
} from './optionsValidation';
import {
  requestChanged,
  scenarioInputError,
  surfaceSettings,
} from './optionsScenario';
import { addOptionLeg, setLegKind } from './optionsLegEditor';
import { exportOptionsPython } from './optionsPython';
import { exportOptionsBundle, importOptionsBundle } from './optionsPersistence';

const calendar = () => {
  const d = createOptionsDraft();
  d.strategy.template = 'calendar';
  d.strategy.days_to_expiry = 60;
  d.strategy.legs = [
    { ...d.strategy.legs[0], quantity: -1, days_to_expiry: 10 },
    { ...d.strategy.legs[0], quantity: 1 },
  ];
  d.scenarios = [];
  return d;
};

describe('canonical multi-expiry authoring, export and recovery', () => {
  it('uses first active expiry, including zero, and ignores disabled overrides', () => {
    const d = calendar();
    expect(firstExpiryDays(d)).toBe(10);
    expect(surfaceSettings(d).stepEnd).toBe(10);
    expect(scenarioInputError(d, 10, 0)).toBeNull();
    expect(scenarioInputError(d, 11, 0)).not.toBeNull();
    d.strategy.legs[0].days_to_expiry = 0;
    expect(surfaceSettings(d).axis).toBe('iv_shift_pp');
    d.strategy.legs[0].enabled = false;
    expect(firstExpiryDays(d)).toBe(60);
  });
  it('resolves date-only overrides against valuation and rejects mismatched days', () => {
    const d = calendar();
    d.strategy.valuation_date = '2024-02-28';
    d.strategy.legs[0].expiry_date = '2024-03-09';
    d.strategy.legs[0].days_to_expiry = null;
    expect(resolvedLegDays(d.strategy, d.strategy.legs[0])).toBe(10);
    expect(optionsErrors(d)).toEqual({});
    d.strategy.legs[0].days_to_expiry = 11;
    expect(optionsErrors(d)['legs.0.expiry_date']).toContain('exactly');
    d.strategy.valuation_date = null;
    expect(Number.isNaN(resolvedLegDays(d.strategy, d.strategy.legs[0]))).toBe(
      true,
    );
    expect(optionsErrors(d)['legs.0.expiry_date']).toBeTruthy();
  });
  it('preserves signed overrides and provenance through named storage and Python export', () => {
    const d = calendar();
    d.strategy.legs[0].source = {
      provider: 'tradier',
      environment: 'sandbox',
      contract_symbol: 'XYZ-EXAMPLE',
      underlying: 'XYZ',
      fetched_at: '2026-10-15T00:00:00Z',
      bid_as_of: null,
      ask_as_of: null,
    };
    const records = [
      {
        name: 'Calendar',
        draft: d,
        source: '# unchanged custom Python',
        mode: 'python' as const,
        updatedAt: '2026-10-15T00:00:00Z',
      },
    ];
    expect(importOptionsBundle(exportOptionsBundle(records))).toEqual(records);
    const source = exportOptionsPython(d);
    expect(source).toContain('"days_to_expiry": 10');
    expect(source).toContain('"quantity": -1');
    expect(source).toContain('"bid_as_of": None');
    expect(source).toContain('"provider": "tradier"');
    expect(records[0].source).toBe('# unchanged custom Python');
    const echo = structuredClone(d);
    Object.assign(echo.strategy.legs[0].source!, {
      observed_exercise_style: 'unknown',
      observed_settlement: 'unknown',
    });
    expect(requestChanged(d, echo)).toBe(false);
    expect(addOptionLeg(d, 0)).toBe(true);
    d.strategy.legs[1].source!.contract_symbol = 'different';
    expect(d.strategy.legs[0].source!.contract_symbol).toBe('XYZ-EXAMPLE');
  });
  it('normalizes omitted and null overrides but never treats an explicit zero as omitted', () => {
    const d = calendar(),
      same = structuredClone(d);
    same.strategy.legs[1].days_to_expiry = null;
    same.strategy.legs[1].expiry_date = null;
    same.strategy.legs[1].source = null;
    expect(requestChanged(d, same)).toBe(false);
    same.strategy.legs[1].days_to_expiry = 0;
    expect(requestChanged(d, same)).toBe(true);
  });
  it('converting a contract to underlying explicitly clears expiry/source metadata', () => {
    const d = calendar(),
      leg = d.strategy.legs[0];
    setLegKind(leg, 'underlying', 100);
    expect(leg.days_to_expiry).toBeNull();
    expect(leg.expiry_date).toBeNull();
    expect(leg.source).toBeNull();
    expect(optionsErrors(d)).toEqual({});
  });
});

import { describe, expect, it } from 'vitest';
import {
  addDays,
  formatSavedAt,
  shortcutLabel,
  fractionInput,
  localIsoDate,
  matchTemplate,
  percentFieldError,
  percentInput,
  quotedSpot,
} from './optionsInputs';
import { applyOptionsTemplate, createOptionsDraft } from './optionsTemplates';
import { optionsErrors } from './optionsValidation';

describe('percent inputs', () => {
  it('shows fractions as clean percentages and converts back exactly', () => {
    expect(percentInput(0.2)).toBe(20);
    expect(percentInput(0.07)).toBe(7);
    expect(percentInput(0.283)).toBe(28.3);
    expect(fractionInput(28.3)).toBe(0.283);
    expect(fractionInput(20)).toBe(0.2);
    expect(percentInput(Number.NaN)).toBeNaN();
  });
});

describe('calendar dates', () => {
  it('uses the local calendar day and adds whole days', () => {
    expect(localIsoDate(new Date(2026, 9, 17, 23, 30))).toBe('2026-10-17');
    expect(addDays('2026-10-17', 30)).toBe('2026-11-16');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('starts new drafts dated from today with a 30-day expiry', () => {
    const draft = createOptionsDraft(new Date(2026, 9, 17, 12));
    expect(draft.strategy.valuation_date).toBe('2026-10-17');
    expect(draft.strategy.expiry_date).toBe('2026-11-16');
    expect(draft.strategy.days_to_expiry).toBe(30);
    expect(optionsErrors(draft)).toEqual({});
  });
});

describe('matchTemplate', () => {
  it('recognises untouched template legs at the draft spot', () => {
    expect(matchTemplate(createOptionsDraft())).toBe('long_call');
    const condor = createOptionsDraft();
    applyOptionsTemplate(condor, 'iron_condor');
    expect(matchTemplate(condor)).toBe('iron_condor');
  });

  it('returns null once legs are edited', () => {
    const draft = createOptionsDraft();
    draft.strategy.legs[0].strike = 120;
    expect(matchTemplate(draft)).toBeNull();
  });
});

describe('percentFieldError', () => {
  it('states percent fields in percent and leaves others alone', () => {
    expect(percentFieldError('volatility', 'Number required, 0 to 5.')).toBe(
      'Use 0–500%.',
    );
    expect(percentFieldError('rate', 'Number required, -1 to 1.')).toBe(
      'Use −100% to 100%.',
    );
    expect(percentFieldError('legs.2.implied_volatility', 'x')).toBe(
      'Use 0–500%, or leave blank for the base IV.',
    );
    expect(percentFieldError('spot', 'Number required.')).toBe(
      'Number required.',
    );
    expect(percentFieldError('volatility', undefined)).toBeUndefined();
  });
});

describe('quotedSpot', () => {
  it('rounds a chart close to cents, keeping small prices significant', () => {
    expect(quotedSpot(343.4599914550781)).toBe(343.46);
    expect(quotedSpot(0.000123456)).toBe(0.0001235);
  });
});

describe('shortcutLabel', () => {
  it('shows the Command key on Apple platforms', () => {
    expect(shortcutLabel('MacIntel')).toBe('⌘↵');
    expect(shortcutLabel('iPhone')).toBe('⌘↵');
    expect(shortcutLabel('Win32')).toBe('Ctrl+Enter');
    expect(shortcutLabel('')).toBe('Ctrl+Enter');
  });
});

describe('formatSavedAt', () => {
  it('reads as a date and a relative time, never a raw ISO string', () => {
    const text = formatSavedAt(
      '2026-10-18T09:00:00.000Z',
      new Date('2026-10-18T09:05:00.000Z'),
    );
    expect(text).toContain('5 minutes ago');
    expect(text).toContain('2026');
    expect(text).not.toContain('T09:00');
    expect(formatSavedAt('not a date')).toBe('an unknown time');
  });
});

describe('matchTemplate with edits a re-template would lose', () => {
  it('refuses legs with overrides, quotes, sources or manual premiums', () => {
    const iv = createOptionsDraft();
    iv.strategy.legs[0].implied_volatility = 0.35;
    expect(matchTemplate(iv)).toBeNull();
    const quoted = createOptionsDraft();
    quoted.strategy.legs[0].bid = 4;
    expect(matchTemplate(quoted)).toBeNull();
    const dated = createOptionsDraft();
    dated.strategy.legs[0].days_to_expiry = 60;
    expect(matchTemplate(dated)).toBeNull();
    expect(matchTemplate(createOptionsDraft(), [false])).toBeNull();
    expect(matchTemplate(createOptionsDraft(), [true])).toBe('long_call');
  });
});

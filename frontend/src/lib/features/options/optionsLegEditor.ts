import type { OptionLeg, OptionsDraft } from './optionsTypes';
import { optionsErrors } from './optionsValidation';

export interface OptionsEditorProps {
  draft: OptionsDraft;
  onEdit: (update: (draft: OptionsDraft) => void) => void;
  fieldErrors?: Record<string, string>;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
}

export const MAX_OPTIONS_LEGS = 16;
export type LegSide = 'buy' | 'sell';
export const legSide = (leg: OptionLeg): LegSide =>
  leg.quantity < 0 || Object.is(leg.quantity, -0) ? 'sell' : 'buy';

export function setLegSize(
  leg: OptionLeg,
  size: number,
  side = legSide(leg),
): void {
  leg.quantity = size < 0 ? NaN : (side === 'sell' ? -1 : 1) * size;
}

export function editOptionLeg(
  draft: OptionsDraft,
  index: number,
  update: (leg: OptionLeg) => void,
): void {
  const leg = draft.strategy.legs[index];
  if (!leg) return;
  update(leg);
  draft.strategy.template = 'custom';
}

export function setLegKind(
  leg: OptionLeg,
  kind: OptionLeg['kind'],
  spot: number,
): void {
  const wasUnderlying = leg.kind === 'underlying';
  leg.kind = kind;
  if (kind === 'underlying') {
    leg.strike = null;
    leg.multiplier = 1;
    leg.implied_volatility = null;
    leg.bid = null;
    leg.ask = null;
    leg.quote_as_of = null;
    leg.days_to_expiry = null;
    leg.expiry_date = null;
    leg.source = null;
  } else if (wasUnderlying) {
    leg.strike = spot;
    leg.multiplier = 100;
    setLegSize(leg, 1);
  }
}

export function addOptionLeg(draft: OptionsDraft, copyIndex?: number): boolean {
  if (draft.strategy.legs.length >= MAX_OPTIONS_LEGS) return false;
  const copy = copyIndex === undefined ? null : draft.strategy.legs[copyIndex];
  if (copyIndex !== undefined && !copy) return false;
  const leg: OptionLeg = copy
    ? structuredClone(copy)
    : {
        kind: 'call',
        quantity: 1,
        strike: draft.spot,
        entry_premium: 0,
        multiplier: 100,
        enabled: true,
      };
  draft.strategy.legs.splice(
    copyIndex === undefined ? draft.strategy.legs.length : copyIndex + 1,
    0,
    leg,
  );
  draft.strategy.template = 'custom';
  return true;
}

export function removeOptionLeg(draft: OptionsDraft, index: number): boolean {
  if (draft.strategy.legs.length <= 1 || !draft.strategy.legs[index])
    return false;
  draft.strategy.legs.splice(index, 1);
  draft.strategy.template = 'custom';
  return true;
}

export function moveOptionLeg(
  draft: OptionsDraft,
  index: number,
  direction: -1 | 1,
): boolean {
  const legs = draft.strategy.legs;
  const target = index + direction;
  if (!legs[index] || !legs[target]) return false;
  [legs[index], legs[target]] = [legs[target], legs[index]];
  draft.strategy.template = 'custom';
  return true;
}

function utcDate(value: string): number | null {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) || value.startsWith('0000'))
    return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) &&
    new Date(time).toISOString().slice(0, 10) === value
    ? time
    : null;
}

export function commonDateHorizon(
  valuation?: string | null,
  expiry?: string | null,
): number | null {
  if (!valuation || !expiry) return null;
  const start = utcDate(valuation),
    end = utcDate(expiry);
  if (start === null || end === null) return null;
  const days = (end - start) / 86400000;
  return days >= 0 && days <= 3650 ? days : null;
}

export function setCommonDate(
  draft: OptionsDraft,
  key: 'valuation_date' | 'expiry_date',
  value: string,
): void {
  draft.strategy[key] = value || null;
  const days = commonDateHorizon(
    draft.strategy.valuation_date,
    draft.strategy.expiry_date,
  );
  if (days !== null) draft.strategy.days_to_expiry = days;
}

export function clearCommonDates(draft: OptionsDraft): void {
  draft.strategy.valuation_date = null;
  draft.strategy.expiry_date = null;
}

export function validQuoteTimestamp(value?: string | null): boolean {
  if (!value || value.length > 64) return false;
  const match =
    /^([0-9]{4}-[0-9]{2}-[0-9]{2})T([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\.[0-9]+)?)?(?:Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])$/.exec(
      value,
    );
  return (
    !!match &&
    utcDate(match[1]) !== null &&
    +match[2] < 24 &&
    +match[3] < 60 &&
    +(match[4] ?? 0) < 60 &&
    Number.isFinite(Date.parse(value))
  );
}

export function quoteMidpoint(leg: OptionLeg): number | null {
  if (
    leg.kind === 'underlying' ||
    !validQuoteTimestamp(leg.quote_as_of) ||
    leg.bid == null ||
    leg.ask == null ||
    !Number.isFinite(leg.bid) ||
    !Number.isFinite(leg.ask) ||
    leg.bid < 0 ||
    leg.ask < leg.bid ||
    leg.ask > 1000000
  )
    return null;
  return (leg.bid + leg.ask) / 2;
}

export function useQuoteMidpoint(draft: OptionsDraft, index: number): boolean {
  const leg = draft.strategy.legs[index];
  if (!leg) return false;
  const midpoint = quoteMidpoint(leg);
  if (midpoint === null) return false;
  editOptionLeg(draft, index, l => {
    l.entry_premium = midpoint;
  });
  return true;
}

export function manualQuoteAge(
  value?: string | null,
  now = Date.now(),
): string {
  if (!value) return 'No as-of timestamp entered; age unknown.';
  if (!validQuoteTimestamp(value))
    return 'Invalid as-of timestamp; age unknown.';
  const elapsed = (now - Date.parse(value)) / 1000;
  if (elapsed < 0)
    return 'Entered timestamp is in the future; not a freshness check.';
  const unit = elapsed >= 86400 ? 'day' : elapsed >= 3600 ? 'hour' : 'minute';
  const divisor = unit === 'day' ? 86400 : unit === 'hour' ? 3600 : 60;
  const age = Math.floor(elapsed / divisor);
  return `Entered timestamp age at render: ${age} ${unit}${age === 1 ? '' : 's'}. Not a freshness check.`;
}

/** Additional editor metadata validation; merge with existing optionsErrors at submit. */
export function optionsEditorErrors(
  draft: OptionsDraft,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const strategy = draft.strategy;
  if (
    strategy.underlying != null &&
    (!strategy.underlying.trim() || strategy.underlying.length > 80)
  )
    errors['strategy.underlying'] =
      'Enter a nonblank manual identity up to 80 characters, or leave blank.';
  const valuation = strategy.valuation_date,
    expiry = strategy.expiry_date;
  if (expiry != null) {
    for (const [key, value] of [
      ['valuation_date', valuation],
      ['expiry_date', expiry],
    ] as const)
      if (!value || utcDate(value) === null)
        errors[`strategy.${key}`] =
          'Both valid calendar dates (YYYY-MM-DD) are required, or clear both.';
    if (!errors['strategy.valuation_date'] && !errors['strategy.expiry_date']) {
      const days = commonDateHorizon(valuation, expiry);
      if (days === null)
        errors['strategy.expiry_date'] =
          'Expiry must be 0–3650 UTC calendar days after valuation.';
      else if (days !== strategy.days_to_expiry)
        errors['strategy.days_to_expiry'] =
          'Common days to expiry must exactly match the paired UTC dates.';
    }
  }
  strategy.legs.forEach((leg, i) => {
    const key = `legs.${i}`;
    if (leg.kind === 'underlying') {
      if (
        [leg.implied_volatility, leg.bid, leg.ask, leg.quote_as_of].some(
          v => v != null,
        )
      )
        errors[`${key}.kind`] =
          'Underlying shares cannot carry option IV or quote metadata; use Reset share fields to clear it.';
      return;
    }
    if (
      leg.implied_volatility != null &&
      (!Number.isFinite(leg.implied_volatility) ||
        leg.implied_volatility < 0 ||
        leg.implied_volatility > 5)
    )
      errors[`${key}.implied_volatility`] =
        'Use a fraction 0–5 (0–500%), or blank for base IV.';
    for (const field of ['bid', 'ask'] as const)
      if (
        leg[field] != null &&
        (!Number.isFinite(leg[field]) ||
          leg[field]! < 0 ||
          leg[field]! > 1000000)
      )
        errors[`${key}.${field}`] =
          'Manual price must be 0–1,000,000 USD/unit, or blank.';
    if ((leg.bid == null) !== (leg.ask == null))
      errors[`${key}.${leg.bid == null ? 'bid' : 'ask'}`] =
        'Enter both bid and ask, or clear both.';
    if (leg.bid != null && leg.ask != null && leg.bid > leg.ask)
      errors[`${key}.ask`] =
        'Ask must be at least bid; crossed quotes cannot supply a midpoint.';
    if (
      (leg.quote_as_of != null || leg.bid != null || leg.ask != null) &&
      !validQuoteTimestamp(leg.quote_as_of)
    )
      errors[`${key}.quote_as_of`] =
        'Enter an explicit ISO timestamp with Z or ±HH:MM offset (up to 64 characters).';
  });
  for (const [key, value] of Object.entries(optionsErrors(draft)))
    if (
      key.includes('expiry') ||
      key.endsWith('.source') ||
      key === 'strategy.valuation_date'
    )
      errors[key] = value;
  return errors;
}

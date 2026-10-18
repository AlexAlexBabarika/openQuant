import type { OptionsDraft } from './optionsTypes';
import {
  OPTIONS_TEMPLATES,
  templateStrategy,
  type OptionsTemplate,
} from './optionsTemplates';

/** IV, rate and yield are edited as percentages and sent as annual fractions. */
export const percentInput = (fraction: number): number =>
  Number((fraction * 100).toPrecision(12));
export const fractionInput = (percent: number): number =>
  Number((percent / 100).toPrecision(12));

export function localIsoDate(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000)
    .toISOString()
    .slice(0, 10);
}

/**
 * The template whose legs the draft still has untouched at its spot, if any: same kind,
 * size, strike and multiplier, no IV, expiry, quote or source overrides and, when model
 * tags are given, every premium still following the model.
 */
export function matchTemplate(
  draft: OptionsDraft,
  modelLegs?: boolean[],
): OptionsTemplate | null {
  const legs = draft.strategy.legs;
  if (modelLegs && !legs.every((_, i) => modelLegs[i])) return null;
  const untouched = legs.every(
    l =>
      l.enabled &&
      [
        l.implied_volatility,
        l.days_to_expiry,
        l.expiry_date,
        l.bid,
        l.ask,
        l.quote_as_of,
        l.source,
      ].every(v => v == null),
  );
  if (!untouched) return null;
  for (const [id] of OPTIONS_TEMPLATES) {
    const template = templateStrategy(id, draft.spot).legs;
    if (
      template.length === legs.length &&
      template.every(
        (t, i) =>
          t.kind === legs[i].kind &&
          t.quantity === legs[i].quantity &&
          t.strike === legs[i].strike &&
          t.multiplier === legs[i].multiplier,
      )
    )
      return id;
  }
  return null;
}

/** Range errors are written in fractions; fields edited as percentages restate them in percent. */
export function percentFieldError(
  key: string,
  message: string | undefined,
): string | undefined {
  if (!message) return message;
  if (key === 'volatility') return 'Use 0–500%.';
  if (key === 'rate' || key === 'dividend_yield') return 'Use −100% to 100%.';
  if (/^legs\.\d+\.implied_volatility$/.test(key))
    return 'Use 0–500%, or leave blank for the base IV.';
  return message;
}

/** Chart closes arrive as float32 noise (343.4599914550781); quote them in cents, or 4 figures below $1. */
export const quotedSpot = (spot: number): number =>
  spot >= 1 ? Math.round(spot * 100) / 100 : Number(spot.toPrecision(4));

/** The run shortcut as people press it: ⌘↵ on Apple platforms. */
export const shortcutLabel = (platform: string): string =>
  /Mac|iPhone|iPad|iPod/.test(platform) ? '⌘↵' : 'Ctrl+Enter';

/** "Oct 18, 2026, 9:00 AM (5 minutes ago)" in the viewer's time zone. */
export function formatSavedAt(iso: string, now = new Date()): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return 'an unknown time';
  const date = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(time);
  const seconds = Math.round((time - now.getTime()) / 1000);
  const [value, unit] =
    Math.abs(seconds) < 3600
      ? [Math.round(seconds / 60), 'minute' as const]
      : Math.abs(seconds) < 86400
        ? [Math.round(seconds / 3600), 'hour' as const]
        : [Math.round(seconds / 86400), 'day' as const];
  const relative = new Intl.RelativeTimeFormat('en', {
    numeric: 'auto',
  }).format(value, unit);
  return `${date} (${relative})`;
}

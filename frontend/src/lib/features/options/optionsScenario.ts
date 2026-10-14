import type {
  OptionsDraft,
  OptionsSurfaceAnalysis,
  OptionsSurfaceRequest,
} from './optionsTypes';
import { exactValue, finiteValue } from './optionsChart';
import { spotGrid } from './optionsTemplates';

export interface SurfaceSettings {
  axis: OptionsSurfaceRequest['axis'];
  spotStart: number;
  spotEnd: number;
  spotCount: number;
  stepStart: number;
  stepEnd: number;
  stepCount: number;
}

export function ivShiftBounds(
  draft: OptionsDraft,
): { min: number; max: number } | null {
  const ivs = [
    draft.volatility,
    ...draft.strategy.legs
      .filter(l => l.enabled && l.kind !== 'underlying')
      .map(l => l.implied_volatility ?? draft.volatility),
  ];
  if (ivs.some(v => !finiteValue(v) || v < 0 || v > 5)) return null;
  return {
    min: Math.max(-100, ...ivs.map(v => -v * 100)) || 0,
    max: Math.min(100, ...ivs.map(v => (5 - v) * 100)),
  };
}

export function scenarioInputError(
  draft: OptionsDraft,
  elapsed: number,
  shift: number,
): string | null {
  const bounds = ivShiftBounds(draft);
  if (
    !finiteValue(draft.strategy.days_to_expiry) ||
    draft.strategy.days_to_expiry < 0 ||
    draft.strategy.days_to_expiry > 3650 ||
    !finiteValue(elapsed) ||
    elapsed < 0 ||
    elapsed > draft.strategy.days_to_expiry
  )
    return 'Elapsed days must be within the common 0–expiry horizon (up to 3650 days).';
  if (
    !bounds ||
    !finiteValue(shift) ||
    shift < bounds.min ||
    shift > bounds.max
  )
    return 'IV shift must keep the declared base and every enabled option IV within 0–500%, and stay within −100–100 pp.';
  return null;
}

export function scenarioNameError(
  draft: OptionsDraft,
  index: number,
): string | null {
  const name = draft.scenarios[index].name;
  return !name.trim() ||
    name.length > 80 ||
    draft.scenarios.some((s, i) => i !== index && s.name === name)
    ? 'Enter a unique nonblank scenario name (up to 80 characters).'
    : null;
}

export function surfaceSettings(draft: OptionsDraft): SurfaceSettings {
  const surface = draft.surface;
  const bounds = ivShiftBounds(draft);
  const axis =
    surface?.axis ??
    (draft.strategy.days_to_expiry === 0 ? 'iv_shift_pp' : 'elapsed_days');
  return {
    axis,
    spotStart: surface?.spots[0] ?? draft.spot_grid[0] ?? 0,
    spotEnd:
      surface?.spots[surface.spots.length - 1] ??
      draft.spot_grid[draft.spot_grid.length - 1] ??
      draft.spot,
    spotCount: surface?.spots.length ?? 11,
    stepStart:
      surface?.steps[0] ??
      (axis === 'elapsed_days' ? 0 : Math.max(-10, bounds?.min ?? 0)),
    stepEnd:
      surface?.steps[surface.steps.length - 1] ??
      (axis === 'elapsed_days'
        ? draft.strategy.days_to_expiry
        : Math.min(10, bounds?.max ?? 0)),
    stepCount: surface?.steps.length ?? 7,
  };
}

export function surfaceSettingsErrors(
  draft: OptionsDraft,
  settings: SurfaceSettings,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const { axis, spotStart, spotEnd, spotCount, stepStart, stepEnd, stepCount } =
    settings;
  if (!['elapsed_days', 'iv_shift_pp'].includes(axis))
    errors.axis = 'Choose elapsed days or IV shift.';
  if (
    !finiteValue(spotStart) ||
    !finiteValue(spotEnd) ||
    spotStart < 0 ||
    spotEnd > 1000000 ||
    spotStart >= spotEnd
  )
    errors.spots = 'Use 0 ≤ spot start < end ≤ 1,000,000 USD.';
  if (!Number.isInteger(spotCount) || spotCount < 2 || spotCount > 41)
    errors.spotCount = 'Use 2–41 spot columns.';
  if (!Number.isInteger(stepCount) || stepCount < 2 || stepCount > 21)
    errors.stepCount = 'Use 2–21 step rows (at most 861 cells).';
  const bounds =
    axis === 'elapsed_days'
      ? { min: 0, max: draft.strategy.days_to_expiry }
      : ivShiftBounds(draft);
  if (
    !bounds ||
    !finiteValue(bounds.max) ||
    (axis === 'elapsed_days' && (bounds.max < 0 || bounds.max > 3650)) ||
    !finiteValue(stepStart) ||
    !finiteValue(stepEnd) ||
    stepStart < bounds.min ||
    stepEnd > bounds.max ||
    stepStart >= stepEnd
  )
    errors.steps =
      axis === 'elapsed_days'
        ? 'Use distinct increasing steps within 0–common expiry days. A zero-day horizon has no time surface.'
        : 'Use distinct increasing shifts within −100–100 pp; every enabled IV and the declared base must remain 0–500%.';
  const increasing = (values: number[]) =>
    values.every((v, i) => finiteValue(v) && (i === 0 || v > values[i - 1]));
  if (
    !errors.spots &&
    !errors.spotCount &&
    !increasing(spotGrid(spotStart, spotEnd, spotCount))
  )
    errors.spots =
      'Widen the USD range or reduce columns: floating-point grid coordinates must remain distinct.';
  if (
    !errors.steps &&
    !errors.stepCount &&
    !increasing(spotGrid(stepStart, stepEnd, stepCount))
  )
    errors.steps =
      'Widen the step range or reduce rows: floating-point grid coordinates must remain distinct.';
  return errors;
}

export function buildSurface(
  draft: OptionsDraft,
  settings: SurfaceSettings,
): OptionsSurfaceRequest | null {
  if (Object.keys(surfaceSettingsErrors(draft, settings)).length) return null;
  return {
    axis: settings.axis,
    spots: spotGrid(settings.spotStart, settings.spotEnd, settings.spotCount),
    steps: spotGrid(settings.stepStart, settings.stepEnd, settings.stepCount),
  };
}

export function surfaceDataError(
  surface: OptionsSurfaceAnalysis,
): string | null {
  const ordered = (values: number[], max: number) =>
    Array.isArray(values) &&
    values.length >= 2 &&
    values.length <= max &&
    values.every((v, i) => finiteValue(v) && (i === 0 || v > values[i - 1]));
  if (
    !['elapsed_days', 'iv_shift_pp'].includes(surface.axis) ||
    !ordered(surface.spots, 41) ||
    !ordered(surface.steps, 21) ||
    surface.spots.some(s => s < 0 || s > 1000000) ||
    surface.steps.some(s =>
      surface.axis === 'elapsed_days' ? s < 0 || s > 3650 : s < -100 || s > 100,
    ) ||
    !Array.isArray(surface.pnl) ||
    surface.pnl.length > surface.steps.length ||
    surface.pnl.some(
      row => !Array.isArray(row) || row.length > surface.spots.length,
    )
  )
    return 'Canonical heatmap unavailable: returned axes or matrix bounds are invalid.';
  return null;
}

export function surfaceValue(
  surface: OptionsSurfaceAnalysis,
  row: number,
  column: number,
): number | null {
  const value = surface.pnl[row]?.[column];
  return finiteValue(value) ? value : null;
}

export function surfaceCellLabel(
  surface: OptionsSurfaceAnalysis,
  row: number,
  column: number,
): string {
  const value = surfaceValue(surface, row, column);
  return `P&L: ${value == null ? 'Unavailable (no result)' : `${exactValue(value, true)} USD`}; spot ${exactValue(surface.spots[column])} USD; ${surface.axis === 'elapsed_days' ? 'elapsed calendar days' : 'IV shift pp'} ${exactValue(surface.steps[row], surface.axis === 'iv_shift_pp')}`;
}

export function surfaceKeyboardCell(
  row: number,
  column: number,
  rows: number,
  columns: number,
  key: string,
  ctrl = false,
): { row: number; column: number } | undefined {
  switch (key) {
    case 'ArrowLeft':
      return { row, column: Math.max(0, column - 1) };
    case 'ArrowRight':
      return { row, column: Math.min(columns - 1, column + 1) };
    case 'ArrowUp':
      return { row: Math.max(0, row - 1), column };
    case 'ArrowDown':
      return { row: Math.min(rows - 1, row + 1), column };
    case 'Home':
      return { row: ctrl ? 0 : row, column: 0 };
    case 'End':
      return { row: ctrl ? rows - 1 : row, column: columns - 1 };
    default:
      return undefined;
  }
}

export function requestChanged(
  draft: OptionsDraft,
  submitted: OptionsDraft,
): boolean {
  const normalized = (d: OptionsDraft) => ({
    ...d,
    surface: d.surface ?? null,
    strategy: {
      ...d.strategy,
      underlying: d.strategy.underlying ?? null,
      valuation_date: d.strategy.valuation_date ?? null,
      expiry_date: d.strategy.expiry_date ?? null,
      legs: d.strategy.legs.map(l => ({
        ...l,
        implied_volatility: l.implied_volatility ?? null,
        bid: l.bid ?? null,
        ask: l.ask ?? null,
        quote_as_of: l.quote_as_of ?? null,
      })),
    },
  });
  const sorted = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(sorted)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, sorted(v)]),
          )
        : value;
  return (
    JSON.stringify(sorted(normalized(draft))) !==
    JSON.stringify(sorted(normalized(submitted)))
  );
}

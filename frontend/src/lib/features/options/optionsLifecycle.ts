import type { OptionLeg, OptionsDraft } from './optionsTypes';
import type {
  LifecycleRequest,
  LifecycleResponse,
  PathPoint,
  ResearchPath,
  ResearchProvenance,
} from './optionsResearchTypes';
import { editLegContract } from './optionsLegEditor';
import { optionsErrors, resolvedLegDays } from './optionsValidation';

export const MAX_PATH_POINTS = 366;
export const MAX_PATH_TEXT = 24000;
export interface PathControls {
  source: 'supplied' | 'synthetic';
  csv: string;
  seed: string;
  horizon: string;
  steps: string;
  drift: string;
  volatility: string;
}
export type FieldErrors = Record<string, string>;
export const researchValue = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? 'Unavailable' : String(n);

export function lastExpiry(draft: OptionsDraft): number {
  return Math.max(
    0,
    ...draft.strategy.legs
      .filter(l => l.enabled && l.kind !== 'underlying')
      .map(l => resolvedLegDays(draft.strategy, l)),
  );
}
export function pathControls(draft: OptionsDraft): PathControls {
  const horizon = lastExpiry(draft);
  const days = Number.isFinite(horizon) && horizon > 0 ? horizon : 30;
  return {
    source: 'synthetic',
    csv: `day,spot\n0,${draft.spot}\n${days},${draft.spot}`,
    seed: '1',
    horizon: String(days),
    steps: '30',
    drift: '0',
    volatility: String(draft.volatility),
  };
}
export function boundedNumber(
  value: string,
  min: number,
  max: number,
  integer = false,
): number | null {
  if (!value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) &&
    n >= min &&
    n <= max &&
    (!integer || Number.isInteger(n))
    ? n
    : null;
}
export function parsePathCsv(text: string): {
  points: PathPoint[];
  error?: string;
} {
  if (text.length > MAX_PATH_TEXT)
    return {
      points: [],
      error: `CSV must be at most ${MAX_PATH_TEXT} characters.`,
    };
  const lines = text.trim().split(/\r?\n/);
  if (/^day\s*,\s*spot$/i.test(lines[0]?.trim() ?? '')) lines.shift();
  if (!lines.length || lines.length > MAX_PATH_POINTS)
    return {
      points: [],
      error: 'Supply 1–366 day,spot rows with an optional day,spot header.',
    };
  const points: PathPoint[] = [];
  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i].split(',');
    const day = boundedNumber(cells[0] ?? '', 0, 3650);
    const spot = boundedNumber(cells[1] ?? '', 0, 1000000);
    if (cells.length !== 2 || day === null || spot === null)
      return {
        points: [],
        error: `Row ${i + 1}: enter day 0–3650 and spot 0–1,000,000 USD, separated by one comma. Blank is not zero.`,
      };
    if ((i === 0 && day !== 0) || (i > 0 && day <= points[i - 1].day))
      return {
        points: [],
        error: `Row ${i + 1}: days must start at 0 and strictly increase.`,
      };
    points.push({ day, spot });
  }
  return { points };
}
export function pathRequest(
  draft: OptionsDraft,
  controls: PathControls,
): { path: ResearchPath | null; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const end = lastExpiry(draft);
  if (controls.source === 'supplied') {
    const parsed = parsePathCsv(controls.csv);
    if (parsed.error) errors.csv = parsed.error;
    else if (parsed.points[0].spot !== draft.spot)
      errors.csv = 'Day-zero spot must exactly equal the draft spot (USD).';
    else if (parsed.points[parsed.points.length - 1].day < end)
      errors.csv = `Path must cover every active expiry, through day ${researchValue(end)}.`;
    return {
      path: Object.keys(errors).length
        ? null
        : { source: 'supplied', points: parsed.points },
      errors,
    };
  }
  const fields = [
    ['seed', 0, 4294967295, true],
    ['horizon', Number.MIN_VALUE, 3650, false],
    ['steps', 1, 365, true],
    ['drift', -1, 1, false],
    ['volatility', 0, 5, false],
  ] as const;
  const values: Record<string, number> = {};
  for (const [key, min, max, integer] of fields) {
    const value = boundedNumber(controls[key], min, max, integer);
    if (value === null)
      errors[key] =
        `Enter ${integer ? 'an integer' : 'a finite number'} ${key === 'horizon' ? '>0' : min}–${max}; blank is not zero.`;
    else values[key] = value;
  }
  if (values.horizon < end)
    errors.horizon = `Horizon must cover every active expiry, through day ${researchValue(end)}.`;
  return {
    path: Object.keys(errors).length
      ? null
      : {
          source: 'synthetic',
          generator: 'gbm_seeded_v1',
          seed: values.seed,
          horizon_days: values.horizon,
          steps: values.steps,
          annual_drift: values.drift,
          annual_volatility: values.volatility,
        },
    errors,
  };
}
export function lifecycleRequest(
  draft: OptionsDraft,
  controls: PathControls,
): { request: LifecycleRequest | null; errors: FieldErrors } {
  const { path, errors } = pathRequest(draft, controls);
  const all = { ...optionsErrors(draft), ...errors };
  return {
    request:
      path && !Object.keys(all).length
        ? { analysis: JSON.parse(JSON.stringify(draft)) as OptionsDraft, path }
        : null,
    errors: all,
  };
}
export const inputKey = (draft: OptionsDraft, settings: unknown): string =>
  JSON.stringify([draft, settings]);

export function setLegExpiry(
  draft: OptionsDraft,
  index: number,
  field: 'days_to_expiry' | 'expiry_date',
  value: number | string | null,
): void {
  const leg = draft.strategy.legs[index];
  if (!leg || leg.kind === 'underlying') return;
  editLegContract(
    leg,
    field === 'days_to_expiry'
      ? { days_to_expiry: value as number | null, expiry_date: null }
      : { expiry_date: value as string | null, days_to_expiry: null },
  );
  draft.strategy.template = 'custom';
}
export interface CalendarControls {
  template: 'calendar' | 'diagonal';
  kind: 'call' | 'put';
  nearDays: string;
  farDays: string;
  nearStrike: string;
  farStrike: string;
  nearPremium: string;
  farPremium: string;
  contracts: string;
  multiplier: string;
}
export function calendarControls(draft: OptionsDraft): CalendarControls {
  return {
    template: 'calendar',
    kind: 'call',
    nearDays: '30',
    farDays: '60',
    nearStrike: String(draft.spot),
    farStrike: String(draft.spot),
    nearPremium: '',
    farPremium: '',
    contracts: '1',
    multiplier: '100',
  };
}
export function calendarProposal(controls: CalendarControls): {
  legs: OptionLeg[] | null;
  errors: FieldErrors;
} {
  const errors: FieldErrors = {};
  const values: Record<string, number> = {};
  for (const [key, min, max, integer] of [
    ['nearDays', 0, 3650, false],
    ['farDays', 0, 3650, false],
    ['nearStrike', Number.MIN_VALUE, 1000000, false],
    ['farStrike', Number.MIN_VALUE, 1000000, false],
    ['nearPremium', 0, 1000000, false],
    ['farPremium', 0, 1000000, false],
    ['contracts', 1, 10000, true],
    ['multiplier', 1, 1000, true],
  ] as const) {
    if (key === 'farStrike' && controls.template === 'calendar') continue;
    const value = boundedNumber(controls[key], min, max, integer);
    if (value === null)
      errors[key] =
        `Enter ${integer ? 'an integer' : 'a finite number'} ${min === Number.MIN_VALUE ? '>0' : min}–${max}.`;
    else values[key] = value;
  }
  if (values.farDays <= values.nearDays)
    errors.farDays = 'Far expiry must be strictly after near expiry.';
  if (
    controls.template === 'diagonal' &&
    values.farStrike === values.nearStrike
  )
    errors.farStrike =
      'A diagonal uses different strikes; use calendar for equal strikes.';
  if (Object.keys(errors).length) return { legs: null, errors };
  const leg = (
    quantity: number,
    days: number,
    strike: number,
    premium: number,
  ): OptionLeg => ({
    kind: controls.kind,
    quantity,
    strike,
    entry_premium: premium,
    multiplier: values.multiplier,
    enabled: true,
    days_to_expiry: days,
  });
  return {
    legs: [
      leg(
        -values.contracts,
        values.nearDays,
        values.nearStrike,
        values.nearPremium,
      ),
      leg(
        values.contracts,
        values.farDays,
        controls.template === 'calendar' ? values.nearStrike : values.farStrike,
        values.farPremium,
      ),
    ],
    errors,
  };
}
export function applyCalendar(
  draft: OptionsDraft,
  controls: CalendarControls,
): boolean {
  const { legs } = calendarProposal(controls);
  if (!legs) return false;
  draft.strategy.legs = legs;
  draft.strategy.template = controls.template;
  return true;
}

export interface ResearchState<R> {
  documentKey: string;
  result: R | null;
  submittedKey: string;
  pending: boolean;
  error: string;
  notice: string;
}
export const emptyResearchState = <R>(
  documentKey: string,
): ResearchState<R> => ({
  documentKey,
  result: null,
  submittedKey: '',
  pending: false,
  error: '',
  notice: '',
});
export function researchError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (/timeout|timed out/.test(message))
    return 'Research timed out. Reduce path steps or retry explicitly.';
  if (/too large|oversize|size limit/.test(message))
    return 'Research exceeds the request/output limit. Reduce path steps.';
  if (/rate limit|too many|saturat/.test(message))
    return 'Research is busy or rate limited. Retry explicitly later.';
  return 'Research request failed. Inputs are retained. Check the draft/path and retry; the research endpoint may be unavailable.';
}

/** No result may cross a document/account boundary, even if abort is ignored. */
export class ResearchJob<Q, R> {
  state: ResearchState<R>;
  #generation = 0;
  #controller: AbortController | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  constructor(
    documentKey: string,
    private currentDocument: () => string,
    private publish: (state: ResearchState<R>) => void,
    private currentInput?: () => string,
  ) {
    this.state = emptyResearchState(documentKey);
  }
  #update(patch: Partial<ResearchState<R>>): void {
    this.state = { ...this.state, ...patch };
    this.publish(this.state);
  }
  reset(documentKey: string): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#generation++;
    this.#controller?.abort();
    this.#controller = null;
    this.state = emptyResearchState(documentKey);
    this.publish(this.state);
  }
  cancel(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#generation++;
    this.#controller?.abort();
    this.#controller = null;
    this.#update({
      pending: false,
      error: '',
      notice:
        'Cancelled. Previous submitted evidence, if any, is unchanged. Browser abort does not guarantee server computation stopped.',
    });
  }
  async submit(
    request: Q,
    key: string,
    call: (request: Q, signal: AbortSignal) => Promise<R>,
    validate: (result: R) => boolean,
  ): Promise<void> {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#controller?.abort();
    const generation = ++this.#generation;
    const documentKey = this.currentDocument();
    if (this.state.documentKey !== documentKey) {
      this.state = emptyResearchState(documentKey);
    }
    const controller = new AbortController();
    this.#controller = controller;
    const snapshot = structuredClone(request);
    this.#update({ pending: true, error: '', notice: '', documentKey });
    const current = () =>
      generation === this.#generation &&
      documentKey === this.currentDocument() &&
      (!this.currentInput || key === this.currentInput()) &&
      !controller.signal.aborted;
    this.#timer = setTimeout(() => {
      if (!current()) return;
      this.cancel();
      this.#update({
        error:
          'Research timed out after 15 seconds. Reduce path steps and retry explicitly.',
      });
    }, 15000);
    try {
      const result = await call(snapshot, controller.signal);
      if (!current()) return;
      if (!validate(result)) throw new Error('Invalid research response');
      this.#update({
        result,
        submittedKey: key,
        notice:
          'Submitted evidence · session only. Values below use the returned request, not live inputs.',
      });
    } catch (error) {
      if (current()) this.#update({ error: researchError(error) });
    } finally {
      if (generation === this.#generation && this.#timer !== null) {
        clearTimeout(this.#timer);
        this.#timer = null;
      }
      if (current()) {
        this.#controller = null;
        this.#update({ pending: false });
      }
    }
  }
}
export function validResearchContext(result: {
  provenance: ResearchProvenance;
  warnings: string[];
}): boolean {
  const p = result?.provenance;
  return (
    p?.version === '1' &&
    p.model === 'black_scholes_merton' &&
    p.currency === 'USD' &&
    p.day_basis === 'ACT/365' &&
    p.exercise_style === 'european' &&
    p.settlement === 'cash' &&
    p.input_source === 'manual_or_synthetic' &&
    Array.isArray(result.warnings) &&
    result.warnings.length <= 32 &&
    result.warnings.every(w => typeof w === 'string' && w.length <= 1000)
  );
}
export function validLifecycle(result: LifecycleResponse): boolean {
  return (
    !!result?.request?.analysis &&
    validResearchContext(result) &&
    [result.net_entry_cost, result.final_pnl].every(Number.isFinite) &&
    Array.isArray(result.path) &&
    result.path.length > 0 &&
    result.path.length <= 382 &&
    result.path.every(p => Number.isFinite(p.day) && Number.isFinite(p.spot)) &&
    Array.isArray(result.ledger) &&
    result.ledger.length > 0 &&
    result.ledger.length <= 382 &&
    Array.isArray(result.settlements) &&
    result.settlements.length <= 16 &&
    result.settlements.every(
      s =>
        [
          s.leg_index,
          s.day,
          s.spot,
          s.left_day,
          s.right_day,
          s.intrinsic_per_unit,
          s.signed_cash_flow,
        ].every(Number.isFinite) &&
        ['supplied', 'synthetic', 'linear_interpolation'].includes(
          s.observation,
        ),
    ) &&
    result.ledger.every(
      (row, i, rows) =>
        [
          row.day,
          row.spot,
          row.total_pnl,
          row.remaining_value,
          row.cumulative_settlement_cash,
          row.settlement_cash_flow,
        ].every(Number.isFinite) &&
        (!i || row.day > rows[i - 1].day) &&
        Array.isArray(row.legs) &&
        row.legs.length > 0 &&
        row.legs.length <= 16 &&
        row.legs.every(
          leg =>
            Number.isInteger(leg.leg_index) &&
            leg.leg_index >= 0 &&
            leg.leg_index < 16 &&
            Number.isFinite(leg.value) &&
            (leg.remaining_days === null ||
              Number.isFinite(leg.remaining_days)) &&
            ['disabled', 'underlying', 'model_mark', 'settled'].includes(
              leg.state,
            ),
        ),
    )
  );
}
export function observationIndex(
  index: number,
  count: number,
  key: string,
): number | null {
  const next =
    key === 'Home'
      ? 0
      : key === 'End'
        ? count - 1
        : key === 'ArrowRight'
          ? index + 1
          : key === 'ArrowLeft'
            ? index - 1
            : null;
  return next === null || !count
    ? null
    : Math.min(count - 1, Math.max(0, next));
}
export function pathChart(rows: { day: number; values: number[] }[]): {
  paths: string[];
  x: (day: number) => number;
  y: (value: number) => number;
  min: number;
  max: number;
} {
  const values = rows.flatMap(r => r.values).filter(Number.isFinite);
  const min = Math.min(0, ...values),
    max = Math.max(0, ...values);
  const start = rows[0]?.day ?? 0,
    end = rows[rows.length - 1]?.day ?? 1;
  const x = (day: number) => 50 + (580 * (day - start)) / (end - start || 1);
  const y = (value: number) => 180 - (150 * (value - min)) / (max - min || 1);
  const paths = (rows[0]?.values ?? []).map((_, series) =>
    rows
      .map((r, i) => `${i ? 'L' : 'M'}${x(r.day)},${y(r.values[series])}`)
      .join(' '),
  );
  return { paths, x, y, min, max };
}

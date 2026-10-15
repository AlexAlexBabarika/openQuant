import { apiJson } from '$lib/core/api';
import { scenarioInputError } from './optionsScenario';
import { optionsErrors } from './optionsValidation';
import type {
  GreekKey,
  OptionsAnalysis,
  OptionsDraft,
  OptionsGreeks,
} from './optionsTypes';

export interface StressSettings {
  name: string;
  spotChangePct: number;
  elapsedDays: number;
  ivShiftPP: number;
}
export const STRESS_PRESETS: readonly StressSettings[] = [
  {
    name: 'Earnings gap + IV crush',
    spotChangePct: 5,
    elapsedDays: 1,
    ivShiftPP: -10,
  },
  {
    name: 'Crash + IV spike',
    spotChangePct: -20,
    elapsedDays: 1,
    ivShiftPP: 20,
  },
  { name: 'Flat + time decay', spotChangePct: 0, elapsedDays: 7, ivShiftPP: 0 },
];

export function stressErrors(
  draft: OptionsDraft,
  settings: StressSettings,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!settings.name.trim() || settings.name.length > 80)
    errors.name = 'Use a nonblank label of at most 80 characters.';
  const spot = draft.spot * (1 + settings.spotChangePct / 100);
  if (
    !Number.isFinite(settings.spotChangePct) ||
    settings.spotChangePct <= -100 ||
    settings.spotChangePct > 1000 ||
    !Number.isFinite(spot) ||
    spot <= 0 ||
    spot > 1000000
  )
    errors.spotChangePct =
      'Use −100% < spot change ≤ 1000%, with resulting spot >0 and ≤1,000,000 USD.';
  const timeError = scenarioInputError(draft, settings.elapsedDays, 0);
  if (timeError) errors.elapsedDays = timeError;
  const ivError = scenarioInputError(draft, 0, settings.ivShiftPP);
  if (ivError) errors.ivShiftPP = ivError;
  return errors;
}

export function stressRequests(
  draft: OptionsDraft,
  settings: StressSettings,
): { baseline: OptionsDraft; stress: OptionsDraft } {
  const errors = stressErrors(draft, settings);
  if (Object.keys(errors).length)
    throw new Error(
      Object.entries(errors)
        .map(([k, v]) => `${k}: ${v}`)
        .join('; '),
    );
  const baseline = structuredClone(draft);
  baseline.scenarios = [];
  baseline.surface = null;
  baseline.spot_grid = [0, baseline.spot];
  const stress = structuredClone(baseline);
  stress.spot = draft.spot * (1 + settings.spotChangePct / 100);
  stress.spot_grid = [0, stress.spot];
  stress.scenarios = [
    {
      name: settings.name,
      elapsed_days: settings.elapsedDays,
      iv_shift_pp: settings.ivShiftPP,
    },
  ];
  const canonicalErrors = {
    ...optionsErrors(baseline),
    ...optionsErrors(stress),
  };
  if (Object.keys(canonicalErrors).length)
    throw new Error(
      Object.entries(canonicalErrors)
        .map(([k, v]) => `${k}: ${v}`)
        .join('; '),
    );
  return { baseline, stress };
}

export interface StressResult {
  baseline: OptionsAnalysis;
  stress: OptionsAnalysis;
}
export async function runStress(
  draft: OptionsDraft,
  settings: StressSettings,
  signal: AbortSignal,
): Promise<StressResult> {
  const requests = stressRequests(draft, settings);
  const analyze = (request: OptionsDraft) =>
    apiJson<OptionsAnalysis>('/options/analyze', {
      method: 'POST',
      body: JSON.stringify(request),
      signal,
    });
  const [baseline, stress] = await Promise.all([
    analyze(requests.baseline),
    analyze(requests.stress),
  ]);
  return { baseline, stress };
}

export const GREEK_KEYS: GreekKey[] = [
  'delta',
  'gamma',
  'theta',
  'vega',
  'rho',
];
export function researchDifference(
  value: number | null | undefined,
  baseline: number | null | undefined,
): number | null {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    typeof baseline === 'number' &&
    Number.isFinite(baseline)
    ? value - baseline
    : null;
}
export function greekDifferences(
  value: OptionsGreeks,
  baseline: OptionsGreeks,
): OptionsGreeks {
  return Object.fromEntries(
    GREEK_KEYS.map(key => [key, researchDifference(value[key], baseline[key])]),
  ) as unknown as OptionsGreeks;
}
export function stressEvidence(result: StressResult): {
  pnl: number | null;
  greeks: OptionsGreeks | null;
  pnlDifference: number | null;
} {
  const scenario = result.stress.scenarios[0];
  const index = result.stress.spot_grid.indexOf(result.stress.request.spot);
  const pnl = scenario?.pnl[index];
  return {
    pnl: typeof pnl === 'number' && Number.isFinite(pnl) ? pnl : null,
    greeks: scenario?.greeks ?? null,
    pnlDifference: researchDifference(pnl, result.baseline.summary.pnl_today),
  };
}

export function applyStressScenario(
  draft: OptionsDraft,
  settings: StressSettings,
): void {
  const errors = stressErrors(draft, settings);
  if (Object.keys(errors).length)
    throw new Error('Correct the stress inputs before applying.');
  const index = draft.scenarios.findIndex(s => s.name === settings.name);
  if (index < 0 && draft.scenarios.length >= 3)
    throw new Error(
      'The draft already has three scenarios. Remove one or use an existing scenario name.',
    );
  const scenario = {
    name: settings.name,
    elapsed_days: settings.elapsedDays,
    iv_shift_pp: settings.ivShiftPP,
  };
  if (index < 0) draft.scenarios.push(scenario);
  else draft.scenarios[index] = scenario;
}

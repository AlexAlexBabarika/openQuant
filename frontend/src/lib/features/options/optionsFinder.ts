import { getSessionGeneration } from '$lib/core/api';
import type { OptionLeg, OptionsDraft } from './optionsTypes';
import type { FinderCandidate, FinderRequest } from './optionsResearchTypes';
import { optionsErrors } from './optionsValidation';

/** A flight is valid only in the document/query/session that explicitly started it. */
export class OptionsToolFlight {
  private generation = 0;
  private controller: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  cancel(): void {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  start(key: () => string, onTimeout: () => void) {
    this.cancel();
    const generation = this.generation;
    const session = getSessionGeneration();
    const submittedKey = key();
    const controller = (this.controller = new AbortController());
    const current = () =>
      generation === this.generation &&
      session === getSessionGeneration() &&
      key() === submittedKey &&
      !controller.signal.aborted;
    this.timer = setTimeout(() => {
      if (current()) {
        this.cancel();
        onTimeout();
      }
    }, 15000);
    return {
      signal: controller.signal,
      current,
      finish: () => {
        if (generation === this.generation && this.timer !== null) {
          clearTimeout(this.timer);
          this.timer = null;
        }
      },
    };
  }
}

export function seedFinderUniverse(draft: OptionsDraft): OptionLeg[] {
  return structuredClone(
    draft.strategy.legs
      .filter(leg => leg.enabled && leg.kind !== 'underlying')
      .map(leg => ({ ...leg, quantity: 1, enabled: true })),
  );
}

export function manualFinderContract(draft: OptionsDraft): OptionLeg {
  return {
    kind: 'call',
    quantity: 1,
    strike: draft.spot,
    entry_premium: NaN,
    multiplier: 100,
    enabled: true,
  };
}

export function editFinderContract(
  leg: OptionLeg,
  update: Partial<OptionLeg>,
): OptionLeg {
  const next = { ...structuredClone(leg), ...update };
  if (
    ['kind', 'strike', 'days_to_expiry', 'expiry_date', 'multiplier'].some(
      k => k in update,
    )
  ) {
    next.source = null;
    next.bid = null;
    next.ask = null;
    next.quote_as_of = null;
  }
  return next;
}

export function parseFinderSpots(text: string): number[] {
  if (!text.trim()) return [];
  if (text.length > 256) return [NaN];
  return text
    .trim()
    .split(/[\s,]+/)
    .map(Number);
}

export function finderErrors(request: FinderRequest): Record<string, string> {
  const errors = Object.fromEntries(
    Object.entries(optionsErrors(request.analysis)).map(([key, value]) => [
      `analysis.${key}`,
      value,
    ]),
  );
  const bounded = (
    key: string,
    value: number | undefined,
    min: number,
    max: number,
    integer = false,
  ) => {
    if (
      value === undefined ||
      !Number.isFinite(value) ||
      value < min ||
      value > max ||
      (integer && !Number.isInteger(value))
    )
      errors[key] =
        `Use ${integer ? 'an integer' : 'a number'} from ${min} to ${max}.`;
  };
  bounded(
    'constraints.max_entry_debit',
    request.constraints.max_entry_debit,
    0,
    1e12,
  );
  bounded('constraints.max_loss', request.constraints.max_loss, 0, 1e12);
  bounded(
    'constraints.max_total_contracts',
    request.constraints.max_total_contracts ?? 10,
    1,
    100,
    true,
  );
  bounded(
    'constraints.max_legs',
    request.constraints.max_legs ?? 4,
    1,
    4,
    true,
  );
  bounded('limit', request.limit ?? 10, 1, 20, true);
  bounded('max_evaluations', request.max_evaluations ?? 2000, 1, 2000, true);
  if (!['bullish', 'bearish', 'neutral'].includes(request.thesis))
    errors.thesis = 'Choose a thesis.';
  if (
    request.scenario_spots.length < 1 ||
    request.scenario_spots.length > 9 ||
    request.scenario_spots.some(
      (v, i, a) =>
        !Number.isFinite(v) || v < 0 || v > 1e6 || (i > 0 && v <= a[i - 1]),
    )
  )
    errors.scenario_spots =
      'Enter 1–9 strictly increasing spots, 0–1000000 USD, separated by commas or spaces.';
  if (request.universe.length < 1 || request.universe.length > 24)
    errors.universe =
      'Explicitly author or seed 1–24 enabled unit option contracts.';
  if (request.universe.length > 24) return errors;
  request.universe.forEach((leg, index) => {
    if (leg.kind === 'underlying' || leg.quantity !== 1 || !leg.enabled)
      errors[`universe.${index}`] =
        'Use an enabled +1 call or put contract; the backend enumerates signed candidates.';
    const single = {
      ...request.analysis,
      strategy: { ...request.analysis.strategy, legs: [leg] },
    };
    for (const [key, value] of Object.entries(optionsErrors(single))) {
      if (key === 'draft' || key.startsWith('legs.0.'))
        errors[
          key === 'draft'
            ? `universe.${index}`
            : key.replace('legs.0.', `universe.${index}.`)
        ] = value;
    }
    const strategy = request.analysis.strategy;
    if (
      strategy.valuation_date != null &&
      strategy.expiry_date == null &&
      leg.expiry_date == null
    )
      errors[`universe.${index}.expiry_date`] =
        'Add an expiry date: this strategy has a valuation date but no common expiry date.';
    const underlying = request.analysis.strategy.underlying;
    if (
      leg.source &&
      underlying &&
      leg.source.underlying.toUpperCase() !== underlying.toUpperCase()
    )
      errors[`universe.${index}.source`] =
        'Contract underlying differs from this draft.';
  });
  return errors;
}

/** Reject stale evidence; applying never replaces source mode or non-strategy inputs. */
export function applyFinderCandidate(
  draft: OptionsDraft,
  submitted: FinderRequest,
  candidate: FinderCandidate,
): boolean {
  if (
    JSON.stringify(draft) !== JSON.stringify(submitted.analysis) ||
    Object.keys(optionsErrors(candidate.request)).length ||
    candidate.request.strategy.legs.length > 16
  )
    return false;
  draft.strategy = structuredClone(candidate.request.strategy);
  return true;
}

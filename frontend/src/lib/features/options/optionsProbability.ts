import type { OptionsDraft } from './optionsTypes';
import type {
  DistributionRequest,
  DistributionResponse,
  ProbabilityBin,
} from './optionsResearchTypes';
import { optionsErrors, resolvedLegDays } from './optionsValidation';
import {
  axisValue,
  exactValue,
  finiteValue,
  scaleValue,
  svgPath,
} from './optionsChart';

export interface ProbabilitySettings {
  measure: DistributionRequest['measure'];
  annualDrift: number | undefined;
  confidence: number | undefined;
  bins: number | undefined;
  integrationPoints: number | undefined;
  tailProbability: number | undefined;
}

export function probabilitySettings(): ProbabilitySettings {
  return {
    measure: 'risk_neutral',
    annualDrift: 0,
    confidence: 0.95,
    bins: 40,
    integrationPoints: 4096,
    tailProbability: 0.000001,
  };
}

export function probabilityErrors(
  draft: OptionsDraft,
  settings: ProbabilitySettings,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (Object.keys(optionsErrors(draft)).length)
    errors.analysis =
      'Correct the draft validation errors in the strategy editor before computing.';
  const horizons = draft.strategy.legs
    .filter(leg => leg.enabled && leg.kind !== 'underlying')
    .map(leg => resolvedLegDays(draft.strategy, leg));
  if (new Set(horizons).size > 1)
    errors.horizon =
      'Mixed-expiry probability is unsupported. Use the lifecycle lab for calendars/diagonals, or explicitly align enabled option expiries in the strategy editor. No leg is silently priced at another expiry.';
  if (!['risk_neutral', 'user_drift'].includes(settings.measure))
    errors.measure = 'Choose risk-neutral or user drift.';
  if (
    settings.measure === 'user_drift' &&
    (!finiteValue(settings.annualDrift) ||
      settings.annualDrift < -1 ||
      settings.annualDrift > 1)
  )
    errors.annualDrift =
      'Enter annual drift as a fraction from −1 to 1; zero is valid.';
  if (
    !finiteValue(settings.confidence) ||
    settings.confidence <= 0.5 ||
    settings.confidence >= 1
  )
    errors.confidence =
      'Confidence must be a fraction strictly between 0.5 and 1.';
  if (
    !Number.isInteger(settings.bins) ||
    settings.bins! < 10 ||
    settings.bins! > 100
  )
    errors.bins = 'Use 10–100 histogram bins.';
  if (
    !Number.isInteger(settings.integrationPoints) ||
    settings.integrationPoints! < 256 ||
    settings.integrationPoints! > 16384
  )
    errors.integrationPoints = 'Use 256–16384 integer integration points.';
  if (
    !finiteValue(settings.tailProbability) ||
    settings.tailProbability < 1e-9 ||
    settings.tailProbability > 0.01
  )
    errors.tailProbability =
      'Tail truncation probability must be from 1e−9 to 0.01.';
  return errors;
}

export function probabilityKey(
  draft: OptionsDraft,
  settings: ProbabilitySettings,
): string {
  return JSON.stringify([draft, settings], (_, value) =>
    typeof value === 'number' && !Number.isFinite(value)
      ? String(value)
      : value,
  );
}

export function probabilityRequest(
  draft: OptionsDraft,
  settings: ProbabilitySettings,
): DistributionRequest | null {
  if (Object.keys(probabilityErrors(draft, settings)).length) return null;
  return structuredClone({
    analysis: draft,
    measure: settings.measure,
    ...(settings.measure === 'user_drift'
      ? { annual_drift: settings.annualDrift }
      : {}),
    confidence: settings.confidence,
    bins: settings.bins,
    integration_points: settings.integrationPoints,
    tail_probability: settings.tailProbability,
  });
}

export function probabilityPercent(value: number | null | undefined): string {
  return finiteValue(value) ? `${axisValue(value * 100)}%` : 'Unavailable';
}

export function probabilityBinLabel(bin: ProbabilityBin): string {
  return bin.lower_pnl === bin.upper_pnl
    ? `Point mass at ${exactValue(bin.lower_pnl, true)} USD`
    : `${exactValue(bin.lower_pnl, true)} to ${exactValue(bin.upper_pnl, true)} USD P&L`;
}

/** Presentation coordinates only; never calculate option payoffs or probabilities. */
export function probabilityBars(bins: ProbabilityBin[], width = 600) {
  if (
    !bins.length ||
    bins.length > 100 ||
    bins.some(
      bin =>
        !finiteValue(bin.lower_pnl) ||
        !finiteValue(bin.upper_pnl) ||
        bin.lower_pnl > bin.upper_pnl ||
        !finiteValue(bin.probability) ||
        bin.probability < 0 ||
        bin.probability > 1,
    )
  )
    return [];
  const min = Math.min(...bins.map(bin => bin.lower_pnl));
  const max = Math.max(...bins.map(bin => bin.upper_pnl));
  const domain = { min, max };
  return bins.map(bin => {
    const atom = bin.lower_pnl === bin.upper_pnl;
    const x =
      min === max ? width / 2 : scaleValue(bin.lower_pnl, domain, 0, width);
    return {
      bin,
      atom,
      x,
      width: atom ? 0 : scaleValue(bin.upper_pnl, domain, 0, width) - x,
      y: 160 * (1 - bin.probability),
      height: 160 * bin.probability,
    };
  });
}

export function terminalProbabilityError(
  result: DistributionResponse,
): string | null {
  const bins = result.terminal_price_bins,
    curve = result.terminal_payoff_curve;
  if (
    !Array.isArray(bins) ||
    !bins.length ||
    bins.length > 100 ||
    bins.some(
      (bin, i) =>
        !finiteValue(bin.lower_spot) ||
        !finiteValue(bin.upper_spot) ||
        !finiteValue(bin.representative_spot) ||
        !finiteValue(bin.probability) ||
        bin.lower_spot < 0 ||
        bin.lower_spot > bin.upper_spot ||
        bin.representative_spot < bin.lower_spot ||
        bin.representative_spot > bin.upper_spot ||
        bin.probability < 0 ||
        bin.probability > 1 ||
        (i > 0 && bin.lower_spot !== bins[i - 1].upper_spot),
    )
  )
    return 'Terminal price probability bins are missing, invalid or exceed the 100-bin bound. No synthetic price distribution is substituted.';
  if (
    !Array.isArray(curve) ||
    !curve.length ||
    curve.length > 35 ||
    curve.some(
      (point, i) =>
        !finiteValue(point.spot) ||
        !finiteValue(point.pnl) ||
        point.spot < 0 ||
        (i > 0 && point.spot <= curve[i - 1].spot),
    ) ||
    curve[0].spot !== bins[0].lower_spot ||
    curve[curve.length - 1].spot !== bins[bins.length - 1].upper_spot
  )
    return 'Exact terminal payoff vertices are missing or do not cover the returned price domain. No sampled-grid or frontend-pricing fallback is used.';
  return null;
}

/** Vertically separated, aligned axes: probability mass above; canonical USD payoff below. */
export function terminalProbabilityPlot(
  result: DistributionResponse,
  width = 600,
) {
  if (terminalProbabilityError(result)) return null;
  const bins = result.terminal_price_bins,
    curve = result.terminal_payoff_curve;
  const lower = bins[0].lower_spot,
    upper = bins[bins.length - 1].upper_spot;
  const atom = lower === upper;
  const xDomain = { min: lower, max: upper };
  const minPnl = Math.min(0, ...curve.map(p => p.pnl));
  const maxPnl = Math.max(0, ...curve.map(p => p.pnl));
  const pad = Math.max(Number.MIN_VALUE, (maxPnl - minPnl) * 0.08 || 1);
  const yDomain = { min: minPnl - pad, max: maxPnl + pad };
  return {
    lower,
    upper,
    minPnl,
    maxPnl,
    atom,
    bins: bins.map(bin => {
      const x = atom
        ? width / 2
        : scaleValue(bin.lower_spot, xDomain, 0, width);
      return {
        bin,
        x,
        width: atom ? 0 : scaleValue(bin.upper_spot, xDomain, 0, width) - x,
        y: 134 - 100 * bin.probability,
        height: 100 * bin.probability,
      };
    }),
    payoffPath: atom
      ? ''
      : svgPath(
          curve.map(point => ({ spot: point.spot, value: point.pnl })),
          xDomain,
          yDomain,
          width,
          220,
          330,
        ),
    points: curve.map(point => ({
      point,
      x: atom ? width / 2 : scaleValue(point.spot, xDomain, 0, width),
      y: scaleValue(point.pnl, yDomain, 330, 220),
    })),
    zeroY: scaleValue(0, yDomain, 330, 220),
  };
}

export function probabilityDataError(
  result: DistributionResponse,
): string | null {
  if (!Array.isArray(result.bins) || !result.bins.length)
    return 'No probability bins returned. This is empty evidence, not zero probability or zero risk.';
  if (!probabilityBars(result.bins).length)
    return 'Returned P&L bins are invalid or exceed the 100-bin bound.';
  const terminalError = terminalProbabilityError(result);
  if (terminalError) return terminalError;
  if (
    !Array.isArray(result.quantiles) ||
    result.quantiles.length > 9 ||
    result.quantiles.some(
      q =>
        !finiteValue(q.pnl) ||
        !finiteValue(q.probability) ||
        q.probability < 0 ||
        q.probability > 1,
    )
  )
    return 'Returned quantiles are unavailable or invalid; they are not zero.';
  return null;
}

export interface ProbabilityState {
  documentKey: string | null;
  pending: boolean;
  cancelled: boolean;
  error: string | null;
  result: DistributionResponse | null;
  submitted: DistributionRequest | null;
  resultKey: string;
}

export const emptyProbabilityState = (): ProbabilityState => ({
  documentKey: null,
  pending: false,
  cancelled: false,
  error: null,
  result: null,
  submitted: null,
  resultKey: '',
});

type Compute = (
  request: DistributionRequest,
  signal: AbortSignal,
) => Promise<DistributionResponse>;

function freezeSnapshot<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeSnapshot);
    Object.freeze(value);
  }
  return value;
}

/** Abort saves client work; generation fencing also rejects non-cooperative late replies. */
export class ProbabilityRunner {
  #generation = 0;
  #controller: AbortController | null = null;
  #document: string | null = null;
  #inputKey = '';
  #disposed = false;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #state = emptyProbabilityState();

  constructor(
    private compute: Compute,
    private publish: (state: ProbabilityState) => void,
  ) {}

  #stop() {
    this.#generation++;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#controller?.abort();
    this.#controller = null;
  }

  context(documentKey: string, inputKey: string) {
    if (
      this.#disposed ||
      (documentKey === this.#document && inputKey === this.#inputKey)
    )
      return;
    const changedDocument = documentKey !== this.#document;
    this.#stop();
    this.#document = documentKey;
    this.#inputKey = inputKey;
    this.#state = changedDocument
      ? { ...emptyProbabilityState(), documentKey }
      : {
          ...this.#state,
          pending: false,
          cancelled: this.#state.pending,
          error: null,
        };
    this.publish(this.#state);
  }

  cancel() {
    if (this.#disposed || !this.#state.pending) return;
    this.#stop();
    this.#state = {
      ...this.#state,
      pending: false,
      cancelled: true,
      error: null,
    };
    this.publish(this.#state);
  }

  async run(
    documentKey: string,
    inputKey: string,
    request: DistributionRequest,
  ) {
    if (this.#disposed) return;
    this.context(documentKey, inputKey);
    this.#stop();
    const generation = this.#generation;
    const controller = new AbortController();
    this.#controller = controller;
    const snapshot = freezeSnapshot(structuredClone(request));
    this.#state = {
      ...this.#state,
      pending: true,
      cancelled: false,
      error: null,
    };
    this.publish(this.#state);
    this.#timer = setTimeout(() => {
      if (generation !== this.#generation || this.#disposed) return;
      this.#stop();
      this.#state = {
        ...this.#state,
        pending: false,
        error:
          'Distribution request timed out after 15 seconds. Retry explicitly; client abort does not guarantee server cancellation.',
      };
      this.publish(this.#state);
    }, 15000);
    try {
      const result = await this.compute(snapshot, controller.signal);
      if (generation !== this.#generation || this.#disposed) return;
      const error = probabilityDataError(result);
      this.#state = error
        ? { ...this.#state, error }
        : {
            ...this.#state,
            result,
            submitted: snapshot,
            resultKey: inputKey,
          };
    } catch {
      if (generation !== this.#generation || this.#disposed) return;
      this.#state = {
        ...this.#state,
        error:
          'Distribution computation failed. Check the strategy and model assumptions, then retry explicitly. The server may be busy, unavailable, or have rejected the request. No failed result was published.',
      };
    } finally {
      if (generation === this.#generation && !this.#disposed) {
        if (this.#timer !== null) clearTimeout(this.#timer);
        this.#timer = null;
        this.#controller = null;
        this.#state = { ...this.#state, pending: false };
        this.publish(this.#state);
      }
    }
  }

  dispose() {
    this.#stop();
    this.#disposed = true;
  }
}

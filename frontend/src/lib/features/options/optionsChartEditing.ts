import { apiJson } from '$lib/core/api';
import {
  finiteValue,
  optionsSeries,
  plotError,
  scaleValue,
} from './optionsChart';
import type { ChartSeries, Domain } from './optionsChart';
import { requestChanged } from './optionsScenario';
import type { OptionsAnalysis, OptionsDraft } from './optionsTypes';

export const STRIKE_STEPS = [0.01, 0.1, 1, 5] as const;
export const MAX_STRIKE = 1_000_000;

export function validStrike(value: unknown): value is number {
  return finiteValue(value) && value > 0 && value <= MAX_STRIKE;
}

export function snapStrike(value: number, step: number): number | null {
  if (!finiteValue(value) || !STRIKE_STEPS.some(s => s === step)) return null;
  return Math.max(
    step,
    Math.min(MAX_STRIKE, Number((Math.round(value / step) * step).toFixed(2))),
  );
}

/** Convert the current rendered SVG bounds, not cached pointer-down pixels. */
export function strikeAtClientX(
  clientX: number,
  bounds: { left: number; width: number },
  svgWidth: number,
  plotLeft: number,
  plotWidth: number,
  domain: Domain,
  step: number,
): number | null {
  if (
    ![
      clientX,
      bounds.left,
      bounds.width,
      svgWidth,
      plotLeft,
      plotWidth,
      domain.min,
      domain.max,
    ].every(finiteValue) ||
    bounds.width <= 0 ||
    svgWidth <= 0 ||
    plotWidth <= 0 ||
    domain.min < 0 ||
    domain.min >= domain.max
  )
    return null;
  const pixel = Math.max(
    0,
    Math.min(
      plotWidth,
      ((clientX - bounds.left) / bounds.width) * svgWidth - plotLeft,
    ),
  );
  const strike = snapStrike(
    scaleValue(pixel, { min: 0, max: plotWidth }, domain.min, domain.max),
    step,
  );
  // Only valid snapped prices inside the visible domain can be proposed by drag.
  const min = Math.max(step, Math.ceil(domain.min / step) * step);
  const max = Math.min(MAX_STRIKE, Math.floor(domain.max / step) * step);
  return strike == null || min > max
    ? null
    : Number(Math.max(min, Math.min(max, strike)).toFixed(2));
}

export interface StrikeDrag {
  pointerId: number;
  legIndex: number;
  original: number;
  proposed: number;
  context: string;
}

export function moveStrikeDrag(
  drag: StrikeDrag,
  pointerId: number,
  strike: number | null,
): StrikeDrag {
  return pointerId === drag.pointerId && validStrike(strike)
    ? { ...drag, proposed: strike }
    : drag;
}

export function finishStrikeDrag(
  drag: StrikeDrag | null,
  pointerId: number,
  context: string,
  cancelled = false,
): StrikeDrag | null {
  return drag &&
    !cancelled &&
    pointerId === drag.pointerId &&
    context === drag.context &&
    validStrike(drag.proposed) &&
    drag.proposed !== drag.original
    ? drag
    : null;
}

/** Parent invokes this once per completed action, never for pointer moves. */
export function applyStrikeEdit(
  draft: OptionsDraft,
  index: number,
  strike: number,
  original: number,
): boolean {
  const leg = draft.strategy.legs[index];
  if (
    !leg ||
    leg.kind === 'underlying' ||
    !leg.enabled ||
    leg.strike !== original ||
    !validStrike(strike) ||
    strike === original
  )
    return false;
  leg.strike = strike;
  draft.strategy.template = 'custom';
  return true;
}

export function isolatedLegRequest(
  result: OptionsAnalysis,
  index: number,
): OptionsDraft | null {
  if (!result.request.strategy.legs[index]?.enabled) return null;
  // Wire requests are JSON-only; serialization also unwraps reactive state.
  const request = JSON.parse(JSON.stringify(result.request)) as OptionsDraft;
  request.strategy.template = 'custom';
  request.strategy.legs.forEach((leg, i) => {
    leg.enabled = i === index;
  });
  // A single leg may have a different expiry horizon. Request today's curve and
  // its own expiry, without inheriting an invalid surface/scenario time axis.
  request.scenarios = [];
  request.surface = null;
  return request;
}

export function canonicalOverlay(
  result: OptionsAnalysis,
  submitted: OptionsDraft,
  todayOnly = false,
): ChartSeries[] {
  if (requestChanged(result.request, submitted) || plotError(result))
    throw new Error(
      'Canonical chart response does not match the submitted request.',
    );
  return optionsSeries(result).filter(s =>
    todayOnly
      ? s.id === 'today'
      : s.id !== 'expiry' ||
        (result.horizon?.kind !== 'mixed_expiry' &&
          result.horizon?.exact_terminal_available !== false),
  );
}

export const requestChartAnalysis = (
  request: OptionsDraft,
  signal: AbortSignal,
) =>
  apiJson<OptionsAnalysis>('/options/analyze', {
    method: 'POST',
    body: JSON.stringify(request),
    signal,
  });

export function chartContextKey(
  documentKey: string | undefined,
  draft: OptionsDraft | undefined,
  result: OptionsAnalysis | null,
  readOnly: boolean,
  hasOnEdit: boolean,
): string {
  return JSON.stringify([
    documentKey ?? null,
    draft ?? null,
    result?.request ?? null,
    readOnly,
    hasOnEdit,
  ]);
}

/** Abort is advisory; a generation check also rejects transports ignoring it. */
export class ChartRequestGate {
  #generation = 0;
  #controller: AbortController | null = null;
  cancel(): void {
    this.#generation++;
    this.#controller?.abort();
    this.#controller = null;
  }
  begin(context: string, baseline: OptionsAnalysis) {
    this.cancel();
    const generation = this.#generation;
    const controller = new AbortController();
    this.#controller = controller;
    return {
      signal: controller.signal,
      current: (liveContext: string, liveBaseline: OptionsAnalysis | null) =>
        generation === this.#generation &&
        !controller.signal.aborted &&
        context === liveContext &&
        baseline === liveBaseline,
    };
  }
}

import { getSessionGeneration } from '$lib/core/api';

const INDICATOR_DEBOUNCE_MS = 300;

export interface IndicatorEffectOptions<T> {
  enabled: () => boolean;
  hasCandles: () => boolean;
  symbol: () => string;
  version: () => number;
  args: () => readonly unknown[];
  account?: () => string | null;
  fetch: (
    symbol: string,
    args: readonly unknown[],
    signal: AbortSignal,
  ) => Promise<T[]>;
  onError: (message: string) => void;
  label: string;
}

export interface IndicatorResult<T> {
  readonly points: T[];
}

export function useIndicatorEffect<T>(
  opts: IndicatorEffectOptions<T>,
): IndicatorResult<T> {
  let points = $state<T[]>([]);

  $effect(() => {
    const enabled = opts.enabled();
    const hasCandles = opts.hasCandles();
    const sym = opts.symbol();
    const version = opts.version();
    const args = opts.args();
    const argsKey = JSON.stringify(args);
    const account = opts.account?.();
    const session = getSessionGeneration();
    points = [];
    if (!enabled || !hasCandles) {
      return;
    }
    const controller = new AbortController();
    const isCurrent = () =>
      !controller.signal.aborted &&
      session === getSessionGeneration() &&
      account === opts.account?.() &&
      opts.enabled() &&
      opts.hasCandles() &&
      sym === opts.symbol() &&
      version === opts.version() &&
      argsKey === JSON.stringify(opts.args());
    const id = setTimeout(async () => {
      if (!isCurrent()) return;
      try {
        const result = await opts.fetch(sym, args, controller.signal);
        if (isCurrent()) points = result;
      } catch (e) {
        if (isCurrent()) {
          points = [];
          opts.onError(
            e instanceof Error ? e.message : `Failed to load ${opts.label}`,
          );
        }
      }
    }, INDICATOR_DEBOUNCE_MS);
    return () => {
      clearTimeout(id);
      controller.abort();
    };
  });

  return {
    get points() {
      return points;
    },
  };
}

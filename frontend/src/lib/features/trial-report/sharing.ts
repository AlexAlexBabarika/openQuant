import type { TrialConfig, TrialStrategyId } from './types';

export const TRIAL_SHARE_NOTICE =
  'This share link recreates the demo configuration using the current scenario and engine version. It is not an immutable hosted report. Download HTML for snapshot evidence.';

const strategyIds: readonly TrialStrategyId[] = [
  'backtest-billionaire',
  'overcaffeinated-trader',
  'boring-benchmark',
];

function isStrategyId(value: string): value is TrialStrategyId {
  return strategyIds.some(id => id === value);
}

function isCost(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 50;
}

function readCost(value: string | null): number | null {
  if (
    value === null ||
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)
  ) {
    return null;
  }
  const cost = Number(value);
  return isCost(cost) ? cost : null;
}

export function createTrialShareUrl(
  config: TrialConfig,
  baseUrl: string,
): string {
  if (
    !isStrategyId(config.strategy_id) ||
    !isCost(config.commission_bps) ||
    !isCost(config.slippage_bps)
  ) {
    throw new RangeError('Invalid trial configuration.');
  }
  const base = new URL(baseUrl);
  if (
    !['https:', 'http:'].includes(base.protocol) ||
    base.username ||
    base.password
  ) {
    throw new TypeError(
      'Share links require an HTTP or HTTPS URL without credentials.',
    );
  }
  const url = new URL('/', base.origin);
  url.search = new URLSearchParams({
    trial: '1',
    v: '1',
    strategy: config.strategy_id,
    commission: String(config.commission_bps),
    slippage: String(config.slippage_bps),
  }).toString();
  return url.toString();
}

export function readTrialShareConfig(search: string): TrialConfig | null {
  const params = new URLSearchParams(search);
  for (const key of ['trial', 'v', 'strategy', 'commission', 'slippage']) {
    if (params.getAll(key).length !== 1) return null;
  }
  const strategy = params.get('strategy');
  const commission = readCost(params.get('commission'));
  const slippage = readCost(params.get('slippage'));
  if (
    params.get('trial') !== '1' ||
    params.get('v') !== '1' ||
    strategy === null ||
    !isStrategyId(strategy) ||
    commission === null ||
    slippage === null
  ) {
    return null;
  }
  return {
    strategy_id: strategy,
    commission_bps: commission,
    slippage_bps: slippage,
  };
}

import type { OptionsDraft } from './optionsTypes';
import type {
  HedgeRequest,
  HedgeResponse,
  HedgePolicy,
} from './optionsResearchTypes';
import {
  boundedNumber,
  lifecycleRequest,
  validLifecycle,
  validResearchContext,
  type FieldErrors,
  type PathControls,
} from './optionsLifecycle';

export interface HedgeControls {
  mode: NonNullable<HedgePolicy['mode']>;
  interval: string;
  threshold: string;
  maxShares: string;
  perShare: string;
  fixed: string;
  slippage: string;
}
export const hedgeControls = (): HedgeControls => ({
  mode: 'daily',
  interval: '1',
  threshold: '10',
  maxShares: '1000000',
  perShare: '0',
  fixed: '0',
  slippage: '0',
});
export function hedgeRequest(
  draft: OptionsDraft,
  path: PathControls,
  settings: HedgeControls,
): { request: HedgeRequest | null; errors: FieldErrors } {
  const base = lifecycleRequest(draft, path);
  const errors = { ...base.errors };
  const values: Record<string, number> = {};
  for (const [key, min, max] of [
    ['interval', Number.MIN_VALUE, 3650],
    ['threshold', Number.MIN_VALUE, 1000000],
    ['maxShares', Number.MIN_VALUE, 10000000],
    ['perShare', 0, 1000],
    ['fixed', 0, 10000],
    ['slippage', 0, 1000],
  ] as const) {
    if (
      (key === 'interval' && settings.mode !== 'interval') ||
      (key === 'threshold' && settings.mode !== 'delta_threshold')
    )
      continue;
    const value = boundedNumber(settings[key], min, max);
    if (value === null)
      errors[key] =
        `Enter a finite number ${min === Number.MIN_VALUE ? '>0' : min}–${max}; blank is not zero.`;
    else values[key] = value;
  }
  return {
    request:
      base.request && !Object.keys(errors).length
        ? {
            ...base.request,
            policy: {
              mode: settings.mode,
              max_abs_shares: values.maxShares,
              ...(settings.mode === 'interval'
                ? { interval_days: values.interval }
                : {}),
              ...(settings.mode === 'delta_threshold'
                ? { delta_threshold: values.threshold }
                : {}),
            },
            costs: {
              per_share: values.perShare,
              fixed_per_trade: values.fixed,
              slippage_bps: values.slippage,
            },
          }
        : null,
    errors,
  };
}
export function validHedge(result: HedgeResponse): boolean {
  return (
    !!result?.request?.analysis &&
    validResearchContext(result) &&
    validLifecycle(result.lifecycle) &&
    [
      result.unhedged_final_pnl,
      result.hedged_final_pnl,
      result.attribution?.strategy_pnl,
      result.attribution?.hedge_trading_pnl,
      result.attribution?.transaction_costs,
      result.attribution?.total_pnl,
    ].every(Number.isFinite) &&
    result.attribution.financing === 0 &&
    result.attribution.dividends === 0 &&
    Array.isArray(result.ledger) &&
    result.ledger.length > 0 &&
    result.ledger.length <= 382 &&
    result.ledger.every(
      (row, i, rows) =>
        [
          row.day,
          row.spot,
          row.hedge_shares,
          row.hedge_cash,
          row.hedged_pnl,
          row.unhedged_pnl,
          row.trade_cash_flow,
          row.transaction_cost,
          row.traded_shares,
          row.hedge_value,
        ].every(Number.isFinite) &&
        (row.strategy_delta === null || Number.isFinite(row.strategy_delta)) &&
        [
          'hold',
          'rebalance',
          'liquidate',
          'undefined_delta',
          'share_limit',
        ].includes(row.action) &&
        (!i || row.day > rows[i - 1].day),
    )
  );
}

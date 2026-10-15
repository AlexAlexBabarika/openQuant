import { describe, expect, it } from 'vitest';
import { createOptionsDraft } from './optionsTemplates';
import { pathControls } from './optionsLifecycle';
import { hedgeControls, hedgeRequest, validHedge } from './optionsHedge';
import type { HedgeResponse, HedgeStep } from './optionsResearchTypes';

function response(): HedgeResponse {
  const draft = createOptionsDraft();
  const request = hedgeRequest(
    draft,
    pathControls(draft),
    hedgeControls(),
  ).request!;
  const provenance = {
    version: '1' as const,
    model: 'black_scholes_merton' as const,
    currency: 'USD' as const,
    day_basis: 'ACT/365' as const,
    exercise_style: 'european' as const,
    settlement: 'cash' as const,
    input_source: 'manual_or_synthetic' as const,
  };
  return {
    request,
    provenance,
    warnings: [],
    unhedged_final_pnl: -10,
    hedged_final_pnl: -12,
    lifecycle: {
      request,
      provenance,
      warnings: [],
      net_entry_cost: 10,
      final_pnl: -10,
      settlements: [],
      path: [{ day: 0, spot: 100 }],
      ledger: [
        {
          day: 0,
          spot: 100,
          total_pnl: -10,
          remaining_value: 0,
          cumulative_settlement_cash: 0,
          settlement_cash_flow: 0,
          legs: [
            {
              leg_index: 0,
              state: 'settled',
              remaining_days: 0,
              value: 0,
              greeks: {
                delta: null,
                gamma: null,
                theta: null,
                vega: null,
                rho: null,
              },
            },
          ],
        },
      ],
    },
    ledger: [
      {
        day: 0,
        spot: 100,
        strategy_delta: null,
        hedge_shares: 0,
        traded_shares: 0,
        trade_cash_flow: 0,
        transaction_cost: 0,
        hedge_cash: -2,
        hedge_value: 0,
        unhedged_pnl: -10,
        hedged_pnl: -12,
        action: 'undefined_delta',
      },
    ],
    attribution: {
      strategy_pnl: -10,
      hedge_trading_pnl: 0,
      transaction_costs: 2,
      total_pnl: -12,
      financing: 0,
      dividends: 0,
    },
  };
}

describe('explicit hedge assumptions', () => {
  it.each(['none', 'daily', 'interval', 'delta_threshold'] as const)(
    'builds %s without altering the draft or inventing a path',
    mode => {
      const draft = createOptionsDraft();
      const original = structuredClone(draft);
      const settings = { ...hedgeControls(), mode };
      const result = hedgeRequest(draft, pathControls(draft), settings);
      expect(result.errors).toEqual({});
      expect(result.request?.policy?.mode).toBe(mode);
      expect(result.request?.policy?.interval_days).toBe(
        mode === 'interval' ? 1 : undefined,
      );
      expect(result.request?.policy?.delta_threshold).toBe(
        mode === 'delta_threshold' ? 10 : undefined,
      );
      expect(result.request?.costs).toEqual({
        per_share: 0,
        fixed_per_trade: 0,
        slippage_bps: 0,
      });
      expect(result.request?.path.source).toBe('synthetic');
      expect(draft).toEqual(original);
    },
  );
  it('permits cost zero, requires nonblank costs and ignores inactive interval/threshold fields', () => {
    const draft = createOptionsDraft();
    const path = pathControls(draft);
    const settings = { ...hedgeControls(), interval: '', threshold: '' };
    expect(hedgeRequest(draft, path, settings).request).not.toBeNull();
    settings.perShare = '';
    expect(hedgeRequest(draft, path, settings).errors.perShare).toContain(
      'blank',
    );
    expect(hedgeRequest(draft, path, settings).request).toBeNull();
  });
  it.each([
    ['interval', '0', 'interval'],
    ['interval', '3651', 'interval'],
    ['threshold', '0', 'delta_threshold'],
    ['threshold', '1000001', 'delta_threshold'],
    ['maxShares', '0', 'daily'],
    ['maxShares', '10000001', 'daily'],
    ['perShare', '-1', 'daily'],
    ['perShare', '1001', 'daily'],
    ['fixed', '10001', 'daily'],
    ['slippage', '1001', 'daily'],
    ['slippage', 'Infinity', 'daily'],
  ] as const)('bounds %s=%s for %s', (field, value, mode) => {
    const draft = createOptionsDraft();
    const result = hedgeRequest(draft, pathControls(draft), {
      ...hedgeControls(),
      mode,
      [field]: value,
    });
    expect(result.request).toBeNull();
    expect(result.errors[field]).toBeTruthy();
  });
  it('keeps fractional intervals, signed path assumptions and explicit slippage', () => {
    const draft = createOptionsDraft();
    const path = {
      ...pathControls(draft),
      source: 'supplied' as const,
      csv: '0,100\n60,80',
    };
    const result = hedgeRequest(draft, path, {
      ...hedgeControls(),
      mode: 'interval',
      interval: '0.5',
      perShare: '0.01',
      fixed: '1',
      slippage: '2',
    });
    expect(result.request?.path).toEqual({
      source: 'supplied',
      points: [
        { day: 0, spot: 100 },
        { day: 60, spot: 80 },
      ],
    });
    expect(result.request?.policy?.interval_days).toBe(0.5);
    expect(result.request?.costs).toEqual({
      per_share: 0.01,
      fixed_per_trade: 1,
      slippage_bps: 2,
    });
    path.csv = '0,100\n1,100';
    expect(hedgeRequest(draft, path, hedgeControls()).errors.csv).toContain(
      'expiry',
    );
  });
});

describe('bounded canonical hedge ledger', () => {
  it.each([
    'hold',
    'rebalance',
    'liquidate',
    'undefined_delta',
    'share_limit',
  ] as HedgeStep['action'][])(
    'accepts %s without treating unavailable delta as zero',
    action => {
      const result = response();
      result.ledger[0].action = action;
      expect(validHedge(result)).toBe(true);
      expect(result.ledger[0].strategy_delta).toBeNull();
    },
  );
  it('rejects nonfinite money, duplicate days and oversized response ledgers', () => {
    let result = response();
    result.ledger[0].transaction_cost = NaN;
    expect(validHedge(result)).toBe(false);
    result = response();
    result.ledger.push(structuredClone(result.ledger[0]));
    expect(validHedge(result)).toBe(false);
    result = response();
    result.ledger = Array.from({ length: 383 }, (_, day) => ({
      ...response().ledger[0],
      day,
    }));
    expect(validHedge(result)).toBe(false);
    result = response();
    result.attribution.total_pnl = Infinity;
    expect(validHedge(result)).toBe(false);
    result = response();
    result.warnings = Array(33).fill('bounded warning');
    expect(validHedge(result)).toBe(false);
  });
});

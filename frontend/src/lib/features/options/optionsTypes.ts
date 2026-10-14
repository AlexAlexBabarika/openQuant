/** Canonical backend.derivatives wire contract v1; all defaults are explicit in drafts. */
export type OptionTemplate =
  | 'custom'
  | 'long_call'
  | 'long_put'
  | 'call_vertical'
  | 'put_vertical'
  | 'straddle'
  | 'strangle'
  | 'iron_condor'
  | 'iron_butterfly'
  | 'covered_call'
  | 'protective_put';

export interface OptionLeg {
  kind: 'call' | 'put' | 'underlying';
  quantity: number;
  strike: number | null;
  entry_premium: number;
  multiplier: number;
  enabled: boolean;
}

export interface OptionStrategy {
  name: string;
  template: OptionTemplate;
  days_to_expiry: number;
  currency: 'USD';
  exercise_style: 'european';
  settlement: 'cash';
  entry_fee_per_contract: number;
  legs: OptionLeg[];
}

export interface OptionsScenario {
  name: string;
  elapsed_days: number;
  iv_shift_pp: number;
}

/** IV/rate/yield are annual fractions; scenario IV shifts are percentage points. */
export interface OptionsDraft {
  strategy: OptionStrategy;
  spot: number;
  volatility: number;
  rate: number;
  dividend_yield: number;
  spot_grid: number[];
  scenarios: OptionsScenario[];
}

export type OptionsAnalysisRequest = OptionsDraft;
export type GreekKey = 'delta' | 'gamma' | 'theta' | 'vega' | 'rho';

/** Signed total strategy exposures at the stated spot; null is unavailable, never zero. */
export interface OptionsGreeks {
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  rho: number | null;
}

export interface OptionsGreekUnits {
  delta: 'USD per USD spot (equivalent shares)';
  gamma: 'delta per USD spot';
  theta: 'USD per calendar day elapsed';
  vega: 'USD per 1 volatility percentage point';
  rho: 'USD per 1 rate percentage point';
}

export interface OptionsProvenance {
  name: 'black_scholes_merton';
  version: '1';
  input_source: 'manual';
  exercise_style: 'european';
  settlement: 'cash';
  day_basis: 'ACT/365';
}

export interface ZeroInterval {
  start: number;
  end: number | null;
}

export interface OptionsSummary {
  gross_entry_cost: number;
  entry_fees: number;
  net_entry_cost: number;
  entry_debit: number;
  entry_credit: number;
  theoretical_value_today: number;
  pnl_today: number;
  max_profit: number | null;
  max_loss: number | null;
  profit_unbounded: boolean;
  loss_unbounded: boolean;
  breakevens: number[];
  zero_intervals: ZeroInterval[];
}

export interface OptionsScenarioAnalysis {
  name: string;
  elapsed_days: number;
  remaining_days: number;
  volatility: number;
  pnl: number[];
  greeks: OptionsGreeks;
}

export interface OptionsAnalysis {
  request: OptionsDraft;
  model: OptionsProvenance;
  summary: OptionsSummary;
  spot_grid: number[];
  today_pnl: number[];
  expiry_pnl: number[];
  scenarios: OptionsScenarioAnalysis[];
  greeks: OptionsGreeks;
  greek_units: OptionsGreekUnits;
  /** Parent-integrated backend extension: today's exposures aligned with spot_grid. */
  greeks_grid: OptionsGreeks[];
  warnings: string[];
}

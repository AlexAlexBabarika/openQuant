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
  | 'protective_put'
  | 'calendar'
  | 'diagonal';

export interface OptionsContractSource {
  provider: 'tradier';
  environment: 'production' | 'sandbox';
  contract_symbol: string;
  underlying: string;
  fetched_at: string;
  bid_as_of?: string | null;
  ask_as_of?: string | null;
  observed_exercise_style?: 'american' | 'european' | 'unknown';
  observed_settlement?: 'cash' | 'physical' | 'unknown';
}

export interface OptionLeg {
  kind: 'call' | 'put' | 'underlying';
  quantity: number;
  strike: number | null;
  entry_premium: number;
  multiplier: number;
  enabled: boolean;
  days_to_expiry?: number | null;
  expiry_date?: string | null;
  source?: OptionsContractSource | null;
  implied_volatility?: number | null;
  bid?: number | null;
  ask?: number | null;
  quote_as_of?: string | null;
}

export interface OptionStrategy {
  name: string;
  template: OptionTemplate;
  days_to_expiry: number;
  underlying?: string | null;
  valuation_date?: string | null;
  expiry_date?: string | null;
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

export interface OptionsSurfaceRequest {
  axis: 'elapsed_days' | 'iv_shift_pp';
  spots: number[];
  steps: number[];
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
  surface?: OptionsSurfaceRequest | null;
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
  profit_unbounded: boolean | null;
  loss_unbounded: boolean | null;
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
  legs?: OptionsScenarioLegAnalysis[];
}

export interface OptionsLegHorizon {
  leg_index: number;
  remaining_days: number | null;
  state: 'disabled' | 'underlying' | 'model_mark' | 'expiry_intrinsic';
}

export interface OptionsScenarioLegAnalysis extends OptionsLegHorizon {
  theoretical_value: number;
  pnl: number;
  greeks: OptionsGreeks;
}

export interface OptionsHorizon {
  kind: 'single_expiry' | 'mixed_expiry';
  first_expiry_days: number;
  last_expiry_days: number;
  elapsed_days: number;
  exact_terminal_available: boolean;
  legs: OptionsLegHorizon[];
}

export interface OptionsExpiryPoint {
  spot: number;
  pnl: number;
}

/** Signed USD totals and exposures; disabled contributions are zero. */
export interface OptionsLegAnalysis {
  leg_index: number;
  enabled: boolean;
  resolved_implied_volatility: number | null;
  resolved_days_to_expiry?: number | null;
  gross_entry_cost: number;
  entry_fees: number;
  net_entry_cost: number;
  theoretical_value_today: number;
  pnl_today: number;
  greeks: OptionsGreeks;
}

/** P&L rows are steps, columns are spots; premiums and entry fees stay fixed. */
export interface OptionsSurfaceAnalysis extends OptionsSurfaceRequest {
  pnl: number[][];
}

export interface OptionsAnalysis {
  request: OptionsDraft;
  model: OptionsProvenance;
  summary: OptionsSummary;
  spot_grid: number[];
  today_pnl: number[];
  expiry_pnl: number[];
  horizon?: OptionsHorizon;
  horizon_pnl?: number[];
  /** Canonical vertices; independent of the regular aligned grid. */
  expiry_curve?: OptionsExpiryPoint[];
  legs?: OptionsLegAnalysis[];
  surface?: OptionsSurfaceAnalysis | null;
  scenarios: OptionsScenarioAnalysis[];
  greeks: OptionsGreeks;
  greek_units: OptionsGreekUnits;
  /** Parent-integrated backend extension: today's exposures aligned with spot_grid. */
  greeks_grid: OptionsGreeks[];
  warnings: string[];
}

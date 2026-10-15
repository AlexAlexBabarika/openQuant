/** Research wire v1; backend/derivatives/research_models.py owns validation/bounds. */
import type {
  OptionLeg,
  OptionsContractSource,
  OptionsDraft,
  OptionsGreeks,
  OptionsSummary,
} from './optionsTypes';

export type ChainEnvironment = 'production' | 'sandbox';
export interface ResearchProvenance {
  version: '1';
  model: 'black_scholes_merton';
  currency: 'USD';
  day_basis: 'ACT/365';
  exercise_style: 'european';
  settlement: 'cash';
  input_source: 'manual_or_synthetic';
}
export interface FinderConstraints {
  max_entry_debit: number;
  max_loss: number;
  max_total_contracts?: number;
  max_legs?: number;
}
export interface FinderRequest {
  analysis: OptionsDraft;
  universe: OptionLeg[];
  thesis: 'bullish' | 'bearish' | 'neutral';
  constraints: FinderConstraints;
  scenario_spots: number[];
  scoring?: 'mean_scenario_pnl_v1';
  limit?: number;
  max_evaluations?: number;
}
export interface FinderEvidence {
  spot: number;
  elapsed_days: number;
  pnl: number;
}
export interface FinderCandidate {
  candidate_id: string;
  rank: number;
  score: number;
  request: OptionsDraft;
  summary: OptionsSummary;
  evidence: FinderEvidence[];
}
export interface FinderResponse {
  request: FinderRequest;
  provenance: ResearchProvenance;
  candidates: FinderCandidate[];
  searched_count: number;
  eligible_count: number;
  search_truncated: boolean;
  scoring: 'mean_scenario_pnl_v1';
  warnings: string[];
}
export interface PathPoint {
  day: number;
  spot: number;
}
export interface SuppliedPath {
  source: 'supplied';
  points: PathPoint[];
}
export interface SyntheticPath {
  source: 'synthetic';
  seed?: number;
  horizon_days: number;
  steps?: number;
  annual_drift?: number;
  annual_volatility?: number;
  generator?: 'gbm_seeded_v1';
}
export type ResearchPath = SuppliedPath | SyntheticPath;
export interface LifecycleRequest {
  analysis: OptionsDraft;
  path: ResearchPath;
}
export interface SettlementObservation {
  leg_index: number;
  day: number;
  spot: number;
  observation: 'supplied' | 'synthetic' | 'linear_interpolation';
  left_day: number;
  right_day: number;
  intrinsic_per_unit: number;
  signed_cash_flow: number;
}
export interface LifecycleLegMark {
  leg_index: number;
  state: 'disabled' | 'underlying' | 'model_mark' | 'settled';
  remaining_days: number | null;
  value: number;
  greeks: OptionsGreeks;
}
export interface LifecycleStep {
  day: number;
  spot: number;
  settlement_cash_flow: number;
  cumulative_settlement_cash: number;
  remaining_value: number;
  total_pnl: number;
  legs: LifecycleLegMark[];
}
export interface LifecycleResponse {
  request: LifecycleRequest;
  provenance: ResearchProvenance;
  path: PathPoint[];
  settlements: SettlementObservation[];
  ledger: LifecycleStep[];
  net_entry_cost: number;
  final_pnl: number;
  warnings: string[];
}
export interface HedgePolicy {
  mode?: 'none' | 'daily' | 'interval' | 'delta_threshold';
  interval_days?: number;
  delta_threshold?: number;
  max_abs_shares?: number;
}
export interface HedgeCosts {
  per_share?: number;
  fixed_per_trade?: number;
  slippage_bps?: number;
}
export interface HedgeRequest extends LifecycleRequest {
  policy?: HedgePolicy;
  costs?: HedgeCosts;
}
export interface HedgeStep {
  day: number;
  spot: number;
  strategy_delta: number | null;
  hedge_shares: number;
  traded_shares: number;
  trade_cash_flow: number;
  transaction_cost: number;
  hedge_cash: number;
  hedge_value: number;
  unhedged_pnl: number;
  hedged_pnl: number;
  action:
    | 'hold'
    | 'rebalance'
    | 'liquidate'
    | 'undefined_delta'
    | 'share_limit';
}
export interface HedgeAttribution {
  strategy_pnl: number;
  hedge_trading_pnl: number;
  transaction_costs: number;
  total_pnl: number;
  financing: 0;
  dividends: 0;
}
export interface HedgeResponse {
  request: HedgeRequest;
  provenance: ResearchProvenance;
  lifecycle: LifecycleResponse;
  ledger: HedgeStep[];
  unhedged_final_pnl: number;
  hedged_final_pnl: number;
  attribution: HedgeAttribution;
  warnings: string[];
}
export interface DistributionRequest {
  analysis: OptionsDraft;
  measure: 'risk_neutral' | 'user_drift';
  annual_drift?: number | null;
  confidence?: number;
  bins?: number;
  integration_points?: number;
  tail_probability?: number;
}
export interface ProbabilityBin {
  lower_pnl: number;
  upper_pnl: number;
  probability: number;
}
export interface PnlQuantile {
  probability: number;
  pnl: number;
}
export interface DistributionResponse {
  request: DistributionRequest;
  provenance: ResearchProvenance;
  resolved_annual_drift: number;
  horizon_days: number;
  terminal_log_sigma: number;
  deterministic: boolean;
  bins: ProbabilityBin[];
  probability_positive_pnl: number;
  expected_pnl: number;
  quantiles: PnlQuantile[];
  confidence: number;
  value_at_risk: number;
  expected_shortfall: number;
  integration_method: 'deterministic' | 'normal_midpoint_quadrature_v1';
  integration_points: number;
  truncated_probability: number;
  normalization_mass: number;
  numerical_error_estimate: number | null;
  warnings: string[];
}
export interface ChainStatus {
  provider: 'tradier';
  environment: ChainEnvironment;
  configured: boolean;
  available: boolean;
  message: string;
}
export interface ChainStatusResponse {
  environments: ChainStatus[];
}
export interface ChainExpirationsResponse {
  provider: 'tradier';
  environment: ChainEnvironment;
  symbol: string;
  fetched_at: string;
  expirations: string[];
  truncated: boolean;
  warnings: string[];
}
export interface ChainQuote {
  contract_symbol: string;
  underlying: string;
  kind: 'call' | 'put';
  strike: number;
  expiration: string;
  multiplier: number | null;
  bid: number | null;
  ask: number | null;
  bid_as_of: string | null;
  ask_as_of: string | null;
  implied_volatility: number | null;
  volume: number | null;
  open_interest: number | null;
  source: OptionsContractSource;
}
export interface ChainResponse {
  provider: 'tradier';
  environment: ChainEnvironment;
  symbol: string;
  expiration: string;
  fetched_at: string;
  quotes: ChainQuote[];
  truncated: boolean;
  warnings: string[];
}

/** Controlled tools never replace Python source or mutate parent props directly. */
export interface OptionsAuthoringToolProps {
  draft: OptionsDraft;
  onEdit: (update: (draft: OptionsDraft) => void) => void;
  readOnly?: boolean;
}
export interface OptionsResearchToolProps extends OptionsAuthoringToolProps {
  documentKey: string;
}

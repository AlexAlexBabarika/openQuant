/**
 * TypeScript mirror of the canonical `BacktestResult` blob produced by the
 * backend (`backend/backtesting/serialize.py::result_to_dict`). Field names and
 * casing match the JSON on the wire, so the dashboard reads the blob directly
 * with no remapping layer. Bar/equity timestamps are unix seconds (`t`); trade
 * timestamps are ISO-8601 strings.
 */

export type TradeSide = 'buy' | 'sell';

export interface BacktestBar {
  t: number; // unix seconds (UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BacktestOrder {
  id: number | null;
  side: TradeSide;
  quantity: number;
  type: string;
  limit: number | null;
  stop: number | null;
  submitted_index: number | null;
  triggered: boolean;
}

export interface BacktestFill {
  order_id: number;
  side: TradeSide;
  quantity: number;
  price: number;
  reference_price: number;
  slippage: number;
  spread_cost: number;
  commission: number;
  submitted_index: number;
  fill_index: number;
  reason: string;
}

export interface EquityPoint {
  t: number; // unix seconds (UTC)
  value: number;
  cash: number;
  holdings: number;
}

export interface BacktestTrade {
  direction: TradeSide;
  quantity: number;
  entry_time: string; // ISO-8601
  exit_time: string; // ISO-8601
  entry_index: number;
  exit_index: number;
  entry_price: number;
  exit_price: number;
  pnl: number;
  pnl_pct: number;
  bars_held: number;
}

export interface RunMeta {
  run_id?: string;
  data_quality?:
    | import('$lib/features/runs/dataQuality').DataQualityReport
    | null;
  seed: number;
  starting_cash: number;
  started_at: string; // ISO-8601
  finished_at: string; // ISO-8601
  strategy_id: string | null;
  params: Record<string, unknown> | null;
  data_version: string | null;
}

/**
 * The full pre-computed metrics taxonomy. Fields undefined for a run (e.g. trade
 * stats with no trades) arrive as `null`, mirroring the backend `Metrics`.
 */
export interface BacktestMetrics {
  // Return
  total_return: number;
  cagr: number;
  avg_annual_return: number;
  best_month: number | null;
  worst_month: number | null;
  best_year: number | null;
  worst_year: number | null;
  pct_positive_months: number | null;
  pct_positive_years: number | null;
  // Risk-adjusted
  sharpe: number;
  sortino: number;
  calmar: number;
  information_ratio: number;
  // Drawdown
  max_drawdown: number;
  max_drawdown_length: number;
  avg_drawdown: number;
  time_underwater: number;
  recovery_factor: number;
  // Trade quality
  win_rate: number | null;
  avg_win: number | null;
  avg_loss: number | null;
  win_loss_ratio: number | null;
  profit_factor: number | null;
  expectancy: number | null;
  max_consecutive_wins: number;
  max_consecutive_losses: number;
  avg_bars_held_winners: number | null;
  avg_bars_held_losers: number | null;
  // Exposure
  pct_time_in_market: number;
  avg_position_pct: number;
  max_leverage: number;
}

export interface BacktestResult {
  meta: RunMeta;
  bars: BacktestBar[];
  orders: BacktestOrder[];
  fills: BacktestFill[];
  equity: EquityPoint[];
  trades: BacktestTrade[];
  metrics: BacktestMetrics;
}

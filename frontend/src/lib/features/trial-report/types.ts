export type TrialStrategyId =
  | 'backtest-billionaire'
  | 'overcaffeinated-trader'
  | 'boring-benchmark';

export interface TrialStrategy {
  id: TrialStrategyId;
  name: string;
  description: string;
  lesson: string;
}

export interface TrialConfig {
  strategy_id: TrialStrategyId;
  commission_bps: number;
  slippage_bps: number;
}

export interface RunSummary {
  total_return: number;
  max_drawdown: number;
  trade_count: number;
  total_cost: number;
  equity: { t: number; value: number }[];
}

export interface TrialReport {
  schema_version: 1;
  report_id: string;
  strategy: TrialStrategy;
  dataset: {
    id: string;
    version: string;
    label: string;
    synthetic: true;
    start: string;
    end: string;
    split_date: string;
    training_bars: number;
    holdout_bars: number;
  };
  config: TrialConfig;
  baseline: RunSummary;
  realistic: RunSummary;
  benchmark: RunSummary;
  holdout: { strategy: RunSummary; benchmark: RunSummary };
  sensitivity: {
    parameter_value: number;
    total_return: number;
    max_drawdown: number;
  }[];
  selected_parameter: { name: string; value: number } | null;
  findings: {
    id: string;
    severity: 'info' | 'warning';
    title: string;
    detail: string;
  }[];
  assumptions: string[];
  limitations: string[];
}

export interface TrialCatalog {
  schema_version: 1;
  strategies: TrialStrategy[];
}

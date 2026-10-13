export interface RunStatus {
  stale: boolean;
  recorded: string;
  current: string;
}

export interface InputsDiffRow {
  path: string;
  a: unknown;
  b: unknown;
  category?: string;
  available?: { a: boolean; b: boolean };
  status?: ComparisonStatus;
}

export type ComparisonStatus = 'changed' | 'unchanged' | 'unavailable';

export interface RecordedComparisonContext {
  meta?: { data_quality?: Record<string, unknown> | null };
  config?: {
    date_range?: { start: string | number; end: string | number } | null;
    holdout?: Record<string, unknown> | null;
  };
}

export interface MetricDiffRow {
  metric: string;
  a: unknown;
  b: unknown;
  delta: number | null;
  abs_delta: number | null;
  label?: string;
  category?: string;
  available?: { a: boolean; b: boolean };
  status?: ComparisonStatus;
}

export interface EquityPointLite {
  t: number;
  value: number;
}

export interface EquityOverlay {
  a: EquityPointLite[];
  b: EquityPointLite[];
  residual: EquityPointLite[];
  available?: { a: boolean; b: boolean };
  alignment?: { common: number; only_a: number; only_b: number };
}

export type TradeKey = [string | null, string | null, string | null];

export interface TradeDiffEntry {
  key: TradeKey;
  occurrence?: number;
  fields: Record<
    string,
    {
      a: unknown;
      b: unknown;
      available?: { a: boolean; b: boolean };
      status?: ComparisonStatus;
    }
  >;
}

export interface TradeOnly {
  key: TradeKey;
  occurrence?: number;
  trade: Record<string, unknown>;
}

export interface TradesDiff {
  changed: TradeDiffEntry[];
  unchanged: TradeDiffEntry[];
  unavailable?: TradeDiffEntry[];
  only_in_a: TradeOnly[];
  only_in_b: TradeOnly[];
  available?: { a: boolean; b: boolean };
  count?: { a: number | null; b: number | null };
}

export interface RunDiff {
  lineage?: RunLineage;
  inputs_diff: InputsDiffRow[];
  metrics_diff: MetricDiffRow[];
  equity_overlay: EquityOverlay;
  trades_diff: TradesDiff;
  status: { a: RunStatus; b: RunStatus };
}

export interface LineageCell {
  available: boolean;
  value: unknown;
}

export interface RunLineage {
  rows: {
    path: string;
    label: string;
    category?: string;
    a: LineageCell;
    b: LineageCell;
    status: ComparisonStatus;
  }[];
  limitations: { a: string[]; b: string[] };
}

export interface RerunResponse {
  run_id: string;
  diff: RunDiff;
}

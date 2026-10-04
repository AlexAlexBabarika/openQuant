export interface RunStatus {
  stale: boolean;
  recorded: string;
  current: string;
}

export interface InputsDiffRow {
  path: string;
  a: unknown;
  b: unknown;
}

export interface MetricDiffRow {
  metric: string;
  a: number | null;
  b: number | null;
  delta: number | null;
  abs_delta: number | null;
}

export interface EquityPointLite {
  t: number;
  value: number;
}

export interface EquityOverlay {
  a: EquityPointLite[];
  b: EquityPointLite[];
  residual: EquityPointLite[];
}

export type TradeKey = [string | null, string, string];

export interface TradeDiffEntry {
  key: TradeKey;
  fields: Record<string, { a: unknown; b: unknown }>;
}

export interface TradeOnly {
  key: TradeKey;
  trade: Record<string, unknown>;
}

export interface TradesDiff {
  changed: TradeDiffEntry[];
  unchanged: TradeDiffEntry[];
  only_in_a: TradeOnly[];
  only_in_b: TradeOnly[];
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
    a: LineageCell;
    b: LineageCell;
    status: 'changed' | 'unchanged' | 'unavailable';
  }[];
  limitations: { a: string[]; b: string[] };
}

export interface RerunResponse {
  run_id: string;
  diff: RunDiff;
}

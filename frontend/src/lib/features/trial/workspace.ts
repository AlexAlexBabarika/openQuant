import { apiJson } from '$lib/core/api';
import type { MarketDataProviderValue } from '$lib/features/market/marketDataProviders';
import type {
  CostStress,
  RunSummary,
  TrialReport,
} from '$lib/features/trial-report/types';

export interface WorkspaceContext {
  code: string;
  name: string;
  symbol: string;
  provider: MarketDataProviderValue;
  period: string;
  interval: string;
}

export interface WorkspaceSettings {
  commission_bps: number;
  slippage_bps: number;
  starting_cash: number;
  holdout_fraction: number;
  params: Record<string, number | string>;
  sensitivity_parameter: string | null;
}

export interface WorkspaceFold {
  id: 1 | 2 | 3;
  status: 'measured' | 'inadequate-sample';
  train_start: string;
  train_end: string;
  training_bars: number;
  validation_start: string;
  validation_end: string;
  validation_bars: number;
  strategy: RunSummary | null;
  benchmark: RunSummary | null;
}

export interface WorkspaceWalkForward {
  status: 'measured' | 'inadequate-sample';
  folds: WorkspaceFold[];
  assumption: string;
  limitation: string;
}

export interface WorkspaceRegimes {
  status: 'measured' | 'inadequate-sample' | 'unsupported-data';
  method: 'validation-close-return-v1';
  threshold: 0.05;
  observations: {
    fold_id: 1 | 2 | 3;
    label: 'rising' | 'falling' | 'sideways';
    market_return: number;
  }[];
  assumption: string;
  limitation: string;
}

export type WorkspaceReport = Omit<
  TrialReport,
  'strategy' | 'dataset' | 'config' | 'sensitivity' | 'selected_parameter'
> & {
  source: 'workspace';
  code_hash: string;
  engine_version: string;
  suite_version?: string | null;
  cost_stress?: CostStress | null;
  walk_forward?: WorkspaceWalkForward | null;
  regimes?: WorkspaceRegimes | null;
  strategy: Omit<TrialReport['strategy'], 'id'> & { id: 'workspace' };
  dataset: Omit<TrialReport['dataset'], 'synthetic'> & { synthetic: false };
  config: WorkspaceSettings & { strategy_id: 'workspace'; seed: number };
  sensitivity: {
    parameter_value: number | string;
    total_return: number;
    max_drawdown: number;
  }[];
  selected_parameter: { name: string; value: number | string } | null;
};

export type EvidenceReport = TrialReport | WorkspaceReport;

export function isWorkspaceReport(
  report: EvidenceReport,
): report is WorkspaceReport {
  return 'source' in report && report.source === 'workspace';
}

export function parseParameterOverrides(
  input: string,
): Record<string, number | string> {
  const parsed = JSON.parse(input);
  if (
    !parsed ||
    Array.isArray(parsed) ||
    typeof parsed !== 'object' ||
    Object.keys(parsed).length > 16 ||
    Object.values(parsed).some(
      value =>
        typeof value !== 'string' &&
        (typeof value !== 'number' || !Number.isFinite(value)),
    )
  ) {
    throw new Error(
      'Parameters must be a JSON object with at most 16 finite numeric or string values.',
    );
  }
  return parsed;
}

export function workspaceFingerprint(
  context: WorkspaceContext,
  settings: WorkspaceSettings,
): string {
  return JSON.stringify([context, settings]);
}

export function runWorkspaceChecks(
  context: WorkspaceContext,
  settings: WorkspaceSettings,
  signal: AbortSignal,
): Promise<WorkspaceReport> {
  return apiJson<WorkspaceReport>(
    '/backtests/robustness',
    {
      method: 'POST',
      signal,
      body: JSON.stringify({ ...context, ...settings, seed: 0 }),
    },
    true,
  );
}

import { apiJson } from '$lib/core/api';
import type { MarketDataProviderValue } from '$lib/features/market/marketDataProviders';
import type { TrialReport } from '$lib/features/trial-report/types';

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

export type WorkspaceReport = Omit<
  TrialReport,
  'strategy' | 'dataset' | 'config' | 'sensitivity' | 'selected_parameter'
> & {
  source: 'workspace';
  code_hash: string;
  engine_version: string;
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

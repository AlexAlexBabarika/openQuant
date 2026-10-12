/**
 * HTTP wrappers for saved backtest strategies (`/strategies` CRUD) and the
 * single-run execution endpoint (`POST /backtests/run`). Bundled into a
 * `StrategyClient` so `StrategyState` tests can stub the network, mirroring
 * `sweepClient.ts`.
 */
import { apiFetch, apiJson, readErrorMessage } from '$lib/core/api';
import type { MarketDataProviderValue } from '$lib/features/market/marketDataProviders';
import type { BacktestResult } from '$lib/features/backtest/types';
import {
  runWithQuality,
  type QualityObserver,
} from '$lib/features/runs/dataQuality';

export type StrategyInfo = {
  id: string;
  name: string;
  code: string;
  created_at: string;
  updated_at: string;
};

export async function listStrategies(): Promise<StrategyInfo[]> {
  const data = await apiJson<{ strategies: StrategyInfo[] }>(
    '/strategies',
    {},
    true,
  );
  return data.strategies;
}

export function createStrategy(
  name: string,
  code: string,
): Promise<StrategyInfo> {
  return apiJson<StrategyInfo>(
    '/strategies',
    { method: 'POST', body: JSON.stringify({ name, code }) },
    true,
  );
}

export function updateStrategy(
  id: string,
  patch: { name?: string; code?: string },
): Promise<StrategyInfo> {
  return apiJson<StrategyInfo>(
    `/strategies/${id}`,
    { method: 'PUT', body: JSON.stringify(patch) },
    true,
  );
}

export async function deleteStrategy(id: string): Promise<void> {
  const res = await apiFetch(`/strategies/${id}`, { method: 'DELETE' }, true);
  if (!res.ok && res.status !== 404)
    throw new Error(await readErrorMessage(res));
}

export type BacktestRunParams = {
  code: string;
  symbol: string;
  provider: MarketDataProviderValue;
  period?: string;
  interval?: string;
  starting_cash?: number;
  seed?: number;
  params?: Record<string, number | string>;
};

/** The canonical result blob plus the sandbox run envelope. */
export type BacktestRunResponse = BacktestResult & {
  status: 'ok' | 'error' | 'timeout' | 'killed';
  stdout: string;
  stderr: string;
  elapsed_ms: number;
};

export function runBacktest(
  params: BacktestRunParams,
  observe?: QualityObserver,
): Promise<BacktestRunResponse> {
  return runWithQuality<BacktestRunResponse>(
    '/backtests/run',
    params,
    undefined,
    observe,
  );
}

export type StrategyClient = {
  list(): Promise<StrategyInfo[]>;
  create(name: string, code: string): Promise<StrategyInfo>;
  update(
    id: string,
    patch: { name?: string; code?: string },
  ): Promise<StrategyInfo>;
  remove(id: string): Promise<void>;
  runBacktest(
    params: BacktestRunParams,
    observe?: QualityObserver,
  ): Promise<BacktestRunResponse>;
};

export const httpStrategyClient: StrategyClient = {
  list: listStrategies,
  create: createStrategy,
  update: updateStrategy,
  remove: deleteStrategy,
  runBacktest,
};

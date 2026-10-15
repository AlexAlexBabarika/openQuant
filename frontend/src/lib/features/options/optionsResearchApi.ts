import { apiJson } from '$lib/core/api';
import type {
  ChainEnvironment,
  ChainExpirationsResponse,
  ChainResponse,
  ChainStatusResponse,
  DistributionRequest,
  DistributionResponse,
  FinderRequest,
  FinderResponse,
  HedgeRequest,
  HedgeResponse,
  LifecycleRequest,
  LifecycleResponse,
} from './optionsResearchTypes';

const post = <T>(path: string, request: unknown, signal?: AbortSignal) =>
  apiJson<T>(path, { method: 'POST', body: JSON.stringify(request), signal });

export const findStrategies = (request: FinderRequest, signal?: AbortSignal) =>
  post<FinderResponse>('/options/research/finder', request, signal);
export const evaluateLifecycle = (
  request: LifecycleRequest,
  signal?: AbortSignal,
) => post<LifecycleResponse>('/options/research/lifecycle', request, signal);
export const simulateHedge = (request: HedgeRequest, signal?: AbortSignal) =>
  post<HedgeResponse>('/options/research/hedge', request, signal);
export const analyzeDistribution = (
  request: DistributionRequest,
  signal?: AbortSignal,
) =>
  post<DistributionResponse>('/options/research/distribution', request, signal);

export const getChainStatus = (signal?: AbortSignal) =>
  apiJson<ChainStatusResponse>('/options/chains/status', { signal }, true);
export const getChainExpirations = (
  symbol: string,
  environment: ChainEnvironment,
  signal?: AbortSignal,
) =>
  apiJson<ChainExpirationsResponse>(
    `/options/chains/expirations?${new URLSearchParams({ symbol, environment })}`,
    { signal },
    true,
  );
export const getOptionChain = (
  symbol: string,
  expiration: string,
  environment: ChainEnvironment,
  signal?: AbortSignal,
) =>
  apiJson<ChainResponse>(
    `/options/chains/chain?${new URLSearchParams({ symbol, expiration, environment })}`,
    { signal },
    true,
  );

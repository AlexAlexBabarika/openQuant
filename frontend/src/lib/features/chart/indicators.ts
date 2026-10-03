import { apiJson } from '$lib/core/api';
import { maUrl, bbandsUrl } from '$lib/core/config';
import type {
  IndicatorResponse,
  BollingerBandsResponse,
} from '$lib/core/types';
import { movingAverageType } from '$lib/core/types';

export function fetchSMA(
  symbol: string,
  period: number,
  signal?: AbortSignal,
): Promise<IndicatorResponse> {
  return apiJson<IndicatorResponse>(
    maUrl(movingAverageType.SMA, symbol, period),
    { signal },
  );
}

export function fetchEMA(
  symbol: string,
  period: number,
  signal?: AbortSignal,
): Promise<IndicatorResponse> {
  return apiJson<IndicatorResponse>(
    maUrl(movingAverageType.EMA, symbol, period),
    { signal },
  );
}

export function fetchBBands(
  symbol: string,
  period: number,
  numStd: number,
  signal?: AbortSignal,
): Promise<BollingerBandsResponse> {
  return apiJson<BollingerBandsResponse>(bbandsUrl(symbol, period, numStd), {
    signal,
  });
}

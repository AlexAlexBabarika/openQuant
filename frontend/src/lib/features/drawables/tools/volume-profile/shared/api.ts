import type { VolumeProfileResponse } from './types';

export interface FetchProfileParams {
  provider: string;
  symbol: string;
  startTs: number;
  endTs?: number;
  rowSize: number;
  vaPercent: number;
  interval: string;
}

export async function fetchVolumeProfile(
  params: FetchProfileParams,
  signal: AbortSignal,
): Promise<VolumeProfileResponse> {
  const qs = new URLSearchParams({
    provider: params.provider,
    symbol: params.symbol,
    // Integer candle timestamps >= anchor: ceil preserves the selected window.
    startTs: String(Math.ceil(params.startTs)),
    rowSize: String(params.rowSize),
    vaPercent: String(params.vaPercent),
    interval: params.interval,
  });
  if (params.endTs !== undefined) {
    qs.set('endTs', String(Math.floor(params.endTs)));
  }
  const res = await fetch(`/data/volume-profile?${qs}`, { signal });
  if (!res.ok) {
    throw new Error(`Volume profile request failed: ${res.status}`);
  }
  return (await res.json()) as VolumeProfileResponse;
}

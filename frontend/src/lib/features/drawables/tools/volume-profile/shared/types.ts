export interface VolumeProfileBin {
  price: number;
  upVol: number;
  downVol: number;
}

export interface VolumeProfileResponse {
  rowSize: number;
  priceMin: number;
  priceMax: number;
  bins: VolumeProfileBin[];
  poc: number | null;
  vah: number | null;
  val: number | null;
  source: 'candle-distribution';
  provider: string;
  symbol: string;
  interval: string | null;
  startTs: number;
  endTs: number | null;
  firstCandleTs: number;
  latestCandleTs: number;
}

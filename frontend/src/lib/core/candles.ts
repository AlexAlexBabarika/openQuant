import type { OHLCVCandle } from './types';

export function hasValidOhlcv(c: OHLCVCandle): boolean {
  return (
    [c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite) &&
    c.volume >= 0 &&
    c.high >= Math.max(c.open, c.close, c.low) &&
    c.low <= Math.min(c.open, c.close, c.high)
  );
}

export function isUsableCandle(c: OHLCVCandle): boolean {
  return Number.isFinite(Date.parse(c.timestamp)) && hasValidOhlcv(c);
}

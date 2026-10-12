import { bench, describe } from 'vitest';
import type { OHLCVCandle } from '$lib/core/types';
import { computeStats, withRulerCandleIndex } from './compute';

const candles: OHLCVCandle[] = Array.from({ length: 50_000 }, (_, i) => ({
  symbol: 'SYNTHETIC',
  timestamp: new Date((1_700_000_000 + i * 60) * 1000).toISOString(),
  open: 100,
  high: 101,
  low: 99,
  close: 100,
  volume: 1000 + (i % 100),
}));
const ranges = Array.from({ length: 100 }, (_, i) => ({
  startTime: 1_700_000_000 + i * 100 * 60,
  endTime: 1_700_000_000 + (49_999 - i * 100) * 60,
  startPrice: 100,
  endPrice: 101,
}));

describe('shell-only: 50k bars / 100 overlapping Rulers', () => {
  // Changing the signature includes one shared index rebuild per publication.
  let revision = 0;
  bench('new publication (index rebuild + 100 ranges)', () => {
    withRulerCandleIndex(candles, `revision:${revision++}`, () => {
      for (const range of ranges) computeStats(range, candles);
    });
  });
  bench('geometry-only edit (shared warm index + 100 ranges)', () => {
    withRulerCandleIndex(candles, 'warm', () => {
      for (const range of ranges) computeStats(range, candles);
    });
  });
});

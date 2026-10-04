import { describe, expect, it, vi } from 'vitest';
import { positionLongTool, positionShortTool } from './tool';
import { fetchPositionMetrics } from './api';
import type { ComputeCtx } from '../../types';

vi.mock('./api', () => ({ fetchPositionMetrics: vi.fn(async () => ({})) }));

describe('position metric dependencies', () => {
  it.each([
    [positionLongTool, 'long'],
    [positionShortTool, 'short'],
  ] as const)(
    '%s computes only from fixed annotation prices',
    async (tool, side) => {
      const signal = new AbortController().signal;
      const ctx: ComputeCtx = {
        get candles(): never {
          throw new Error('Position metrics must not read candles');
        },
        provider: 'binance',
        symbol: 'TEST',
        interval: '1m',
        signal,
      };
      expect(tool.computeUsesCandles).toBe(false);
      await tool.compute!(
        {
          id: 'position',
          type: tool.type,
          symbol: 'TEST',
          createdAt: 0,
          geometry: {
            startTime: 0,
            endTime: 60,
            entryPrice: 100,
            stopPrice: 90,
            targetPrice: 120,
          },
          params: {},
          style: tool.defaults.style,
        },
        ctx,
      );
      expect(fetchPositionMetrics).toHaveBeenLastCalledWith(
        {
          side,
          entryPrice: 100,
          stopPrice: 90,
          targetPrice: 120,
        },
        signal,
      );
    },
  );
});

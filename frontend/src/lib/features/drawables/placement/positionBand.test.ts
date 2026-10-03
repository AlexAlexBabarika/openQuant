import { describe, it, expect } from 'vitest';
import { positionBandPlacement } from './positionBand';
import type { PlacementCtx } from '../types';

function fakeCtx(
  lastCandleTime: number | null | undefined,
  barStepSeconds?: number | null,
): PlacementCtx {
  return {
    coordMap: {} as PlacementCtx['coordMap'],
    symbol: 'X',
    lastCandleTime: lastCandleTime ?? null,
    barStepSeconds: barStepSeconds ?? null,
  };
}

describe('positionBandPlacement', () => {
  it.each(['long', 'short'] as const)(
    'uses a quarter-bar span on the final candle (%s)',
    side => {
      const m = positionBandPlacement(fakeCtx(1000, 400), side);
      let final: unknown;
      m.onComplete(g => {
        final = g;
      });
      m.onPointerUp({ time: 1000, price: 50 });
      expect(final).toMatchObject({ startTime: 900, endTime: 1000 });
    },
  );
  it('completes on first pointerUp with band anchored to last candle', () => {
    const m = positionBandPlacement(fakeCtx(1000), 'long');
    let final: unknown = null;
    m.onComplete(g => {
      final = g;
    });
    m.onPointerUp({ time: 100, price: 50 });
    expect(final).toMatchObject({
      endTime: 1000,
      entryPrice: 50,
    });
    const g = final as { startTime: number; endTime: number };
    expect(g.startTime).toBeLessThan(g.endTime);
    expect(m.done).toBe(true);
  });

  it('uses pointer time when no last candle', () => {
    const m = positionBandPlacement(fakeCtx(null), 'short');
    let final: unknown = null;
    m.onComplete(g => {
      final = g;
    });
    m.onPointerUp({ time: 500, price: 100 });
    const g = final as { endTime: number; entryPrice: number };
    expect(g.endTime).toBe(500);
    expect(g.entryPrice).toBe(100);
  });

  it('preview tracks hover before up', () => {
    const m = positionBandPlacement(fakeCtx(2000), 'long');
    m.onPointerMove({ time: 100, price: 10 });
    expect(m.preview?.geometry.entryPrice).toBe(10);
    m.cancel();
    expect(m.done).toBe(true);
  });

  it('past last candle anchors startTime to last bar and spans to pointer', () => {
    const m = positionBandPlacement(fakeCtx(1000, 100), 'long');
    let final: unknown = null;
    m.onComplete(g => {
      final = g;
    });
    m.onPointerUp({ time: 5000, price: 50 });
    const g = final as { startTime: number; endTime: number };
    expect(g.endTime).toBe(5000);
    expect(g.startTime).toBe(1000);
    expect(g.endTime - g.startTime).toBe(4000);
  });

  it('past last candle enforces minimum span from bar step when click is close in time', () => {
    const m = positionBandPlacement(fakeCtx(1000, 400), 'long');
    let final: unknown = null;
    m.onComplete(g => {
      final = g;
    });
    m.onPointerUp({ time: 1010, price: 50 });
    const g = final as { startTime: number; endTime: number };
    expect(g.endTime).toBe(1010);
    const minSpan = Math.max(1, Math.floor(400 * 0.25));
    expect(g.endTime - g.startTime).toBeGreaterThanOrEqual(minSpan);
    expect(g.startTime).toBe(1010 - minSpan);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { placementGesture } from './gesture';
import { rangePlacement } from './range';
import { pointPlacement } from './point';
import { positionBandPlacement } from './positionBand';
import type { PlacementCtx, PlacementMachine } from '../types';

const pt = { time: 1000, price: 100 };
const ctx = {
  symbol: 'AAA',
  lastCandleTime: 1000,
  barStepSeconds: 100,
} as PlacementCtx;
const machines: [string, () => PlacementMachine<unknown>][] = [
  ['ruler', rangePlacement],
  ['long', () => positionBandPlacement(ctx, 'long')],
  ['short', () => positionBandPlacement(ctx, 'short')],
];

describe('placement pointer lifecycle', () => {
  it.each(machines)(
    '%s never completes on cancellation or lost capture',
    (_, create) => {
      for (const type of ['pointercancel', 'lostpointercapture']) {
        const complete = vi.fn();
        const release = vi.fn();
        const gesture = placementGesture(
          create(),
          'context',
          1,
          () => 'context',
          complete,
          release,
        );
        gesture.down(1, pt);
        gesture.move(1, { time: 1100, price: 200 });
        gesture.end({ type, pointerId: 1 }, null);
        gesture.end({ type: 'pointerup', pointerId: 1 }, pt);
        expect(complete).toHaveBeenCalledTimes(0);
        expect(gesture.machine.preview).toBeNull();
        expect(release).toHaveBeenCalledTimes(1);
      }
    },
  );

  it.each([
    ...machines,
    ['avp', pointPlacement] as [string, () => PlacementMachine<unknown>],
  ])(
    '%s completes once in unchanged context and releases capture',
    (_, create) => {
      const complete = vi.fn();
      const release = vi.fn();
      const gesture = placementGesture(
        create(),
        'context',
        1,
        () => 'context',
        complete,
        release,
      );
      gesture.down(1, pt);
      gesture.end({ type: 'pointerup', pointerId: 1 }, pt);
      gesture.end({ type: 'lostpointercapture', pointerId: 1 }, null);
      gesture.down(1, pt);
      expect(complete).toHaveBeenCalledTimes(1);
      expect(release).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['symbol', 'provider', 'interval', 'series', 'tool'])(
    'fences a changed %s even before the reactive cleanup runs',
    changed => {
      const complete = vi.fn();
      let identity = 'original';
      const gesture = placementGesture(
        rangePlacement(),
        identity,
        1,
        () => identity,
        complete,
        vi.fn(),
      );
      gesture.down(1, pt);
      identity = changed;
      gesture.end(
        { type: 'pointerup', pointerId: 1 },
        { time: 2000, price: 200 },
      );
      expect(complete).not.toHaveBeenCalled();
      expect(gesture.closed).toBe(true);
      expect(gesture.machine.preview).toBeNull();
    },
  );

  it('does not accept another pointer or complete after explicit cancellation/unmount', () => {
    const complete = vi.fn();
    const gesture = placementGesture(
      rangePlacement(),
      'context',
      1,
      () => 'context',
      complete,
      vi.fn(),
    );
    gesture.down(1, pt);
    gesture.end({ type: 'pointercancel', pointerId: 2 }, null);
    expect(gesture.closed).toBe(false);
    gesture.end({ type: 'pointerup', pointerId: 2 }, pt);
    expect(complete).not.toHaveBeenCalled();
    gesture.cancel();
    gesture.end({ type: 'pointerup', pointerId: 1 }, pt);
    expect(complete).not.toHaveBeenCalled();
  });
});

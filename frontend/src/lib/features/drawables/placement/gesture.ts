import type { ChartPoint, PlacementMachine } from '../types';

/** A gesture owns one pointer, machine and immutable view/tool identity. */
export function placementGesture<Geo>(
  machine: PlacementMachine<Geo>,
  identity: string,
  pointerId: number,
  currentIdentity: () => string,
  complete: (geo: Geo) => void,
  release: () => void,
) {
  let closed = false;
  function cancel() {
    if (closed) return;
    closed = true;
    machine.cancel();
    release();
  }
  function accepts(id: number): boolean {
    if (identity !== currentIdentity()) cancel();
    return !closed && id === pointerId;
  }
  machine.onComplete(geo => {
    if (!accepts(pointerId)) return;
    closed = true;
    complete(geo);
    release();
  });
  return {
    machine,
    cancel,
    down(id: number, pt: ChartPoint) {
      if (accepts(id)) machine.onPointerDown(pt);
    },
    move(id: number, pt: ChartPoint) {
      if (accepts(id)) machine.onPointerMove(pt);
    },
    up(id: number, pt: ChartPoint) {
      if (accepts(id)) machine.onPointerUp(pt);
    },
    end(
      event: Pick<PointerEvent, 'type' | 'pointerId'>,
      pt: ChartPoint | null,
    ) {
      if (!accepts(event.pointerId)) return;
      if (event.type !== 'pointerup' || !pt) cancel();
      else machine.onPointerUp(pt);
    },
    get closed() {
      return closed;
    },
  };
}

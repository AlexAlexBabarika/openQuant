import { describe, expect, it, vi } from 'vitest';
import {
  client,
  clientModule,
  componentDeclarations,
} from '$lib/features/chart/reactiveTestSupport';
import { placementGesture } from '$lib/features/drawables/placement/gesture';
import { chartKeyAction } from '$lib/features/drawables/placement/keyboard';
import { rangePlacement } from '$lib/features/drawables/placement/range';

const url = new URL('./ChartDrawables.svelte', import.meta.url);
const component = clientModule<{
  default: (
    anchor: unknown,
    props: unknown,
  ) => {
    handlePointerDown: (e: PointerEvent) => void;
    handlePointerUp: (e: PointerEvent) => void;
    handleKeyDown: (e: KeyboardEvent) => void;
  };
}>(
  url,
  { 'test:placement': { placementGesture, chartKeyAction, rangePlacement } },
  `<script lang="ts">
    import { placementGesture, chartKeyAction, rangePlacement } from 'test:placement';
    let { containerEl, drawables, onActiveToolChange, toChartPoint, activeTool = 'ruler' } = $props();
    const CURSOR = 'cursor';
    const coordMap = {};
    const symbol = 'TEST';
    const lastCandleTime = 2;
    const barStepSeconds = 1;
    const gestureIdentity = 'TEST:ruler';
    const getTool = () => ({ type: 'ruler', defaults: { params: {}, style: {} }, createPlacement: rangePlacement });
    const deepCloneDrawableSnapshot = structuredClone;
    const refreshPlacementPreview = () => {};
    const visibleSelection = () => null;
    ${componentDeclarations(url, ['placement', 'setActiveTool', 'cancelPlacement', 'handlePointerDown', 'handlePointerUp', 'handleKeyDown'])}
  </script>`,
).default;

function fixture() {
  const toolbar = {};
  let focus: unknown = toolbar;
  const containerEl = {
    focus: vi.fn(() => {
      focus = containerEl;
    }),
    setPointerCapture: vi.fn(),
    hasPointerCapture: () => true,
    releasePointerCapture: vi.fn(),
  };
  const drawables = { add: vi.fn(), select: vi.fn() };
  const onActiveToolChange = vi.fn();
  let handlers!: ReturnType<typeof component>;
  const toChartPoint = vi.fn(() => ({ time: 1, price: 100 }));
  const stop = client.effect_root(() => {
    handlers = component(null, {
      containerEl,
      drawables,
      onActiveToolChange,
      toChartPoint,
    });
  });
  const pointer = (type: string) =>
    ({
      type,
      button: 0,
      pointerId: 1,
      target: null,
      preventDefault: vi.fn(),
    }) as unknown as PointerEvent;
  return {
    containerEl,
    drawables,
    onActiveToolChange,
    handlers,
    toChartPoint,
    stop,
    pointer,
    focused: () => focus,
  };
}

describe('drawable placement keyboard focus', () => {
  it('moves focus from the toolbar to the chart so Escape cancels before pointer release', () => {
    const f = fixture();
    try {
      f.handlers.handlePointerDown(f.pointer('pointerdown'));
      expect(f.focused()).toBe(f.containerEl);
      expect(f.containerEl.focus).toHaveBeenCalledWith({ preventScroll: true });
      f.handlers.handleKeyDown({
        key: 'Escape',
        target: f.containerEl,
      } as unknown as KeyboardEvent);
      f.handlers.handlePointerUp(f.pointer('pointerup'));
      expect(f.drawables.add).not.toHaveBeenCalled();
      expect(f.containerEl.releasePointerCapture).toHaveBeenCalledOnce();
      expect(f.onActiveToolChange).toHaveBeenCalledWith('cursor');
    } finally {
      f.stop();
    }
  });

  it('still completes a normal placement exactly once', () => {
    const f = fixture();
    try {
      f.handlers.handlePointerDown(f.pointer('pointerdown'));
      f.handlers.handlePointerUp(f.pointer('pointerup'));
      f.handlers.handlePointerUp(f.pointer('pointerup'));
      expect(f.drawables.add).toHaveBeenCalledOnce();
      expect(f.containerEl.releasePointerCapture).toHaveBeenCalledOnce();
    } finally {
      f.stop();
    }
  });
});

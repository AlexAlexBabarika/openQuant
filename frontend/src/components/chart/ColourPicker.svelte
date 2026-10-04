<script lang="ts" module>
  export function sliderValueForKey(
    event: Pick<KeyboardEvent, 'key' | 'preventDefault'>,
    value: number,
    max: number,
  ): number | null {
    let next: number;
    switch (event.key) {
      case 'ArrowRight': case 'ArrowUp': next = value + 1; break;
      case 'ArrowLeft': case 'ArrowDown': next = value - 1; break;
      case 'Home': next = 0; break;
      case 'End': next = max; break;
      default: return null;
    }
    event.preventDefault();
    return Math.max(0, Math.min(max, next));
  }
</script>

<script lang="ts">
  import { cssColourToHsva, hsvaToHex, hsvaToRgba, type HSVA } from '$lib/features/chart/colourUtils';

  let {
    colour = $bindable('#000000'),
  }: {
    colour: string;
  } = $props();

  const PRESETS = [
    '#ef4444', '#f97316', '#eab308', '#22c55e',
    '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
  ];

  const GRAD_W = 224;
  const GRAD_H = 150;
  const STRIP_H = 14;

  let hsva: HSVA = $state(cssColourToHsva(colour));
  let hexInput: string = $state(colour.startsWith('#') ? colour : hsvaToHex(cssColourToHsva(colour)));

  function emitColour() {
    const hex = hsvaToHex(hsva);
    colour = hex;
    hexInput = hex;
  }

  type DragKind = 'grad' | 'hue' | 'alpha';
  let dragging = $state<DragKind | null>(null);

  function makeDrag(
    kind: DragKind,
    applyDelta: (rect: DOMRect, e: PointerEvent) => Partial<HSVA>,
  ) {
    function update(e: PointerEvent, rect: DOMRect) {
      hsva = { ...hsva, ...applyDelta(rect, e) };
      emitColour();
    }
    return {
      down(e: PointerEvent) {
        dragging = kind;
        const el = e.currentTarget as HTMLElement;
        el.setPointerCapture(e.pointerId);
        update(e, el.getBoundingClientRect());
      },
      move(e: PointerEvent) {
        if (dragging !== kind) return;
        update(e, (e.currentTarget as HTMLElement).getBoundingClientRect());
      },
      up() {
        if (dragging === kind) dragging = null;
      },
    };
  }

  const grad = makeDrag('grad', (rect, e) => {
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const y = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
    return { s: x / rect.width, v: 1 - y / rect.height };
  });

  const hue = makeDrag('hue', (rect, e) => {
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    return { h: (x / rect.width) * 360 };
  });

  const alpha = makeDrag('alpha', (rect, e) => {
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    return { a: x / rect.width };
  });

  function onStripKey(event: KeyboardEvent, kind: 'h' | 'a') {
    const max = kind === 'h' ? 360 : 100;
    const value = kind === 'h' ? hsva.h : hsva.a * 100;
    const next = sliderValueForKey(event, Math.round(value), max);
    if (next === null) return;
    hsva = { ...hsva, [kind]: kind === 'h' ? next : next / 100 };
    emitColour();
  }

  function handleHexInput(e: Event) {
    const val = (e.target as HTMLInputElement).value;
    hexInput = val;
    if (/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(val)) {
      hsva = cssColourToHsva(val);
      colour = val;
    }
  }

  function pickPreset(hex: string) {
    hsva = cssColourToHsva(hex);
    emitColour();
  }

  let hueColour = $derived(`hsl(${hsva.h}, 100%, 50%)`);
  let opaqueRgba = $derived(hsvaToRgba({ ...hsva, a: 1 }));
  let currentRgba = $derived(hsvaToRgba(hsva));
  let gradThumbLeft = $derived(hsva.s * 100);
  let gradThumbTop = $derived((1 - hsva.v) * 100);
  let hueThumbLeft = $derived((hsva.h / 360) * 100);
  let alphaThumbLeft = $derived(hsva.a * 100);
</script>

<div
  class="relative rounded-md overflow-hidden cursor-crosshair touch-none"
  style="width: 100%; max-width: {GRAD_W}px; height: {GRAD_H}px; background: {hueColour};"
  role="presentation"
  onpointerdown={grad.down}
  onpointermove={grad.move}
  onpointerup={grad.up}
>
  <div class="absolute inset-0" style="background: linear-gradient(to right, #fff, transparent);"></div>
  <div class="absolute inset-0" style="background: linear-gradient(to top, #000, transparent);"></div>
  <div
    class="absolute w-3.5 h-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_3px_rgba(0,0,0,0.6)] pointer-events-none"
    style="left: {gradThumbLeft}%; top: {gradThumbTop}%;"
  ></div>
</div>

<div
  class="relative mt-3 rounded cursor-pointer touch-none"
  style="width: 100%; max-width: {GRAD_W}px; height: {STRIP_H}px; background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);"
  role="slider"
  tabindex="0"
  aria-label="Hue"
  aria-valuenow={Math.round(hsva.h)}
  aria-valuemin={0}
  aria-valuemax={360}
  aria-valuetext={`${Math.round(hsva.h)} degrees`}
  onkeydown={e => onStripKey(e, 'h')}
  onpointerdown={hue.down}
  onpointermove={hue.move}
  onpointerup={hue.up}
>
  <div
    class="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-2.5 h-4 rounded-sm border-2 border-white shadow-[0_0_3px_rgba(0,0,0,0.6)] pointer-events-none"
    style="left: {hueThumbLeft}%;"
  ></div>
</div>

<div
  class="relative mt-2 rounded cursor-pointer touch-none"
  style="width: 100%; max-width: {GRAD_W}px; height: {STRIP_H}px;"
  role="slider"
  tabindex="0"
  aria-label="Alpha"
  aria-valuenow={Math.round(hsva.a * 100)}
  aria-valuemin={0}
  aria-valuemax={100}
  aria-valuetext={`${Math.round(hsva.a * 100)} percent`}
  onkeydown={e => onStripKey(e, 'a')}
  onpointerdown={alpha.down}
  onpointermove={alpha.move}
  onpointerup={alpha.up}
>
  <div
    class="absolute inset-0 rounded"
    style="background-image: repeating-conic-gradient(#555 0% 25%, #333 0% 50%); background-size: 8px 8px;"
  ></div>
  <div
    class="absolute inset-0 rounded"
    style="background: linear-gradient(to right, transparent, {opaqueRgba});"
  ></div>
  <div
    class="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-2.5 h-4 rounded-sm border-2 border-white shadow-[0_0_3px_rgba(0,0,0,0.6)] pointer-events-none"
    style="left: {alphaThumbLeft}%;"
  ></div>
</div>

<style>
  [role='slider']:focus-visible, button:focus-visible, input:focus-visible {
    outline: 2px solid oklch(var(--foreground));
    outline-offset: 2px;
  }
  @media (forced-colors: active) {
    [role='slider']:focus-visible, button:focus-visible, input:focus-visible { outline-color: Highlight; }
  }
</style>

<div class="flex gap-1.5 mt-3">
  {#each PRESETS as preset}
    <button
      type="button"
      class="w-5 h-5 rounded border border-border hover:border-foreground transition-colors cursor-pointer"
      style="background-color: {preset};"
      onclick={() => pickPreset(preset)}
      aria-label="Pick {preset}"
    ></button>
  {/each}
</div>

<div class="flex items-center gap-2 mt-3">
  <div
    class="w-7 h-7 rounded border border-border flex-shrink-0"
    style="background-color: {currentRgba};"
  ></div>
  <input
    type="text"
    value={hexInput}
    oninput={handleHexInput}
    class="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-sm text-foreground font-mono"
    spellcheck="false"
    aria-label="Hex colour value"
  />
</div>

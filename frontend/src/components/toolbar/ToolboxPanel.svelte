<script lang="ts" module>
  export type ToolboxPanelApi = {
    beginDrag: () => void;
    updateDrag: (deltaY: number) => void;
    endDrag: (velocityPxPerSec: number) => void;
    toggle: () => void;
  };
</script>

<script lang="ts">
  import { Dialog } from 'bits-ui';
  import { onDestroy, tick, untrack } from 'svelte';
  import { createModalLifecycle } from '$lib/core/modalLifecycle';
  import X from '@lucide/svelte/icons/x';
  import { runSpring } from '$lib/features/chart/spring';
  import ChartCandlestick from '@lucide/svelte/icons/chart-candlestick';
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import type { Theme } from '$lib/features/theme/theme';

  let {
    open = $bindable(false),
    api = $bindable<ToolboxPanelApi | null>(null),
    onTileSelect,
  }: {
    open?: boolean;
    api?: ToolboxPanelApi | null;
    theme: Theme;
    onTileSelect?: (title: string) => void;
  } = $props();

  // 0 = closed, 1 = open. May briefly overshoot for the bounce.
  let progress = $state(0);
  let panelEl = $state<HTMLDivElement | null>(null);
  let dialogEl = $state<HTMLDivElement | null>(null);
  let triggerEl = $state<HTMLButtonElement | null>(null);
  const modal = createModalLifecycle();
  onDestroy(() => { modal.close(); cancelSpring?.(); });
  let cancelSpring: (() => void) | null = null;
  let animatedOpen = false;

  let dragging = false;
  let dragStartProgress = 0;

  function clamp(v: number, lo: number, hi: number) {
    return Math.max(lo, Math.min(hi, v));
  }

  function panelHeight(): number {
    return panelEl?.getBoundingClientRect().height ?? window.innerHeight * 0.8;
  }

  function animateTo(target: number, velocity = 0) {
    animatedOpen = target === 1;
    cancelSpring?.();
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      progress = target;
      cancelSpring = null;
      return;
    }
    cancelSpring = runSpring({
      from: progress,
      to: target,
      velocity,
      onUpdate: v => (progress = v),
    });
  }

  function beginDrag() {
    cancelSpring?.();
    cancelSpring = null;
    dragging = true;
    dragStartProgress = progress;
  }

  function updateDrag(deltaY: number) {
    if (!dragging) return;
    const h = panelHeight();
    // Dragging up (negative deltaY) opens the panel.
    progress = clamp(dragStartProgress + -deltaY / h, -0.05, 1.05);
  }

  function endDrag(velocityPxPerSec: number) {
    if (!dragging) return;
    dragging = false;
    const h = panelHeight();
    const progressVelocity = -velocityPxPerSec / h;
    let target: number;
    if (Math.abs(progressVelocity) > 1.5) {
      target = progressVelocity > 0 ? 1 : 0;
    } else {
      target = progress > 0.5 ? 1 : 0;
    }
    open = target === 1;
    animateTo(target, progressVelocity);
  }

  function toggle() {
    const target = open ? 0 : 1;
    open = !open;
    animateTo(target);
  }

  api = { beginDrag, updateDrag, endDrag, toggle };

  function close() {
    if (!open && progress < 0.001) return;
    open = false;
    animateTo(0);
  }

  function restoreTriggerFocus(event: Event) {
    modal.close();
    event.preventDefault();
    void tick().then(() => requestAnimationFrame(focusTrigger));
  }

  function focusTrigger() {
    const doc = triggerEl?.ownerDocument;
    const otherDialog = Array.from(doc?.querySelectorAll('[role="dialog"]') ?? []).some(node => node !== dialogEl);
    if (!open && !otherDialog) triggerEl?.focus();
  }

  $effect(() => {
    const nextOpen = open;
    untrack(() => {
      if (!dragging && animatedOpen !== nextOpen) animateTo(nextOpen ? 1 : 0);
    });
  });

  const cards = [
    { title: 'Strategy', purpose: 'Write Python, run a backtest, inspect results.' },
    { title: 'Backtesting', purpose: 'Inspect the latest simulated run and trades.' },
    { title: 'Analytics', purpose: 'Measure returns, risk and distributions on chart data.' },
    { title: 'Indicators', purpose: 'Write and project Python indicators onto the chart.' },
    { title: 'Runs', purpose: 'Reopen stored runs and compare reproducible outputs.' },
  ];

  let backdropOpacity = $derived(clamp(progress, 0, 1));
  let translatePct = $derived((1 - progress) * 100);
  let interactive = $derived(progress > 0.001);

  // Handle pointer-drag state.
  let pointerId: number | null = null;
  let startY = 0;
  let startTime = 0;
  let maxAbsDelta = 0;
  let samples: { t: number; y: number }[] = [];

  function pushSample(now: number, y: number) {
    samples.push({ t: now, y });
    if (samples.length > 6) samples.shift();
  }

  function endVelocity(): number {
    if (samples.length < 2) return 0;
    const last = samples[samples.length - 1];
    let ref = samples[0];
    for (const s of samples) {
      if (last.t - s.t <= 80) {
        ref = s;
        break;
      }
    }
    const dt = (last.t - ref.t) / 1000;
    if (dt <= 0) return 0;
    return (last.y - ref.y) / dt;
  }

  function onHandlePointerDown(e: PointerEvent) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    pointerId = e.pointerId;
    startY = e.clientY;
    startTime = e.timeStamp;
    maxAbsDelta = 0;
    samples = [];
    pushSample(e.timeStamp, e.clientY);
    const target = e.currentTarget as HTMLElement;
    target.focus();
    target.setPointerCapture(e.pointerId);
    e.preventDefault();
    beginDrag();
  }

  function onHandlePointerMove(e: PointerEvent) {
    if (pointerId === null || e.pointerId !== pointerId) return;
    const delta = e.clientY - startY;
    if (Math.abs(delta) > maxAbsDelta) maxAbsDelta = Math.abs(delta);
    pushSample(e.timeStamp, e.clientY);
    updateDrag(delta);
  }

  function onHandlePointerEnd(e: PointerEvent) {
    if (pointerId === null || e.pointerId !== pointerId) return;
    const target = e.currentTarget as HTMLElement;
    if (target.hasPointerCapture(e.pointerId)) {
      target.releasePointerCapture(e.pointerId);
    }
    pointerId = null;
    const wasTap = maxAbsDelta < 5 && e.timeStamp - startTime < 300;
    endDrag(endVelocity());
    if (wasTap) toggle();
  }

  function onHandleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  }
</script>

<Dialog.Root bind:open onOpenChangeComplete={value => { if (!value) { modal.close(); void tick().then(focusTrigger); } }}>
    <Dialog.Trigger bind:ref={triggerEl} type="button" class="toolbox-trigger ot-workbench-ghost" aria-label="Open toolbox" style="visibility: {open ? 'hidden' : 'visible'}; transition-property: color, background-color, border-color, box-shadow" inert={open}>Tools</Dialog.Trigger>
  <Dialog.Portal disabled={typeof window === 'undefined'}>
    <Dialog.Overlay>
      {#snippet child({ props })}
        <div {...props}
          class="fixed inset-0 z-50 bg-black"
          style:opacity={backdropOpacity * 0.5}
          style:backdrop-filter="blur({backdropOpacity * 12}px)"
          style:-webkit-backdrop-filter="blur({backdropOpacity * 12}px)"
          style:pointer-events={interactive ? 'auto' : 'none'}
        ></div>
      {/snippet}
    </Dialog.Overlay>
    <Dialog.Content
      onOpenAutoFocus={e => {
        modal.open(dialogEl);
        e.preventDefault();
        panelEl?.querySelector<HTMLButtonElement>('button')?.focus();
      }}
      onCloseAutoFocus={restoreTriggerFocus}
    >
    {#snippet child({ props })}
<div {...props}
  bind:this={dialogEl}
  class="fixed inset-0 z-50 pointer-events-none"
  style:pointer-events="none"
  style:--progress={progress}
  role={open ? 'dialog' : undefined}
  aria-modal={open ? 'true' : undefined}
  aria-label={open ? 'Toolbox' : undefined}
>
  {#if open}
  <div
    class="pull-handle pointer-events-auto absolute left-1/2 -translate-x-1/2 flex flex-col items-center cursor-grab active:cursor-grabbing select-none touch-none"
    style="bottom: calc(min(480px, 80dvh) * var(--progress))"
    role="button"
    tabindex="0"
    aria-label={open ? 'Close toolbox' : 'Open toolbox'}
    aria-expanded={open}
    onpointerdown={onHandlePointerDown}
    onpointermove={onHandlePointerMove}
    onpointerup={onHandlePointerEnd}
    onpointercancel={onHandlePointerEnd}
    onkeydown={onHandleKeydown}
  >
    <div class="relative w-16 h-6">
      <svg
        class="absolute left-0 bottom-0 w-full h-[140%] overflow-visible"
        viewBox="0 0 80 32"
        preserveAspectRatio="none"
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path
          d="M2.5 32 C 2.2 10, 4 5, 13 3.5 C 26 2, 54 2.2, 67 3.5 C 76 5, 77.8 10, 77.5 32"
          stroke-width="1.5"
        />
        <path
          d="M15 32 C 14.7 18, 16 14.5, 22 13.5 C 32 12.5, 48 12.5, 58 13.5 C 64 14.5, 65.3 18, 65 32"
          stroke-width="1.3"
        />
      </svg>
      <ChevronUp
        class="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-3 w-3"
        strokeWidth={2.5}
      />
    </div>
  </div>
  {/if}

  <div
    inert={!open}
    aria-hidden={!open}
    bind:this={panelEl}
    class="absolute left-0 right-0 bottom-0 h-[min(480px,80dvh)] bg-popover text-popover-foreground rounded-t-lg shadow-lg border-t border-border overflow-hidden"
    style:transform="translateY({translatePct}%)"
    style:pointer-events={interactive ? 'auto' : 'none'}
    aria-label="Toolbox"
  >
    <div class="h-full overflow-y-auto p-4 sm:p-6">
      <div class="flex items-center gap-3 mb-4">
        <div
          class="flex items-center gap-1.5 font-mono text-lg font-semibold tracking-tight select-none"
        >
          <span>openQuant</span>
          <ChartCandlestick class="h-5 w-5 text-primary" />
        </div>
        <h2 class="ml-auto text-lg font-semibold font-mono">Toolbox</h2>
        <Dialog.Close type="button" class="rounded p-1 hover:bg-accent" aria-label="Close toolbox"><X class="h-4 w-4" /></Dialog.Close>
      </div>
      <p class="mb-3 text-xs text-muted-foreground">Research tools · simulated outputs, no live orders</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {#each cards as card (card.title)}
          <button type="button" class="tool-card" aria-label="Open {card.title}" disabled={!onTileSelect} onclick={async () => {
              if (onTileSelect) {
                  close();
                  await tick();
                  onTileSelect(card.title);
                }
              }}><span class="font-mono text-sm font-bold">{card.title}</span><span class="text-xs text-muted-foreground">{card.purpose}</span></button>
        {/each}
      </div>
      <p class="mt-4 text-xs text-muted-foreground">Chart annotations are separate: use Drawing tools for rulers, volume profiles and long/short position annotations. Their settings apply to all Elements of a type, not a selected object.</p>
    </div>
  </div>
</div>
    {/snippet}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<style>
  .tool-card { display: flex; flex-direction: column; gap: 6px; padding: 12px; text-align: left; background: oklch(var(--background)); border: 1px solid oklch(var(--border)); border-radius: 4px; cursor: pointer; }
  .tool-card:hover { background: oklch(var(--accent)); }
  .toolbox-trigger { position: fixed; bottom: 6px; left: 50%; transform: translateX(-50%); z-index: 40; }
  .pull-handle:focus-visible, button:focus-visible {
    outline: 2px solid oklch(var(--foreground));
    outline-offset: 2px;
  }
  @media (forced-colors: active) {
    .pull-handle:focus-visible, button:focus-visible { outline-color: Highlight; }
  }
  .pull-handle {
    color: color-mix(in oklab, oklch(var(--foreground)) 55%, transparent);
    transition: color 160ms ease;
  }
  .pull-handle:hover {
    color: oklch(var(--foreground));
  }
</style>

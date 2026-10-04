<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { Dialog } from 'bits-ui';
  import { createModalLifecycle } from '$lib/core/modalLifecycle';
  import X from '@lucide/svelte/icons/x';
  import { BacktestState } from '$lib/features/backtest/backtestState.svelte';
  import MetricsStrip from './MetricsStrip.svelte';
  import BacktestChart from './BacktestChart.svelte';
  import ResultTabs from './ResultTabs.svelte';
  import RunIdChip from './RunIdChip.svelte';
  import StaleBanner from './StaleBanner.svelte';
  import { runsHistory } from '$lib/features/runs/runsHistory.svelte';
  import { RerunState } from '$lib/features/backtest/rerunState.svelte';
  import type { RunDiff } from '$lib/features/runs/runTypes';

  let {
    open = $bindable(false),
    backtest = new BacktestState(),
    onCompareAfterRerun,
    onOpenRuns,
    onCompare,
    embedded = false,
  }: {
    open?: boolean;
    backtest?: BacktestState;
    onCompareAfterRerun?: (a: string, b: string, diff: RunDiff) => void;
    onOpenRuns?: () => void;
    onCompare?: (a: string, b: string) => void;
    embedded?: boolean;
  } = $props();

  const rerunState = new RerunState();

  $effect(() => {
    backtest.result?.meta.run_id;
    open;
    rerunState.reset();
  });

  async function rerun(): Promise<void> {
    const source = backtest;
    const accountVersion = runsHistory.accountVersion;
    const id = source.result?.meta.run_id;
    if (!id) return;
    const label = source.result?.meta.strategy_id ?? 'run';
    const resp = await rerunState.run(id);
    if (
      resp &&
      accountVersion === runsHistory.accountVersion &&
      source === backtest &&
      id === backtest.result?.meta.run_id &&
      open
    ) {
      runsHistory.record({
        run_id: resp.run_id,
        kind: 'single',
        label,
        created_at: new Date().toISOString(),
      });
      onCompareAfterRerun?.(id, resp.run_id, resp.diff);
    }
  }

  // Load the result the first time the panel opens.
  $effect(() => {
    const state = backtest;
    if (open && !embedded) untrack(() => void state.load());
  });


  const modal = createModalLifecycle();
  onDestroy(() => modal.close());
  let panelEl = $state<HTMLDivElement | null>(null);

  function close() {
    rerunState.reset();
    open = false;
  }


  const meta = $derived(backtest.result?.meta ?? null);
</script>

{#snippet resultContent()}
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark">≈</span>
        <span class="brand-title">backtest</span>
        <span class="brand-sub">/ simulated results · no real orders</span>
      </div>

      <div class="ctx" aria-label="Strategy">
        <span class="ctx-label">STRAT</span>
        <span class="ctx-sym">{meta?.strategy_id ?? '—'}</span>
        {#if meta?.run_id}
          <RunIdChip runId={meta.run_id} onCompare={onOpenRuns} />
          {#if onCompare && runsHistory.baseline && runsHistory.baseline.run_id !== meta.run_id}
            <button type="button" class="ot-workbench-ghost" onclick={() => onCompare?.(runsHistory.baseline!.run_id, meta.run_id)}>Compare with baseline</button>
          {/if}
        {/if}
      </div>

      {#if !embedded}<button type="button" class="iconbtn close" onclick={close} aria-label="Close">
        <X class="h-3.5 w-3.5" />
      </button>{/if}
    </header>

    <StaleBanner
      status={backtest.status}
      rerunning={rerunState.running}
      error={rerunState.error}
      onRerun={rerun}
    />

    <div class="body" class:has-selection={backtest.selection !== null}>
      {#if backtest.loading && !backtest.result}
        <p class="status">Loading result…</p>
      {:else if backtest.error}
        <div class="status">
          <p class="err" role="alert">{backtest.error}</p>
          {#if !embedded}
            <p class="text-xs text-muted-foreground">A notebook reference does not guarantee that its stored result is available. Stored snapshots are server-local and not account-scoped.</p>
            <button type="button" class="ot-workbench-ghost" onclick={() => void backtest.load()}>Retry loading result</button>
          {/if}
        </div>
      {:else if backtest.result && backtest.result.bars.length === 0}
        <p class="status">
          This run returned no market bars. Check the symbol and data range before running again.
        </p>
      {:else if backtest.result}
        <MetricsStrip metrics={backtest.result.metrics} />
        {#if backtest.selection}
          <div class="selection-summary flex flex-wrap items-center gap-2 px-3 py-1 text-xs" role="status">
            <span>{backtest.selection.label} · this run's price bars</span>
            <button type="button" class="ot-workbench-ghost" onclick={() => backtest.clearSelection()}>Show full run</button>
          </div>
        {/if}
        <div class="chart-pane">
          <BacktestChart {backtest} />
        </div>
        <div class="tabs-pane">
          <ResultTabs {backtest} />
        </div>
      {/if}
    </div>
{/snippet}

{#if embedded}
  <section class="panel embedded" aria-label="Backtest results">{@render resultContent()}</section>
{:else}
<Dialog.Root {open} onOpenChange={v => { if (!v) close(); }}>
  <Dialog.Portal disabled={typeof window === 'undefined'}>
    <Dialog.Overlay>
      {#snippet child({ props })}<div {...props} class="backdrop"></div>{/snippet}
    </Dialog.Overlay>
    <Dialog.Content onOpenAutoFocus={() => modal.open(panelEl)} onCloseAutoFocus={() => modal.close()}>
    {#snippet child({ props })}
  <div {...props} bind:this={panelEl} class="panel" role="dialog" aria-modal="true" aria-label="Backtest results">
    {@render resultContent()}
  </div>
    {/snippet}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
{/if}

<style>
  .panel.embedded { position: static; height: 100%; width: 100%; flex: 1; min-height: 0; border: 0; border-radius: 0; box-shadow: none; z-index: auto; container-type: inline-size; }
  .embedded .topbar { display: flex; flex-wrap: wrap; gap: 8px; padding: 10px 12px; }
  .embedded .body { display: flex; flex-direction: column; overflow-y: auto; }
  .embedded .chart-pane { height: 260px; flex-shrink: 0; }
  .embedded .tabs-pane { min-height: 320px; flex-shrink: 0; }
  button:focus-visible { outline: 2px solid oklch(var(--foreground)); outline-offset: 2px; }
  @media (forced-colors: active) { button:focus-visible { outline-color: Highlight; } }

  .backdrop {
    position: fixed;
    inset: 0;
    z-index: calc(60 + var(--bits-dialog-depth, 0) * 2);
    background: oklch(var(--background) / 0.55);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    border: 0;
    padding: 0;
    cursor: pointer;
    animation: fadeIn 180ms ease;
  }
  .panel {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    height: 92vh;
    z-index: calc(61 + var(--bits-dialog-depth, 0) * 2);
    display: flex;
    flex-direction: column;
    color: oklch(var(--foreground));
    background:
      radial-gradient(
        1200px 600px at 20% -200px,
        color-mix(in oklab, oklch(var(--primary)) 18%, transparent),
        transparent 60%
      ),
      color-mix(in oklab, oklch(var(--popover)) 96%, black 4%);
    border-top: 1px solid
      color-mix(in oklab, oklch(var(--border)) 100%, transparent);
    box-shadow: 0 -30px 60px -20px rgba(0, 0, 0, 0.5);
    border-radius: 16px 16px 0 0;
    font-family: 'Space Mono', ui-monospace, SFMono-Regular, monospace;
    overflow: hidden;
    animation: slideUp 280ms cubic-bezier(0.18, 0.9, 0.24, 1);
  }
  @keyframes slideUp {
    from {
      transform: translateY(24px);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }
  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .topbar {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 16px;
    padding: 14px 22px;
    border-bottom: 1px dashed
      color-mix(in oklab, oklch(var(--border)) 90%, transparent);
    background: color-mix(in oklab, oklch(var(--popover)) 100%, transparent);
  }
  .brand {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 13px;
    letter-spacing: 0.04em;
  }
  .brand-mark {
    color: oklch(var(--primary));
    font-size: 14px;
  }
  .brand-title {
    font-weight: 700;
  }
  .brand-sub {
    color: oklch(var(--muted-foreground));
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .ctx {
    min-width: 0;
    max-width: 100%;
    flex-wrap: wrap;
    overflow-wrap: anywhere;
    justify-self: center;
    display: inline-flex;
    align-items: baseline;
    gap: 10px;
    padding: 4px 10px;
    border: 1px dashed color-mix(in oklab, oklch(var(--border)) 90%, transparent);
    border-radius: 999px;
    font-size: 11px;
    color: oklch(var(--muted-foreground));
  }
  .ctx-label {
    font-size: 9.5px;
    letter-spacing: 0.18em;
    color: color-mix(in oklab, oklch(var(--foreground)) 50%, transparent);
  }
  .ctx-sym {
    color: oklch(var(--foreground));
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .iconbtn {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: 1px solid color-mix(in oklab, oklch(var(--border)) 100%, transparent);
    border-radius: 4px;
    background: transparent;
    color: oklch(var(--muted-foreground));
    cursor: pointer;
    transition: all 120ms ease;
  }
  .iconbtn.close:hover {
    border-color: color-mix(in oklab, #ff7373 60%, transparent);
    color: #ff9c9c;
    background: color-mix(in oklab, #ff7373 12%, transparent);
  }

  .body {
    flex: 1 1 auto;
    min-height: 0;
    display: grid;
    overflow-y: auto;
    grid-template-rows: auto minmax(160px, 1fr) minmax(320px, 1.25fr);
  }
  .body.has-selection {
    grid-template-rows: auto auto minmax(160px, 1fr) minmax(320px, 1.25fr);
  }
  .selection-summary {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .chart-pane,
  .tabs-pane {
    min-height: 0;
    overflow: hidden;
  }
  .tabs-pane {
    border-top: 1px solid
      color-mix(in oklab, oklch(var(--border)) 100%, transparent);
  }
  .status {
    margin: auto;
    padding: 24px;
    color: oklch(var(--muted-foreground));
    font-size: 13px;
    letter-spacing: 0.06em;
  }
  .err {
    color: #ff9c9c;
  }

  :global(html:not(.dark)) .panel {
    background: #ffffff;
    border-top: 1px solid #000;
  }
  :global(html:not(.dark)) .topbar {
    background: #ffffff;
    border-bottom: 1px dashed #000;
  }
  :global(html:not(.dark)) .tabs-pane {
    border-top-color: #000;
  }
  :global(html:not(.dark)) .iconbtn {
    border-color: #000;
    color: #000;
  }

  @media (max-width: 900px) {
    .topbar { display: flex; flex-wrap: wrap; gap: 8px; padding: 10px 12px; }
    .brand { flex: 1 1 14rem; min-width: 0; flex-wrap: wrap; }
    .brand-sub { flex-basis: 100%; }
    .topbar .close { order: 1; margin-left: auto; }
    .ctx { order: 2; flex-basis: 100%; }
  }
</style>

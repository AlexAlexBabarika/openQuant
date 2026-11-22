<script lang="ts">
  import Plus from '@lucide/svelte/icons/plus';
  import X from '@lucide/svelte/icons/x';
  import type { CorrelationResponse } from '$lib/features/analytics/analyticsApi';
  import type { AnalyticsState } from '$lib/features/analytics/analyticsState.svelte';
  import SymbolSearchDialog from '../../dialogs/SymbolSearchDialog.svelte';

  let {
    data,
    analytics,
    loading = false,
  }: {
    data: CorrelationResponse;
    analytics: AnalyticsState;
    loading?: boolean;
  } = $props();

  let dialogOpen = $state(false);

  const benchmarks = $derived(analytics.correlationBenchmarks);
  // Map the benchmark → row value, preserving the user-ordered list.
  const rowsByBenchmark = $derived(
    new Map(data.rows.map(r => [r.benchmark.toUpperCase(), r.value])),
  );

  function colour(v: number): string {
    // -1 → red, 0 → muted, +1 → green. Interpolate via alpha on two hues.
    const c = Math.max(-1, Math.min(1, v));
    if (c >= 0) {
      const a = 0.10 + c * 0.70;
      return `color-mix(in oklab, #34d399 ${(a * 100).toFixed(0)}%, transparent)`;
    }
    const a = 0.10 + -c * 0.70;
    return `color-mix(in oklab, #ff7373 ${(a * 100).toFixed(0)}%, transparent)`;
  }

  function onAdd(symbol: string) {
    analytics.addBenchmark(symbol);
  }
</script>

<div class="corr">
  <div class="head">
    <span class="lbl">vs benchmark</span>
    <span class="self">{data.symbol}</span>
  </div>

  <div class="chips" aria-label="Correlation benchmarks">
    {#each benchmarks as bench (bench)}
      <span class="chip">
        <span class="chip-name">{bench}</span>
        <button
          type="button"
          class="chip-x"
          aria-label="Remove {bench}"
          title="remove"
          onclick={() => analytics.removeBenchmark(bench)}
        >
          <X class="h-2.5 w-2.5" />
        </button>
      </span>
    {/each}
    <button
      type="button"
      class="chip add"
      aria-label="Add benchmark"
      title="add benchmark"
      onclick={() => (dialogOpen = true)}
    >
      <Plus class="h-3 w-3" />
      <span class="add-lbl">add</span>
    </button>
  </div>

  {#if benchmarks.length === 0}
    <p class="empty">add a benchmark to compare.</p>
  {:else}
    <div class="grid">
      {#each benchmarks as bench (bench)}
        {@const value = rowsByBenchmark.get(bench)}
        <div
          class="cell"
          class:pending={value === undefined}
          style:background={value !== undefined ? colour(value) : undefined}
        >
          <span class="bench">{bench}</span>
          {#if value !== undefined}
            <span class="val" class:neg={value < 0}>{value.toFixed(2)}</span>
          {:else if loading}
            <span class="val pending-val" aria-hidden="true">…</span>
          {:else}
            <span class="val pending-val" aria-hidden="true">—</span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<SymbolSearchDialog
  open={dialogOpen}
  onopenchange={(o) => (dialogOpen = o)}
  mode="correlation"
  existingSymbols={benchmarks}
  onsubmit={(sym) => onAdd(sym)}
/>

<style>
  .corr {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
  }
  .lbl {
    font-size: var(--font-size-annotation);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: oklch(var(--foreground-tertiary));
  }
  .self {
    font-size: var(--font-size-label);
    font-weight: 600;
    letter-spacing: var(--tracking-label);
    color: oklch(var(--foreground));
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 4px 2px 7px;
    border: 1px solid
      oklch(var(--border));
    border-radius: 999px;
    font-size: var(--font-size-label);
    line-height: 1;
    letter-spacing: var(--tracking-label);
    color: oklch(var(--foreground));
    background: oklch(var(--surface-hover));
    font-family: inherit;
  }
  .chip-name {
    font-weight: 600;
  }
  .chip-x {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: color-mix(in oklab, oklch(var(--foreground)) 55%, transparent);
    cursor: pointer;
    transition:
      color var(--motion-fast),
      background var(--motion-fast);
  }
  .chip-x:hover {
    color: oklch(var(--status-error));
    background: oklch(var(--status-error-wash));
  }
  .chip.add {
    padding: 2px 8px 2px 6px;
    border-style: dashed;
    color: color-mix(in oklab, oklch(var(--foreground)) 65%, transparent);
    background: transparent;
    cursor: pointer;
    transition:
      color var(--motion-fast),
      border-color var(--motion-fast),
      background var(--motion-fast);
  }
  .chip.add:hover {
    color: oklch(var(--foreground));
    border-color: oklch(var(--border-strong));
    background: oklch(var(--surface-selected));
  }
  .add-lbl {
    font-size: var(--font-size-annotation);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
    gap: 6px;
  }
  .cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: 10px 6px;
    border: 1px solid
      oklch(var(--border));
    border-radius: var(--radius-md);
    font-variant-numeric: tabular-nums;
  }
  .cell.pending {
    border-style: dashed;
    background: oklch(var(--surface-hover));
  }
  .bench {
    font-size: var(--font-size-annotation);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: color-mix(in oklab, oklch(var(--foreground)) 60%, transparent);
  }
  .val {
    font-size: var(--font-size-body);
    font-weight: 600;
    color: oklch(var(--foreground));
  }
  .val.neg {
    color: oklch(var(--down-color));
  }
  .pending-val {
    color: oklch(var(--foreground-tertiary));
  }
  .empty {
    margin: 4px 0 0;
    font-size: var(--font-size-label);
    color: oklch(var(--muted-foreground));
  }

</style>

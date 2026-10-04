<!-- frontend/src/components/backtest/compare/CompareView.svelte -->
<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog';
  import type { CompareState } from '$lib/features/runs/compareState.svelte';
  import { truncateRunId } from '$lib/features/runs/format';
  import InputsDiff from './InputsDiff.svelte';
  import MetricsDiff from './MetricsDiff.svelte';
  import TradesDiff from './TradesDiff.svelte';
  import EquityOverlay from './EquityOverlay.svelte';
  import LineageView from './LineageView.svelte';

  let { open = $bindable(false), compare }: { open?: boolean; compare: CompareState } = $props();
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-4xl">
    <Dialog.Header>
      <Dialog.Title>
        Compare {compare.a ? truncateRunId(compare.a) : '—'} vs {compare.b ? truncateRunId(compare.b) : '—'}
      </Dialog.Title>
      <Dialog.Description>Recorded input differences explain what changed, not why performance changed. These are simulated results.</Dialog.Description>
    </Dialog.Header>

    {#if compare.loading}
      <p class="text-sm text-muted-foreground">Loading diff…</p>
    {:else if compare.error}
      <p class="text-sm text-destructive">{compare.error}</p>
    {:else if compare.diff}
      <div class="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span>A: engine {compare.diff.status.a.recorded}{compare.diff.status.a.stale ? ' · stale engine' : ''}</span>
        <span>B: engine {compare.diff.status.b.recorded}{compare.diff.status.b.stale ? ' ⚠ stale' : ''}</span>
      </div>
      <p class="text-sm">Changed inputs: {compare.diff.inputs_diff.length ? compare.diff.inputs_diff.map(row => row.path).join(', ') : 'none recorded'}. Engine A → B: {compare.diff.status.a.recorded} → {compare.diff.status.b.recorded}.</p>
      <LineageView lineage={compare.diff.lineage} />
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard scrolling for two-dimensional result tables) -->
      <div class="min-w-0 overflow-x-auto" tabindex="0" role="region" aria-label="Input, metric, and trade differences">
      <InputsDiff rows={compare.diff.inputs_diff} />
      <MetricsDiff rows={compare.diff.metrics_diff} />
      <EquityOverlay overlay={compare.diff.equity_overlay} />
      <TradesDiff trades={compare.diff.trades_diff} />
      </div>
    {/if}
  </Dialog.Content>
</Dialog.Root>

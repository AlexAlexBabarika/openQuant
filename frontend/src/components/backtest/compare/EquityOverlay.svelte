<!-- frontend/src/components/backtest/compare/EquityOverlay.svelte -->
<script lang="ts">
  import TimeSeriesChart from '../TimeSeriesChart.svelte';
  import type { EquityOverlay } from '$lib/features/runs/runTypes';
  import { equityComparisonLines, observedRange } from './presentation';

  let { overlay }: { overlay: EquityOverlay } = $props();
  const COLOR_R = '#94a3b8';

  const overlayLines = $derived(equityComparisonLines(overlay));
  const residualLines = $derived([{ data: overlay.residual, color: COLOR_R }]);
</script>

<section>
  <h3 class="mb-1 text-sm font-semibold">Equity paths — A solid · B dashed</h3>
  <p class="text-xs text-muted-foreground">A: {overlay.available?.a === false ? 'Unavailable' : observedRange(overlay.a)}</p>
  <p class="text-xs text-muted-foreground">B: {overlay.available?.b === false ? 'Unavailable' : observedRange(overlay.b)}</p>
  {#if overlay.a.length || overlay.b.length}<div class="h-48"><TimeSeriesChart lines={overlayLines} /></div>{/if}
  {#if overlay.alignment}
    <p class="text-xs text-muted-foreground">{overlay.alignment.common} shared timestamps · {overlay.alignment.only_a} only A · {overlay.alignment.only_b} only B. Full recorded paths are shown; residuals use shared timestamps only.</p>
  {:else}
    <p class="text-xs text-muted-foreground">Timestamp coverage is unavailable in this response.</p>
  {/if}
  <h4 class="mt-2 text-xs font-semibold text-muted-foreground">Residual (B − A)</h4>
  {#if overlay.residual.length}
    <div class="h-24"><TimeSeriesChart lines={residualLines} /></div>
  {:else}
    <p class="text-xs text-muted-foreground">Unavailable: no shared recorded equity points.</p>
  {/if}
</section>

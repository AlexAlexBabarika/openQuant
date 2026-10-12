<!-- frontend/src/components/backtest/compare/MetricsDiff.svelte -->
<script lang="ts">
  import type { MetricDiffRow } from '$lib/features/runs/runTypes';
  import { formatDelta } from '$lib/features/runs/format';
  import { categories, recordedValue } from './presentation';
  let { rows }: { rows: MetricDiffRow[] } = $props();
  const groups = $derived(categories(rows, 'Other observed metrics'));
</script>

<section>
  <h3 class="mb-1 text-sm font-semibold">Observed results</h3>
  <p class="mb-2 text-xs text-muted-foreground">B − A uses recorded units. A positive delta is not necessarily better. Differences do not establish which input caused a result.</p>
  <table class="w-full text-sm tabular-nums">
    <caption class="sr-only">Observed metrics, availability and numerical deltas for runs A and B</caption>
    <thead><tr class="text-muted-foreground"><th scope="col" class="text-left">Metric</th><th scope="col" class="text-right">A</th><th scope="col" class="text-right">B</th><th scope="col" class="text-right">Δ (B − A)</th></tr></thead>
    <tbody>
      {#each groups as group (group.label)}
        <tr class="border-b border-border bg-muted/30"><th colspan="4" scope="colgroup" class="p-1 text-left text-xs font-semibold">{group.label}</th></tr>
        {#each group.rows as r (r.metric)}
        <tr class="border-b border-border/50">
          <th scope="row" class="py-1 text-left font-normal" title={r.metric}>{r.label ?? r.metric}</th>
          <td class="max-w-64 break-words p-1 text-right font-mono">{recordedValue(r.a, r.available?.a)}</td>
          <td class="max-w-64 break-words p-1 text-right font-mono">{recordedValue(r.b, r.available?.b)}</td>
          <td class="p-1 text-right font-mono">{r.status === 'unavailable' || r.a == null || r.b == null ? 'Not comparable' : formatDelta(r.delta)}</td>
        </tr>
        {/each}
      {/each}
    </tbody>
  </table>
</section>

<!-- frontend/src/components/backtest/compare/InputsDiff.svelte -->
<script lang="ts">
  import type { InputsDiffRow } from '$lib/features/runs/runTypes';
  import { recordedValue } from './presentation';
  let { rows }: { rows: InputsDiffRow[] } = $props();
</script>

<section>
  <h3 class="mb-1 text-sm font-semibold">Recorded input differences</h3>
  {#if rows.length === 0}
    <p class="text-sm text-muted-foreground">No differing recorded values. Missing context is unavailable, not unchanged.</p>
  {:else}
    <table class="w-full text-sm">
      <caption class="sr-only">Differing recorded inputs for runs A and B</caption>
      <thead><tr class="text-left text-muted-foreground"><th scope="col">Input</th><th scope="col">A</th><th scope="col">B</th><th scope="col">Comparison</th></tr></thead>
      <tbody>
        {#each rows as r (r.path)}
          <tr class="border-b border-border/50">
            <th scope="row" class="py-1 text-left font-mono font-normal">{r.path}</th>
            <td class="max-w-64 break-words p-1 font-mono text-muted-foreground">{recordedValue(r.a, r.available?.a)}</td>
            <td class="max-w-64 break-words p-1 font-mono">{recordedValue(r.b, r.available?.b)}</td>
            <td class="p-1">{r.status === 'unavailable' || r.a == null || r.b == null ? 'Not comparable' : 'Changed'}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>

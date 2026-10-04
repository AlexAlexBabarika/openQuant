<script lang="ts">
  import type { RunLineage, LineageCell } from '$lib/features/runs/runTypes';

  let { lineage }: { lineage?: RunLineage } = $props();
  const changed = $derived(lineage?.rows.filter(row => row.status === 'changed').length ?? 0);
  const unavailable = $derived(lineage?.rows.filter(row => row.status === 'unavailable').length ?? 0);
  const changedLabels = $derived(lineage?.rows.filter(row => row.status === 'changed').map(row => row.label).join(', '));
</script>

{#snippet value(cell: LineageCell)}
  {#if !cell.available}
    <span class="text-muted-foreground">Unavailable</span>
  {:else if cell.value === null}
    <span class="text-muted-foreground">None (recorded)</span>
  {:else if typeof cell.value === 'object'}
    <details>
      <summary class="cursor-pointer rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">View recorded value</summary>
      <pre class="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-xs">{JSON.stringify(cell.value, null, 2)}</pre>
    </details>
  {:else}
    <span class="break-all font-mono">{typeof cell.value === 'string' ? cell.value : JSON.stringify(cell.value)}</span>
  {/if}
{/snippet}

<section aria-label="Experiment lineage" class="min-w-0 space-y-3 rounded border border-border p-3">
  <h3 class="text-sm font-semibold">What changed?</h3>
  {#if lineage}
    <p class="text-sm">{changed} changed · {unavailable} with unavailable inputs. Matching recorded values do not prove reproducibility or explain performance differences.</p>
    <p class="text-sm">Changed recorded inputs: {changedLabels || 'none among comparable inputs'}.</p>
    <details>
      <summary class="cursor-pointer rounded text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Inspect all recorded inputs (A → B)</summary>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard scrolling for a two-dimensional comparison table) -->
      <div class="mt-2 overflow-x-auto" tabindex="0" role="region" aria-label="Recorded lineage inputs">
        <table class="w-full min-w-[34rem] text-left text-xs">
          <caption class="sr-only">Recorded inputs and their availability for runs A and B</caption>
          <thead><tr class="border-b border-border"><th scope="col" class="p-2">Input</th><th scope="col" class="p-2">A</th><th scope="col" class="p-2">B</th><th scope="col" class="p-2">Comparison</th></tr></thead>
          <tbody>
            {#each lineage.rows as row (row.path)}
              <tr class="border-b border-border/50 align-top">
                <th scope="row" class="p-2 font-normal">{row.label}</th>
                <td class="max-w-64 p-2">{@render value(row.a)}</td>
                <td class="max-w-64 p-2">{@render value(row.b)}</td>
                <td class="p-2">{row.status === 'unavailable' ? 'Not comparable' : row.status === 'changed' ? 'Changed' : 'Same recorded value'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </details>
    {#each ['a', 'b'] as run}
      {#if lineage.limitations[run as 'a' | 'b'].length}
        <div class="space-y-1 text-xs">
          <h4 class="font-semibold">Run {run.toUpperCase()} — replay limits</h4>
          <ul class="list-disc space-y-1 pl-4 text-muted-foreground">
            {#each lineage.limitations[run as 'a' | 'b'] as warning}<li>{warning}</li>{/each}
          </ul>
        </div>
      {/if}
    {/each}
  {:else}
    <p class="text-sm text-muted-foreground">Lineage is unavailable in this comparison response. Numerical differences remain available below.</p>
  {/if}
  <p class="text-xs text-muted-foreground">A run ID or hash is not proof of reproducibility. Source-file hashes include formatting; AST fingerprints ignore formatting, comments and docstrings. Resolved parameters do not distinguish defaults from overrides. A stored bar count is not a data-integrity check.</p>
  <p class="text-xs text-muted-foreground">Rerun uses stored bars and the current engine, not a fresh provider fetch. Original provider state, adjustment policies and runtime/dependency versions are not preserved by these snapshots; exact historical reproduction is not guaranteed.</p>
</section>

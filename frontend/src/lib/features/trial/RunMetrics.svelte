<script lang="ts">
  import type { RunSummary } from '$lib/features/trial-report/types';
  import { formatMoney, formatPercent } from './evidence';

  let { runs, caption }: { runs: { label: string; summary: RunSummary }[]; caption: string } = $props();
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard access to horizontal scrolling.) -->
<div class="table-scroll" tabindex="0" role="region" aria-label={caption}>
  <table>
    <caption>{caption}</caption>
    <thead><tr><th scope="col">Measured result</th>{#each runs as run}<th scope="col">{run.label}</th>{/each}</tr></thead>
    <tbody>
      <tr><th scope="row">Total return</th>{#each runs as run}<td>{formatPercent(run.summary.total_return, true)}</td>{/each}</tr>
      <tr><th scope="row">Max drawdown</th>{#each runs as run}<td>{formatPercent(run.summary.max_drawdown)}</td>{/each}</tr>
      <tr><th scope="row">Completed round trips</th>{#each runs as run}<td>{run.summary.trade_count.toLocaleString('en-US')}</td>{/each}</tr>
      <tr><th scope="row">Total costs</th>{#each runs as run}<td>{formatMoney(run.summary.total_cost)}</td>{/each}</tr>
    </tbody>
  </table>
</div>

<style>
  .table-scroll { overflow-x: auto; border: 1px solid oklch(var(--border)); border-radius: 4px; }
  .table-scroll:focus-visible { outline: 2px solid oklch(var(--primary)); outline-offset: 4px; }
  table { width: 100%; border-collapse: collapse; text-align: right; color: oklch(var(--foreground)); font-size: 0.8rem; }
  caption { padding: 1rem; text-align: left; color: oklch(var(--muted-foreground)); background: oklch(var(--muted)); font-size: 0.75rem; }
  th, td { padding: 1rem; border-top: 1px solid oklch(var(--border)); white-space: nowrap; }
  th { font-weight: normal; color: oklch(var(--muted-foreground)); }
  th:first-child { text-align: left; }
  thead th { font-size: 0.7rem; }
  td { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
  tbody tr:nth-child(odd) { background: oklch(var(--muted) / 0.5); }
  @media (max-width: 600px) { th, td { padding: 0.8rem; } }
</style>

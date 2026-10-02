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
      <tr><th scope="row">Trades</th>{#each runs as run}<td>{run.summary.trade_count.toLocaleString('en-US')}</td>{/each}</tr>
      <tr><th scope="row">Total costs</th>{#each runs as run}<td>{formatMoney(run.summary.total_cost)}</td>{/each}</tr>
    </tbody>
  </table>
</div>

<style>
  .table-scroll { overflow-x: auto; border: 1px solid #343934; border-radius: 4px; }
  .table-scroll:focus-visible { outline: 2px solid #efad78; outline-offset: 4px; }
  table { width: 100%; border-collapse: collapse; text-align: right; color: #eeeae1; font-size: 0.8rem; }
  caption { padding: 1rem; text-align: left; color: #c2c7be; background: #181e1a; font-size: 0.75rem; }
  th, td { padding: 1rem; border-top: 1px solid #303630; white-space: nowrap; }
  th { font-weight: normal; color: #bcc3b8; }
  th:first-child { text-align: left; }
  thead th { font-size: 0.7rem; }
  td { font-family: 'Space Mono', monospace; font-variant-numeric: tabular-nums; }
  tbody tr:nth-child(odd) { background: #171c18; }
  @media (max-width: 600px) { th, td { padding: 0.8rem; } }
</style>

<script lang="ts">
  import TimeSeriesChart from '../TimeSeriesChart.svelte';
  import { topDrawdowns, underwaterSeries } from '$lib/features/backtest/derive';
  import { formatPct, formatUnixDate, formatInt } from '$lib/features/backtest/format';
  import type { BacktestResult } from '$lib/features/backtest/types';
  import type { BacktestState } from '$lib/features/backtest/backtestState.svelte';

  let { result, backtest }: { result: BacktestResult; backtest: BacktestState } = $props();

  const down = '--down-color';
  const underwater = $derived(underwaterSeries(result.equity));
  const top = $derived(topDrawdowns(result.equity, 10));
</script>

<div class="drawdown">
  <div class="chart">
    <TimeSeriesChart lines={[{ data: underwater, color: down, lineWidth: 1 }]} percent />
  </div>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th class="num">#</th>
          <th>Start</th>
          <th>Trough</th>
          <th>Recovery</th>
          <th class="num">Depth</th>
          <th class="num">Length</th>
        </tr>
      </thead>
      <tbody>
        {#each top as dd, i (dd.start)}
          <tr>
            <td class="num"><button type="button" class="ot-workbench-ghost" aria-label={`Focus drawdown ${i + 1} on result chart`} aria-pressed={backtest.selection?.kind === 'drawdown' && backtest.selection.index === i} onclick={() => backtest.selectDrawdown(dd, i)}>#{i + 1} ↗</button></td>
            <td>{formatUnixDate(dd.start)}</td>
            <td>{formatUnixDate(dd.trough)}</td>
            <td>{dd.recovery == null ? 'ongoing' : formatUnixDate(dd.recovery)}</td>
            <td class="num neg">{formatPct(dd.depth)}</td>
            <td class="num">{formatInt(dd.length)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style>
  .drawdown {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(100px, 1fr) minmax(140px, 0.6fr);
    height: 100%;
    min-height: 0;
  }
  .chart {
    min-width: 0;
    min-height: 0;
  }
  .table-wrap {
    min-width: 0;
    min-height: 0;
    overflow: auto;
    border-top: 1px solid
      color-mix(in oklab, oklch(var(--border)) 100%, transparent);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  th {
    position: sticky;
    top: 0;
    text-align: left;
    padding: 7px 12px;
    font-size: 9.5px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: oklch(var(--muted-foreground));
    background: color-mix(in oklab, oklch(var(--popover)) 100%, black 6%);
    border-bottom: 1px dashed
      color-mix(in oklab, oklch(var(--border)) 90%, transparent);
  }
  td {
    padding: 6px 12px;
    color: oklch(var(--foreground));
    border-bottom: 1px solid
      color-mix(in oklab, oklch(var(--border)) 60%, transparent);
    font-variant-numeric: tabular-nums;
  }
  .num {
    text-align: right;
  }
  th.num {
    text-align: right;
  }
  .neg {
    color: oklch(var(--down-color));
  }

</style>

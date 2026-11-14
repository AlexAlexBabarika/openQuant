<script lang="ts">
  import { monthlyReturnsGrid } from '$lib/features/backtest/derive';
  import { formatPct, monthName } from '$lib/features/backtest/format';
  import type { BacktestResult } from '$lib/features/backtest/types';

  let { result }: { result: BacktestResult } = $props();

  const grid = $derived(monthlyReturnsGrid(result.equity));
  const months = Array.from({ length: 12 }, (_, i) => i);

  const maxAbs = $derived.by(() => {
    let m = 0;
    for (const y of grid.years) {
      for (const c of grid.cells[y]) {
        if (c != null) m = Math.max(m, Math.abs(c));
      }
      const total = grid.yearTotals[y];
      if (total != null) m = Math.max(m, Math.abs(total));
    }
    return m || 1;
  });

  function cellStyle(v: number | null): string {
    if (v == null) return '';
    const t = Math.min(1, Math.abs(v) / maxAbs);
    const base = v >= 0 ? '--up-color' : '--down-color';
    const pct = Math.round(10 + t * 65);
    return `background: color-mix(in oklab, oklch(var(${base})) ${pct}%, transparent)`;
  }
</script>

<div class="monthly">
  <table>
    <thead>
      <tr>
        <th class="year-head">Year</th>
        {#each months as m (m)}
          <th>{monthName(m)}</th>
        {/each}
        <th class="total-head">YTD</th>
      </tr>
    </thead>
    <tbody>
      {#each grid.years as y (y)}
        <tr>
          <th class="year-cell">{y}</th>
          {#each months as m (m)}
            {@const v = grid.cells[y][m]}
            <td style={cellStyle(v)}>{v == null ? '' : formatPct(v, 1)}</td>
          {/each}
          <td class="total" style={cellStyle(grid.yearTotals[y] ?? null)}>
            {grid.yearTotals[y] == null ? '' : formatPct(grid.yearTotals[y], 1)}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .monthly {
    height: 100%;
    overflow: auto;
    padding: 16px;
  }
  table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 2px;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  th {
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: oklch(var(--muted-foreground));
    font-weight: 600;
    padding: 4px 6px;
    text-align: center;
  }
  .year-head,
  .year-cell {
    text-align: left;
  }
  .year-cell {
    color: oklch(var(--foreground));
    font-size: 11px;
  }
  td {
    text-align: center;
    padding: 6px 6px;
    border-radius: 3px;
    color: oklch(var(--foreground));
    min-width: 44px;
  }
  .total {
    font-weight: 600;
  }
  .total-head {
    color: oklch(var(--foreground));
  }
</style>

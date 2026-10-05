<script lang="ts">
  import type { BacktestState } from '$lib/features/backtest/backtestState.svelte';
  import type { BacktestResult } from '$lib/features/backtest/types';
  import {
    formatIsoDate,
    formatInt,
    formatNumber,
    formatPct,
    formatSignedCurrency,
  } from '$lib/features/backtest/format';

  let {
    result,
    backtest,
  }: {
    result: BacktestResult;
    backtest: BacktestState;
  } = $props();

  type SortKey =
    | 'idx'
    | 'entry_time'
    | 'side'
    | 'quantity'
    | 'pnl'
    | 'pnl_pct'
    | 'bars_held';

  interface Row {
    idx: number;
    entry_time: string;
    exit_time: string;
    side: string;
    quantity: number;
    entry_price: number;
    exit_price: number;
    pnl: number;
    pnl_pct: number;
    bars_held: number;
  }

  let sortKey = $state<SortKey>('idx');
  let sortDir = $state<1 | -1>(1);

  const rows = $derived.by<Row[]>(() => {
    const base: Row[] = result.trades.map((t, i) => ({
      idx: i,
      entry_time: t.entry_time,
      exit_time: t.exit_time,
      side: t.direction,
      quantity: t.quantity,
      entry_price: t.entry_price,
      exit_price: t.exit_price,
      pnl: t.pnl,
      pnl_pct: t.pnl_pct,
      bars_held: t.bars_held,
    }));
    const dir = sortDir;
    const key = sortKey;
    const valueOf = (r: Row): string | number => r[key];
    return base.sort((a, b) => {
      const av = valueOf(a);
      const bv = valueOf(b);
      if (typeof av === 'string' && typeof bv === 'string') {
        return av.localeCompare(bv) * dir;
      }
      return ((av as number) - (bv as number)) * dir;
    });
  });

  function setSort(key: SortKey): void {
    if (sortKey === key) sortDir = (sortDir * -1) as 1 | -1;
    else {
      sortKey = key;
      sortDir = 1;
    }
  }

  function indicator(key: SortKey): string {
    if (sortKey !== key) return '';
    return sortDir === 1 ? ' ↑' : ' ↓';
  }

  // Scroll the row hovered from the chart into view.
  let rowEls = $state<HTMLTableRowElement[]>([]);
  $effect(() => {
    const i = backtest.hoveredTrade;
    if (i == null) return;
    rowEls[i]?.scrollIntoView({ block: 'nearest' });
  });
</script>

<div class="trades">
  <table>
    <thead>
      <tr>
        <th class="num" aria-sort={sortKey === 'idx' ? (sortDir === 1 ? 'ascending' : 'descending') : 'none'}><button type="button" onclick={() => setSort('idx')}>#{indicator('idx')}</button></th>
        <th aria-sort={sortKey === 'entry_time' ? (sortDir === 1 ? 'ascending' : 'descending') : 'none'}><button type="button" onclick={() => setSort('entry_time')}>Entry{indicator('entry_time')}</button></th>
        <th>Exit</th>
        <th aria-sort={sortKey === 'side' ? (sortDir === 1 ? 'ascending' : 'descending') : 'none'}><button type="button" onclick={() => setSort('side')}>Side{indicator('side')}</button></th>
        <th class="num" aria-sort={sortKey === 'quantity' ? (sortDir === 1 ? 'ascending' : 'descending') : 'none'}><button type="button" onclick={() => setSort('quantity')}>Size{indicator('quantity')}</button></th>
        <th class="num">Entry px</th>
        <th class="num">Exit px</th>
        <th class="num" aria-sort={sortKey === 'pnl' ? (sortDir === 1 ? 'ascending' : 'descending') : 'none'}><button type="button" onclick={() => setSort('pnl')}>P&amp;L{indicator('pnl')}</button></th>
        <th class="num" aria-sort={sortKey === 'pnl_pct' ? (sortDir === 1 ? 'ascending' : 'descending') : 'none'}><button type="button" onclick={() => setSort('pnl_pct')}>P&amp;L %{indicator('pnl_pct')}</button></th>
        <th class="num" aria-sort={sortKey === 'bars_held' ? (sortDir === 1 ? 'ascending' : 'descending') : 'none'}><button type="button" onclick={() => setSort('bars_held')}>Bars{indicator('bars_held')}</button></th>
      </tr>
    </thead>
    <tbody>
      {#each rows as r (r.idx)}
        <tr
          bind:this={rowEls[r.idx]}
          class:active={backtest.hoveredTrade === r.idx || (backtest.selection?.kind === 'trade' && backtest.selection.index === r.idx)}
          onmouseenter={() => backtest.hoverTrade(r.idx)}
          onmouseleave={() => backtest.hoverTrade(null)}
        >
          <td class="num"><button type="button" class="ot-workbench-ghost" aria-label={`Focus trade ${r.idx + 1} on result chart`} aria-pressed={backtest.selection?.kind === 'trade' && backtest.selection.index === r.idx} onclick={() => backtest.selectTrade(r.idx)}>#{r.idx + 1} ↗</button></td>
          <td>{formatIsoDate(r.entry_time)}</td>
          <td>{formatIsoDate(r.exit_time)}</td>
          <td class="side {r.side}">{r.side}</td>
          <td class="num">{formatNumber(r.quantity, 0)}</td>
          <td class="num">{formatNumber(r.entry_price)}</td>
          <td class="num">{formatNumber(r.exit_price)}</td>
          <td class="num" class:pos={r.pnl > 0} class:neg={r.pnl < 0}>
            {formatSignedCurrency(r.pnl)}
          </td>
          <td class="num" class:pos={r.pnl_pct > 0} class:neg={r.pnl_pct < 0}>
            {formatPct(r.pnl_pct)}
          </td>
          <td class="num">{formatInt(r.bars_held)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .trades {
    height: 100%;
    overflow: auto;
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
    padding: 8px 12px;
    font-size: 9.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: oklch(var(--muted-foreground));
    background: color-mix(in oklab, oklch(var(--popover)) 100%, black 6%);
    border-bottom: 1px dashed
      color-mix(in oklab, oklch(var(--border)) 90%, transparent);
    user-select: none;
    white-space: nowrap;
  }
  th button {
    border: 0;
    padding: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    cursor: pointer;
  }
  th button:focus-visible {
    outline: 2px solid oklch(var(--foreground));
    outline-offset: 2px;
  }
  @media (forced-colors: active) {
    th button:focus-visible { outline-color: Highlight; }
  }
  td {
    padding: 6px 12px;
    color: oklch(var(--foreground));
    border-bottom: 1px solid
      color-mix(in oklab, oklch(var(--border)) 55%, transparent);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  tbody tr {
    transition: background 90ms ease;
  }
  tbody tr:hover,
  tbody tr.active {
    background: color-mix(in oklab, oklch(var(--primary)) 12%, transparent);
  }
  .num {
    text-align: right;
  }
  .side {
    text-transform: uppercase;
    font-size: 10.5px;
    letter-spacing: 0.06em;
  }
  .side.buy {
    color: oklch(var(--up-color));
  }
  .side.sell {
    color: oklch(var(--down-color));
  }
  .pos {
    color: oklch(var(--up-color));
  }
  .neg {
    color: oklch(var(--down-color));
  }

</style>

<script lang="ts">
  import { buildHoldings } from '$lib/features/portfolio/holdings';
  import type { PortfolioResult } from '$lib/features/portfolio/types';

  let { result }: { result: PortfolioResult } = $props();

  const rows = $derived(buildHoldings(result));
  const maxAbsWeight = $derived(
    Math.max(0.0001, ...rows.map(r => Math.abs(r.weight))),
  );

  const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
  const money = (x: number) =>
    `${x < 0 ? '−' : ''}$${Math.abs(x).toFixed(2)}`;
</script>

<div class="holdings">
  <table>
    <thead>
      <tr>
        <th class="left">symbol</th>
        <th class="left">weight</th>
        <th class="right">final wt</th>
        <th class="right">p&amp;l</th>
        <th class="right">sharpe</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as row (row.symbol)}
        <tr class:closed={row.weight === 0}>
          <td class="left sym">{row.symbol}</td>
          <td class="left bar-cell">
            <span class="bar-track">
              <span
                class="bar"
                class:short={row.weight < 0}
                style={`width:${(Math.abs(row.weight) / maxAbsWeight) * 100}%`}
              ></span>
            </span>
          </td>
          <td class="right">{row.weight === 0 ? '—' : pct(row.weight)}</td>
          <td class="right" class:neg={row.pnl < 0} class:pos={row.pnl > 0}>
            {money(row.pnl)}
          </td>
          <td class="right dim">
            {row.sharpe === null ? '—' : row.sharpe.toFixed(2)}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .holdings {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  th {
    padding: 4px 10px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: oklch(var(--muted-foreground));
    border-bottom: 1px dashed
      color-mix(in oklab, oklch(var(--border)) 90%, transparent);
  }
  td {
    padding: 5px 10px;
    border-bottom: 1px solid
      color-mix(in oklab, oklch(var(--border)) 40%, transparent);
  }
  .left { text-align: left; }
  .right { text-align: right; font-variant-numeric: tabular-nums; }
  .sym { font-weight: 600; letter-spacing: 0.06em; }
  tr.closed .sym { color: oklch(var(--muted-foreground)); }
  .dim { color: oklch(var(--muted-foreground)); }
  .pos { color: oklch(var(--up-color)); }
  .neg { color: oklch(var(--down-color)); }

  .bar-cell { width: 34%; min-width: 120px; }
  .bar-track {
    display: block;
    height: 8px;
    border-radius: 2px;
    background: color-mix(in oklab, oklch(var(--foreground)) 6%, transparent);
    overflow: hidden;
  }
  .bar {
    display: block;
    height: 100%;
    background: oklch(var(--up-color));
    border-radius: 2px;
  }
  .bar.short { background: oklch(var(--down-color)); }

  :global(html:not(.dark)) th { border-bottom-color: oklch(var(--foreground)); }
</style>

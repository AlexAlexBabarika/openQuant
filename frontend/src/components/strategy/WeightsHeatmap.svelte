<script lang="ts">
  import { buildHeatmap } from '$lib/features/portfolio/heatmap';
  import type { PortfolioEquityPoint } from '$lib/features/portfolio/types';

  let { equity }: { equity: PortfolioEquityPoint[] } = $props();

  const data = $derived(buildHeatmap(equity));
  const cols = $derived(data.times.length);

  function fill(weight: number): string {
    if (weight === 0 || data.maxAbs === 0) return 'transparent';
    const alpha = Math.min(1, Math.abs(weight) / data.maxAbs);
    return weight > 0
      ? `rgba(34, 197, 94, ${alpha.toFixed(3)})`
      : `rgba(239, 68, 68, ${alpha.toFixed(3)})`;
  }

  function fmtDate(t: number): string {
    return new Date(t * 1000).toISOString().slice(0, 10);
  }

  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
</script>

{#if data.symbols.length > 0}
  <div class="heatmap">
    <div class="grid">
      <div class="labels">
        {#each data.symbols as symbol (symbol)}
          <span class="label">{symbol}</span>
        {/each}
      </div>
      <svg
        viewBox={`0 0 ${cols} ${data.symbols.length}`}
        preserveAspectRatio="none"
        style={`height: ${data.symbols.length * 16}px`}
        role="img"
        aria-label="Portfolio weights over time"
      >
        {#each data.rows as row, y (data.symbols[y])}
          {#each row as weight, x (x)}
            {#if weight !== 0}
              <rect {x} {y} width="1" height="1" fill={fill(weight)}>
                <title>
                  {data.symbols[y]} · {fmtDate(data.times[x])} · {pct(weight)}
                </title>
              </rect>
            {/if}
          {/each}
        {/each}
      </svg>
    </div>
    <div class="axis">
      <span>{fmtDate(data.times[0])}</span>
      <span class="legend">
        <span class="swatch long"></span>long
        <span class="swatch short"></span>short
      </span>
      <span>{fmtDate(data.times[cols - 1])}</span>
    </div>
  </div>
{/if}

<style>
  .heatmap {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .grid {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0 8px;
    align-items: stretch;
  }
  .labels {
    display: flex;
    flex-direction: column;
  }
  .label {
    height: 16px;
    line-height: 16px;
    font-size: var(--font-size-annotation);
    font-weight: 600;
    letter-spacing: var(--tracking-label);
    text-align: right;
    color: oklch(var(--muted-foreground));
  }
  svg {
    width: 100%;
    display: block;
    border: 1px solid color-mix(in oklab, oklch(var(--border)) 60%, transparent);
    border-radius: var(--radius-sm);
    background: oklch(var(--surface-sunken));
  }
  .axis {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: var(--font-size-annotation);
    letter-spacing: var(--tracking-label);
    color: oklch(var(--muted-foreground));
  }
  .legend {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .swatch {
    display: inline-block;
    width: 9px;
    height: 9px;
    border-radius: var(--radius-sm);
  }
  .swatch.long { background: rgba(34, 197, 94, 0.85); }
  .swatch.short { background: rgba(239, 68, 68, 0.85); }
  .swatch.short { margin-left: 8px; }

  :global(html:not(.dark)) svg {
    background: oklch(var(--card));
    border-color: oklch(var(--foreground));
  }
</style>

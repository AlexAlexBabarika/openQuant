<script lang="ts">
  import type { BacktestMetrics } from '$lib/features/backtest/types';
  import {
    HEADLINE_METRICS,
    formatMetric,
    metricSign,
  } from '$lib/features/backtest/metricDefs';

  let { metrics }: { metrics: BacktestMetrics } = $props();
</script>

<div class="strip">
  {#each HEADLINE_METRICS as m (m.key)}
    {@const v = metrics[m.key] as number | null}
    {@const sign = metricSign(m, v)}
    <div class="cell">
      <span class="label">{m.label}</span>
      <span class="value" class:pos={sign === 'pos'} class:neg={sign === 'neg'}>
        {formatMetric(m.kind, v)}
      </span>
    </div>
  {/each}
</div>

<style>
  .strip {
    display: grid;
    grid-template-columns: repeat(8, minmax(0, 1fr));
    gap: 1px;
    background: color-mix(in oklab, oklch(var(--border)) 90%, transparent);
    border-bottom: 1px solid
      color-mix(in oklab, oklch(var(--border)) 100%, transparent);
  }
  .cell {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px 14px;
    background: color-mix(in oklab, oklch(var(--popover)) 100%, black 4%);
  }
  .label {
    font-size: 9.5px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: oklch(var(--muted-foreground));
  }
  .value {
    font-size: 19px;
    font-weight: 700;
    color: oklch(var(--foreground));
    font-variant-numeric: tabular-nums;
  }
  .value.pos {
    color: oklch(var(--up-color));
  }
  .value.neg {
    color: oklch(var(--down-color));
  }

  @media (max-width: 1100px) {
    .strip {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }
  @media (max-width: 560px) {
    .strip {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @container (max-width: 800px) { .strip { grid-template-columns: repeat(4, minmax(0, 1fr)); } .cell { padding: 10px; } .value { font-size: 16px; } }
  @container (max-width: 440px) { .strip { grid-template-columns: repeat(2, minmax(0, 1fr)); } }

  :global(html:not(.dark)) .strip {
    background: #000;
    border-bottom-color: #000;
  }
  :global(html:not(.dark)) .cell {
    background: #ffffff;
  }
</style>

<script lang="ts">
  import type { VolatilityClusteringResponse } from '$lib/features/analytics/analyticsApi';

  let { data }: { data: VolatilityClusteringResponse } = $props();

  function pval(v: number): string {
    if (!Number.isFinite(v)) return '—';
    if (v < 1e-4) return v.toExponential(1);
    return v.toFixed(4);
  }

  const significant = $derived(data.p_value < 0.05);
</script>

<div class="vc">
  <div class="row">
    <span class="lbl">Q (lag {data.lag})</span>
    <span class="val">{data.q.toFixed(2)}</span>
  </div>
  <div class="row">
    <span class="lbl">p-value</span>
    <span class="val" class:sig={significant}>{pval(data.p_value)}</span>
  </div>
  <p class="note">
    {#if significant}
      clustering present (reject H₀)
    {:else}
      no clustering detected
    {/if}
  </p>
</div>

<style>
  .vc {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .row {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }
  .lbl {
    width: 88px;
    font-size: var(--font-size-annotation);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: oklch(var(--foreground-tertiary));
  }
  .val {
    font-size: var(--font-size-body);
    font-weight: 600;
    color: oklch(var(--foreground));
    font-variant-numeric: tabular-nums;
  }
  .val.sig {
    color: oklch(var(--status-warn));
  }
  .note {
    margin: 6px 0 0;
    font-size: var(--font-size-label);
    line-height: 1.4;
    color: oklch(var(--foreground-tertiary));
  }
</style>

<script lang="ts">
  import type { ScalarMetricResponse } from '$lib/features/analytics/analyticsApi';

  let { data }: { data: ScalarMetricResponse } = $props();

  function fmt(v: number): string {
    if (!Number.isFinite(v)) return '—';
    const abs = Math.abs(v);
    if (abs === 0) return '0';
    if (abs >= 1000 || abs < 0.001) return v.toExponential(2);
    if (abs >= 10) return v.toFixed(2);
    if (abs >= 1) return v.toFixed(3);
    return v.toFixed(4);
  }
</script>

<div class="scalar">
  <span class="value" class:neg={data.value < 0}>{fmt(data.value)}</span>
  <span class="n">n = {data.n}</span>
</div>

<style>
  .scalar {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }
  .value {
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: oklch(var(--foreground));
    font-variant-numeric: tabular-nums;
  }
  .value.neg {
    color: oklch(var(--down-color));
  }
  .n {
    font-size: 11px;
    letter-spacing: 0.06em;
    color: color-mix(in oklab, oklch(var(--foreground)) 45%, transparent);
  }
</style>

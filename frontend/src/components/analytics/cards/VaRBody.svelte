<script lang="ts">
  import type { VaRResponse } from '$lib/features/analytics/analyticsApi';

  let { data }: { data: VaRResponse } = $props();

  function pct(v: number): string {
    if (!Number.isFinite(v)) return '—';
    return `${(v * 100).toFixed(2)}%`;
  }
</script>

<div class="var">
  <div class="row">
    <span class="lvl">95%</span>
    <span class="val" class:neg={data.var_95 < 0}>{pct(data.var_95)}</span>
  </div>
  <div class="row">
    <span class="lvl">99%</span>
    <span class="val" class:neg={data.var_99 < 0}>{pct(data.var_99)}</span>
  </div>
  <span class="n">n = {data.n}</span>
</div>

<style>
  .var {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .row {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }
  .lvl {
    width: 36px;
    font-size: var(--font-size-annotation);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: oklch(var(--foreground-tertiary));
  }
  .val {
    font-size: var(--font-size-title);
    font-weight: 600;
    color: oklch(var(--foreground));
    font-variant-numeric: tabular-nums;
  }
  .val.neg {
    color: oklch(var(--down-color));
  }
  .n {
    margin-top: 4px;
    font-size: var(--font-size-label);
    letter-spacing: var(--tracking-label);
    color: oklch(var(--foreground-tertiary));
  }
</style>

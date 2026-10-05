<script lang="ts">
  import TimeSeriesChart from '../TimeSeriesChart.svelte';
  import { benchmarkCurve, underwaterSeries } from '$lib/features/backtest/derive';
  import { LineStyle } from 'lightweight-charts';
  import type { BacktestResult } from '$lib/features/backtest/types';

  let { result }: { result: BacktestResult } = $props();

  const primary = '--chart-1';
  const muted = '--chart-2';
  const down = '--down-color';

  const start = $derived(result.equity[0]?.value ?? 0);
  const equityLine = $derived(
    result.equity.map(p => ({ t: p.t, value: p.value })),
  );
  const benchLine = $derived(benchmarkCurve(result.bars, start));
  const underwater = $derived(underwaterSeries(result.equity));
</script>

<div class="equity">
  <div class="legend">
    <span class="key"><i class="swatch" style="background:oklch(var({primary}))"></i>Strategy</span>
    <span class="key"><i class="swatch benchmark" style="border-color:oklch(var({muted}))"></i>Buy &amp; hold</span>
  </div>
  <div class="main">
    <TimeSeriesChart
      lines={[
        { data: equityLine, color: primary, lineWidth: 2 },
        { data: benchLine, color: muted, lineWidth: 1, lineStyle: LineStyle.Dashed },
      ]}
    />
  </div>
  <div class="sub-label">Drawdown</div>
  <div class="sub">
    <TimeSeriesChart lines={[{ data: underwater, color: down, lineWidth: 1 }]} percent />
  </div>
</div>

<style>
  .equity {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto 1fr auto 0.4fr;
    height: 100%;
    min-height: 0;
  }
  .legend {
    display: flex;
    gap: 18px;
    padding: 8px 14px;
    font-size: 12px;
    color: oklch(var(--muted-foreground));
  }
  .key {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .swatch {
    width: 12px;
    height: 3px;
    border-radius: 2px;
  }
  .benchmark {
    background: none;
    border-top: 2px dashed;
    height: 0;
  }
  .main,
  .sub {
    min-width: 0;
    min-height: 0;
  }
  .sub-label {
    padding: 4px 14px 0;
    font-size: 9.5px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: oklch(var(--muted-foreground));
  }
</style>

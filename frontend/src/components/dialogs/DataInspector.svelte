<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog';
  import type { ChartController } from '$lib/features/chart/chartController.svelte';
  import { inspectCandles, utcTime } from '$lib/features/market/dataInspection';
  let { open = $bindable(false), chart }: { open?: boolean; chart: ChartController } = $props();
  const inspection = $derived(open ? inspectCandles(chart.candles, chart.loadedContext?.interval ?? chart.interval) : null);
</script>
<Dialog.Root bind:open>
  <Dialog.Content portalProps={{ disabled: typeof window === 'undefined' }} class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
    <Dialog.Header>
      <Dialog.Title>Data inspector</Dialog.Title>
      <Dialog.Description>Inspect the bars currently loaded on the chart—not a guarantee of completeness, market freshness, or suitability.</Dialog.Description>
    </Dialog.Header>
    {#if inspection}
      <dl class="grid min-w-0 grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm [&_dd]:break-words">
        <dt>Loaded context</dt><dd>{chart.loadedContext ? `${chart.loadedContext.symbol} · ${chart.loadedContext.source} · ${chart.loadedContext.period} / ${chart.loadedContext.interval}` : 'No dataset loaded'}</dd>
        <dt>Selected context</dt><dd>{chart.symbol} · {chart.source} · {chart.period} / {chart.interval}</dd>
        <dt>Request state</dt><dd>{chart.isLoading ? 'Loading; prior bars may still be shown' : chart.errorMessage ? 'Request failed; inspect prior loaded context' : chart.dataContextCurrent ? 'Loaded context matches selection' : 'Selection differs from loaded data'}</dd>
        <dt>Snapshot received</dt><dd class="font-mono">{utcTime(chart.snapshotReceivedAt)}</dd>
        <dt>Latest stream receipt</dt><dd class="font-mono">{utcTime(chart.streamReceivedAt)}</dd>
        <dt>Actual coverage</dt><dd class="font-mono">{utcTime(inspection.first)} → {utcTime(inspection.last)}</dd>
        <dt>Bar count</dt><dd class="font-mono">{inspection.count}</dd>
        <dt>Time convention</dt><dd>UTC display. Exchange timezone and session calendar are not reported by this response.</dd>
        <dt>Adjustments</dt><dd>Not reported per dataset. Do not assume these bars are unadjusted or identical to a stored backtest dataset.</dd>
      </dl>
      <p class="text-xs text-muted-foreground">Receipt times are measured by this browser, not the provider's publication time. A connected stream does not prove that the latest market bar has arrived.</p>
      <section class="grid gap-1 text-sm">
        <h3 class="font-semibold">Observed anomalies</h3>
        <p>Duplicate timestamps: {inspection.duplicates}; out-of-order transitions: {inspection.outOfOrder}; invalid timestamps: {inspection.invalidTimestamps}; invalid OHLCV bars: {inspection.invalidBars}.</p>
        <p>Longer-than-requested intervals: {inspection.fixedInterval ? inspection.longIntervals : 'not evaluated for calendar-sized intervals'}.</p>
        <p class="text-xs text-muted-foreground">Long intervals are observations, not missing-bar counts. Weekends, holidays, session boundaries, and provider aggregation can explain them. Zero observed anomalies is not a data-quality certification.</p>
      </section>
    {/if}
  </Dialog.Content>
</Dialog.Root>

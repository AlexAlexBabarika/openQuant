<script lang="ts">
  import { onMount } from 'svelte';
  import type { TrialReport } from '$lib/features/trial-report/types';
  import { chartBounds, chartX, chartY, equityPath, finalEquity, formatDate, formatMoney } from './evidence';

  let { report }: { report: TrialReport } = $props();
  let chartElement: HTMLDivElement;
  let width = $state(960);
  let lines = $derived([
    { name: 'Frictionless strategy', key: 'baseline', data: report.baseline.equity },
    { name: 'Strategy with costs', key: 'realistic', data: report.realistic.equity },
    { name: 'Buy & hold with costs', key: 'benchmark', data: report.benchmark.equity },
  ]);
  let bounds = $derived(chartBounds(lines.map(line => line.data)));
  let split = $derived(new Date(report.dataset.split_date).getTime() / 1000);
  let splitX = $derived(bounds && Number.isFinite(split) && split >= bounds.start && split <= bounds.end ? chartX(split, bounds, width) : null);
  let dateTicks = $derived(width < 620 ? [0, 1] : [0, 1 / 3, 2 / 3, 1]);

  onMount(() => {
    const resize = () => { width = Math.max(280, chartElement.clientWidth); };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(chartElement);
    return () => observer.disconnect();
  });
</script>

<figure>
  <figcaption>
    <div>
      <h3>Full-period equity</h3>
    </div>
    <span class="currency-label">Account equity · USD</span>
  </figcaption>

  <div class="chart-area" bind:this={chartElement}>
  {#if bounds}
    <svg viewBox="0 0 {width} 350" role="img" aria-label="Full-period dollar equity: frictionless strategy, strategy with costs, and buy and hold. Holdout dates are shaded. Ending values and all run metrics follow the chart.">
      {#if splitX !== null}
        <rect class="holdout-shade" x={splitX} y="42" width={width - 30 - splitX} height="250" />
        <line class="split-line" x1={splitX} x2={splitX} y1="42" y2="292" />
      {/if}
      {#each [0, 1, 2, 3, 4] as tick}
        {@const value = bounds.min + ((bounds.max - bounds.min) * tick) / 4}
        {@const y = chartY(value, bounds)}
        <line class="grid" x1="78" x2={width - 30} y1={y} y2={y} />
        <text class="axis" x="66" {y} text-anchor="end" dominant-baseline="middle">{formatMoney(value)}</text>
      {/each}
      {#each dateTicks as tick}
        {@const t = bounds.start + (bounds.end - bounds.start) * tick}
        <text class="axis" x={chartX(t, bounds, width)} y="323" text-anchor={tick === 0 ? 'start' : tick === 1 ? 'end' : 'middle'}>{formatDate(t)}</text>
      {/each}
      {#each lines as line (line.key)}
        <path class={line.key} d={equityPath(line.data, bounds, width)} fill="none" stroke-width="2.5" vector-effect="non-scaling-stroke" />
        {#if line.data.length}
          {@const last = line.data[line.data.length - 1]}
          <circle class={line.key} cx={chartX(last.t, bounds, width)} cy={chartY(last.value, bounds)} r="3.5" />
        {/if}
      {/each}
    </svg>
  {:else}
    <p class="empty">The engine returned no equity observations for this run.</p>
  {/if}
  </div>

  <ul class="legend" aria-label="Equity series and final account values">
    {#each lines as line (line.key)}
      <li><span class="swatch {line.key}" aria-hidden="true"></span><span>{line.name}</span><strong>{finalEquity(line.data)}</strong></li>
    {/each}
  </ul>
  <p class="chart-note"><span class="shade-key" aria-hidden="true"></span>Shaded dates: holdout from {formatDate(report.dataset.split_date)}. This chart follows full-period accounts, including training. The Holdout tab compares separately funded test accounts.</p>
</figure>

<style>
  figure { margin: 0; padding: clamp(1rem, 3vw, 1.75rem); border: 1px solid oklch(var(--border)); background: oklch(var(--card)); border-radius: 4px; }
  figcaption { display: flex; justify-content: space-between; align-items: flex-end; gap: 1rem; }
  h3 { margin: 0; color: oklch(var(--foreground)); font: 600 12px var(--font-mono); }
  .currency-label { color: oklch(var(--muted-foreground)); font-size: 0.75rem; }
  svg { display: block; width: 100%; height: auto; margin: 1rem 0 0; overflow: visible; }
  .grid { stroke: oklch(var(--border)); stroke-width: 1; }
  .axis { fill: oklch(var(--muted-foreground)); font: 11px var(--font-mono); }
  .holdout-shade { fill: oklch(var(--primary)); fill-opacity: 0.06; }
  .split-line { stroke: oklch(var(--primary)); stroke-dasharray: 3 5; }
  path.baseline { stroke: oklch(var(--muted-foreground)); stroke-dasharray: 5 5; }
  path.realistic { stroke: oklch(var(--primary)); }
  path.benchmark { stroke: oklch(var(--chart-1)); stroke-dasharray: 12 4 2 4; }
  circle.baseline { fill: oklch(var(--muted-foreground)); }
  circle.realistic { fill: oklch(var(--primary)); }
  circle.benchmark { fill: oklch(var(--chart-1)); }
  .legend { display: flex; flex-wrap: wrap; gap: 0.75rem 1.6rem; padding: 0; margin: 0.75rem 0 1rem; list-style: none; }
  .legend li { display: flex; gap: 0.6rem; align-items: center; color: oklch(var(--muted-foreground)); font-size: 0.75rem; }
  strong { color: oklch(var(--foreground)); font: 0.75rem var(--font-mono); }
  .swatch { width: 1.3rem; height: 0; border-top: 2px solid; flex-shrink: 0; }
  .swatch.baseline { border-color: oklch(var(--muted-foreground)); border-top-style: dashed; }
  .swatch.realistic { border-color: oklch(var(--primary)); }
  .swatch.benchmark { border-color: oklch(var(--chart-1)); border-top-style: dotted; }
  .chart-note { display: flex; align-items: baseline; gap: 0.5rem; margin: 0; color: oklch(var(--muted-foreground)); font-size: 0.75rem; line-height: 1.65; }
  .shade-key { width: 0.6rem; height: 0.6rem; background: color-mix(in oklab, oklch(var(--primary)) 12%, oklch(var(--background))); border: 1px solid oklch(var(--primary)); flex-shrink: 0; }
  .empty { min-height: 10rem; display: grid; place-items: center; color: oklch(var(--muted-foreground)); }
  @media (max-width: 600px) {
    figcaption { align-items: flex-start; flex-direction: column; gap: 0.5rem; }
    .legend { flex-direction: column; }
    .legend li strong { margin-left: auto; }
  }
</style>

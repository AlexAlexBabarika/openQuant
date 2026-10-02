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
      <span class="eyebrow">Exhibit A / Full period</span>
      <h3>Same strategy. More questions.</h3>
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
  <p class="chart-note"><span class="shade-key" aria-hidden="true"></span>Shaded dates: holdout from {formatDate(report.dataset.split_date)}. This chart follows full-period accounts; the separately funded holdout results below are not stitched into it.</p>
</figure>

<style>
  figure { margin: 0; padding: clamp(1rem, 3vw, 1.75rem); border: 1px solid #343934; background: #131917; border-radius: 4px; }
  figcaption { display: flex; justify-content: space-between; align-items: flex-end; gap: 1rem; }
  .eyebrow { color: #d1aa83; font: 0.65rem 'Space Mono', monospace; text-transform: uppercase; letter-spacing: 0.1em; }
  h3 { margin: 0.5rem 0 0; color: #f0eee7; font: normal clamp(1.2rem, 2.5vw, 1.6rem) Georgia, serif; }
  .currency-label { color: #a4aaa3; font-size: 0.75rem; }
  svg { display: block; width: 100%; height: auto; margin: 1rem 0 0; overflow: visible; }
  .grid { stroke: #313931; stroke-width: 1; }
  .axis { fill: #b2b8af; font: 11px 'Space Mono', monospace; }
  .holdout-shade { fill: #d2ac78; fill-opacity: 0.06; }
  .split-line { stroke: #9d8263; stroke-dasharray: 3 5; }
  path.baseline { stroke: #bdc8b8; stroke-dasharray: 5 5; }
  path.realistic { stroke: #efad78; }
  path.benchmark { stroke: #83b4d5; stroke-dasharray: 12 4 2 4; }
  circle.baseline { fill: #bdc8b8; }
  circle.realistic { fill: #efad78; }
  circle.benchmark { fill: #83b4d5; }
  .legend { display: flex; flex-wrap: wrap; gap: 0.75rem 1.6rem; padding: 0; margin: 0.75rem 0 1rem; list-style: none; }
  .legend li { display: flex; gap: 0.6rem; align-items: center; color: #c2c7be; font-size: 0.75rem; }
  strong { color: #f0eee7; font: 0.75rem 'Space Mono', monospace; }
  .swatch { width: 1.3rem; height: 0; border-top: 2px solid; flex-shrink: 0; }
  .swatch.baseline { border-color: #bdc8b8; border-top-style: dashed; }
  .swatch.realistic { border-color: #efad78; }
  .swatch.benchmark { border-color: #83b4d5; border-top-style: dotted; }
  .chart-note { display: flex; align-items: baseline; gap: 0.5rem; margin: 0; color: #a4aaa3; font-size: 0.75rem; line-height: 1.65; }
  .shade-key { width: 0.6rem; height: 0.6rem; background: #594934; border: 1px solid #9d8263; flex-shrink: 0; }
  .empty { min-height: 10rem; display: grid; place-items: center; color: #b2b8af; }
  @media (max-width: 600px) {
    figcaption { align-items: flex-start; flex-direction: column; gap: 0.5rem; }
    .legend { flex-direction: column; }
    .legend li strong { margin-left: auto; }
  }
</style>

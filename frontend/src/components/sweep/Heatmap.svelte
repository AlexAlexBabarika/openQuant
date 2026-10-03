<script lang="ts">
  import { heatmapMatrix } from '$lib/features/sweep/derive';
  import type { TrialRow } from '$lib/features/sweep/types';
  import {
    heatmapCellLabel,
    heatmapColor,
    heatmapLegend,
    heatmapMetric,
    heatmapScale,
    heatmapValue,
  } from '$lib/features/sweep/heatmap';

  let {
    trials,
    xParam,
    yParam,
    metric,
    ontrial,
  }: {
    trials: TrialRow[];
    xParam: string;
    yParam: string;
    metric: string;
    ontrial?: (trialId: number) => void;
  } = $props();

  const m = $derived(heatmapMatrix(trials, xParam, yParam, metric));
  const scale = $derived(heatmapScale(m.cells));
  const legend = $derived(heatmapLegend(scale));
  const measure = $derived(heatmapMetric(metric));

  function trialAt(xi: number, yi: number): TrialRow | undefined {
    const x = m.xValues[xi];
    const y = m.yValues[yi];
    return trials.find(
      t => Number(t.params[xParam]) === x && Number(t.params[yParam]) === y,
    );
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard access to horizontal scrolling) -->
<div class="wrap" role="region" aria-label={`${measure.label} by ${xParam} and ${yParam}`} tabindex="0">
  <div class="measure">{measure.label} · {measure.unit}</div>
  <div class="coordinates">Columns: {xParam} · Rows: {yParam}</div>
  {#if m.xValues.length && m.yValues.length}
  <div class="grid" style={`grid-template-columns: max-content repeat(${m.xValues.length}, minmax(56px, max-content));`}>
    <div></div>
    {#each m.xValues as xv (xv)}<div class="axis x">{xv}</div>{/each}
    {#each m.yValues as yv, yi (yv)}
      <div class="axis y">{yv}</div>
      {#each m.xValues as _xv, xi (xi)}
        {@const v = m.cells[yi][xi]}
        {@const trial = trialAt(xi, yi)}
        {@const label = heatmapCellLabel(metric, v, xParam, m.xValues[xi], yParam, m.yValues[yi])}
        <button
          type="button"
          class="cell"
          class:missing={v == null || !Number.isFinite(v)}
          style={`background:${heatmapColor(v, scale)}`}
          title={label}
          disabled={!trial || !ontrial}
          onclick={() => {
            if (trial && ontrial) ontrial(trial.trial_id);
          }}
          aria-label={label}
        >{heatmapValue(v)}</button>
      {/each}
    {/each}
  </div>
  {/if}
  {#if scale.state === 'missing'}
    <div class="note">No finite results for {measure.label}.</div>
  {:else}
    <div class="legend" aria-label={`${measure.label} scale in ${measure.unit}`}>
      {#each legend as stop (stop.position)}
        <div class="legend-stop">
          <span class="swatch" style={`background:${stop.color}`} aria-hidden="true"></span>
          <span>{heatmapValue(stop.value)}</span>
        </div>
      {/each}
    </div>
    <div class="note">
      {#if scale.state === 'constant'}All finite results equal {heatmapValue(scale.min)} {measure.unit}.
      {:else}Low → high numeric value; color is not profitability.{/if}
    </div>
  {/if}
  <div class="note">— = no result. Values are unrounded.</div>
</div>

<style>
  .wrap { display: flex; flex-direction: column; gap: 8px; padding: 4px 0; width: fit-content; max-width: 100%; overflow-x: auto; font-size: 11px; }
  .grid { display: grid; gap: 2px; }
  .measure { font-weight: 700; }
  .axis, .cell, .legend { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
  .axis { font-size: 10px; color: oklch(var(--muted-foreground)); display: flex; align-items: center; justify-content: center; padding: 0 4px; }
  .cell { min-height: 28px; padding: 4px 6px; border: 1px solid transparent; border-radius: 2px; color: oklch(0.141 0.005 285.823); font-size: 10px; white-space: nowrap; cursor: pointer; }
  .cell:disabled { cursor: default; }
  .cell.missing { border: 1px dashed oklch(var(--muted-foreground)); color: oklch(var(--foreground)); }
  .cell:hover { outline: 1px solid oklch(var(--foreground)); }
  .wrap:focus-visible, .cell:focus-visible { outline: 2px solid oklch(var(--foreground)); outline-offset: 2px; }
  .legend { display: flex; gap: 8px; font-size: 10px; }
  .legend-stop { display: flex; flex: 1; flex-direction: column; gap: 2px; }
  .swatch { height: 8px; border-radius: 2px; }
  .coordinates, .note { color: oklch(var(--muted-foreground)); }
  @media (forced-colors: active) { .cell { border-color: ButtonText; color: ButtonText; } }
</style>

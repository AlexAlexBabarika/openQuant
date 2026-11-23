<script lang="ts">
  import { parallelCoordsModel } from '$lib/features/sweep/derive';
  import type { TrialRow } from '$lib/features/sweep/types';

  let {
    trials,
    varied,
    metric,
    ontrial,
  }: {
    trials: TrialRow[];
    varied: string[];
    metric: string;
    ontrial?: (trialId: number) => void;
  } = $props();

  const W = 640;
  const H = 260;
  const pad = 28;
  const model = $derived(parallelCoordsModel(trials, varied, metric));
  const axisX = $derived(
    model.axes.map((_, i) =>
      model.axes.length === 1 ? pad : pad + (i * (W - 2 * pad)) / (model.axes.length - 1),
    ),
  );
  const y = (norm: number) => H - pad - norm * (H - 2 * pad); // higher value -> higher up

  // colour each polyline by its metric (last coord) so good runs stand out.
  const stroke = (lastCoord: number) => `oklch(0.65 0.15 ${250 - 250 * lastCoord})`;
</script>

<svg viewBox={`0 0 ${W} ${H}`} class="pc" role="img" aria-label="Parallel coordinates of trials">
  {#each model.axes as axis, i (axis)}
    <line x1={axisX[i]} y1={pad} x2={axisX[i]} y2={H - pad} class="axis" />
    <text x={axisX[i]} y={H - 8} class="label">{axis}</text>
  {/each}
  {#each model.lines as line (line.trialId)}
    <polyline
      points={line.coords.map((c, i) => `${axisX[i]},${y(c)}`).join(' ')}
      style={`stroke:${stroke(line.coords[line.coords.length - 1])}`}
      class="trial"
      onclick={() => ontrial?.(line.trialId)}
      onkeydown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          ontrial?.(line.trialId);
        }
      }}
      role="button"
      tabindex="0"
      aria-label={`Open trial ${line.trialId}`}
    />
  {/each}
</svg>

<style>
  .pc { width: 100%; height: 100%; }
  .axis { stroke: oklch(var(--border)); stroke-width: 1; }
  .label { fill: oklch(var(--muted-foreground)); font-size: var(--font-size-annotation); text-anchor: middle; }
  .trial { fill: none; stroke-width: 1.25; opacity: 0.5; cursor: pointer; }
  .trial:hover { opacity: 1; stroke-width: 2.5; }
</style>

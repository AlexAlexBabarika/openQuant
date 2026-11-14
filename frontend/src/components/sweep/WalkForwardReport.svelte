<script lang="ts">
  import { walkForwardAggregate, paramStability } from '$lib/features/sweep/derive';
  import type { WalkForwardReport } from '$lib/features/sweep/types';

  let { report, varied }: { report: WalkForwardReport; varied: string[] } = $props();

  const series = $derived(walkForwardAggregate(report.windows, report.metric));
  const stability = $derived(paramStability(report.windows, varied));
  const peak = $derived(
    Math.max(0.0001, ...series.is.map(Math.abs), ...series.oos.map(Math.abs)),
  );
  const h = (v: number) => `${(Math.abs(v) / peak) * 60}px`;
</script>

<div class="wf">
  <div class="aggregate">
    <div class="agg is"><span class="lbl">IS {report.metric}</span><span class="val">{report.is_aggregate.toFixed(3)}</span></div>
    <div class="agg oos"><span class="lbl">OOS {report.metric}</span><span class="val">{report.oos_aggregate.toFixed(3)}</span></div>
    <div class="agg gap" class:alarm={report.is_aggregate - report.oos_aggregate > Math.abs(report.is_aggregate) * 0.5}>
      <span class="lbl">IS − OOS gap</span>
      <span class="val">{(report.is_aggregate - report.oos_aggregate).toFixed(3)}</span>
    </div>
  </div>

  <div class="bars">
    {#each report.windows as w, i (w.window.index)}
      <div class="window">
        <div class="pair">
          <div class="bar is" style={`height:${h(series.is[i])}`} title={`IS ${series.is[i].toFixed(3)}`}></div>
          <div class="bar oos" style={`height:${h(series.oos[i])}`} title={`OOS ${series.oos[i].toFixed(3)}`}></div>
        </div>
        <span class="wlabel">W{w.window.index}</span>
      </div>
    {/each}
  </div>

  <div class="stability">
    <h4>Parameter stability</h4>
    {#each varied as p (p)}
      <div class="srow" class:jumpy={stability[p].distinct > Math.max(2, report.windows.length / 2)}>
        <span class="sname">{p}</span>
        <span class="svals">{stability[p].values.join(' → ')}</span>
        <span class="sdistinct">{stability[p].distinct} distinct</span>
      </div>
    {/each}
  </div>
</div>

<style>
  .wf { display: flex; flex-direction: column; gap: 16px; padding: 12px 16px; }
  .aggregate { display: flex; gap: 12px; }
  .agg { display: flex; flex-direction: column; gap: 2px; padding: 8px 14px; border: 1px solid oklch(var(--border)); border-radius: 8px; }
  .agg .lbl { font-size: 10px; color: oklch(var(--muted-foreground)); text-transform: uppercase; letter-spacing: 0.08em; }
  .agg .val { font-size: 18px; font-weight: 600; }
  .agg.gap.alarm { border-color: oklch(var(--status-error)); color: oklch(var(--status-error)); }
  .bars { display: flex; gap: 10px; align-items: flex-end; min-height: 80px; }
  .window { display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .pair { display: flex; gap: 3px; align-items: flex-end; height: 60px; }
  .bar { width: 10px; border-radius: 2px 2px 0 0; }
  .bar.is { background: oklch(var(--primary)); }
  .bar.oos { background: oklch(0.65 0.15 30); }
  .wlabel { font-size: 10px; color: oklch(var(--muted-foreground)); }
  .stability h4 { font-size: 12px; margin: 0 0 6px; }
  .srow { display: grid; grid-template-columns: 80px 1fr auto; gap: 8px; font-size: 11px; padding: 3px 0; }
  .srow.jumpy { color: oklch(var(--status-error)); }
  .sname { font-weight: 600; }
  .svals { color: oklch(var(--muted-foreground)); }
</style>

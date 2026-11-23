<script lang="ts">
  import { sortTrials, filterTrials } from '$lib/features/sweep/derive';
  import type { TrialRow } from '$lib/features/sweep/types';

  let {
    trials,
    metric,
    varied,
    bestTrialId = null,
    onopen,
  }: {
    trials: TrialRow[];
    metric: string;
    varied: string[];
    bestTrialId?: number | null;
    onopen?: (trialId: number) => void;
  } = $props();

  let dir = $state<'asc' | 'desc'>('desc');
  let threshold = $state<number | null>(null);

  const rows = $derived.by(() => {
    const filtered = threshold == null ? trials : filterTrials(trials, metric, threshold);
    return sortTrials(filtered, metric, dir);
  });
</script>

<div class="table-section">
  <div class="controls">
    <label>Min {metric}
      <input
        type="number"
        step="0.1"
        placeholder="—"
        onchange={e => (threshold = (e.target as HTMLInputElement).value === '' ? null : Number((e.target as HTMLInputElement).value))}
      />
    </label>
    <button type="button" onclick={() => (dir = dir === 'desc' ? 'asc' : 'desc')}>
      Sort {metric} {dir === 'desc' ? '↓' : '↑'}
    </button>
    <span class="count">{rows.length} / {trials.length} trials</span>
  </div>

  <table>
    <thead>
      <tr>
        {#each varied as p (p)}<th>{p}</th>{/each}
        <th>{metric}</th>
        <th>cached</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      {#each rows as t (t.trial_id)}
        <tr class:best={t.trial_id === bestTrialId}>
          {#each varied as p (p)}<td>{t.params[p]}</td>{/each}
          <td>{t.metrics[metric]?.toFixed(3) ?? '—'}</td>
          <td>{t.cached ? '•' : ''}</td>
          <td><button type="button" class="open" onclick={() => onopen?.(t.trial_id)}>open</button></td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  /* Single root so the parent flex gap can't split the controls from the
     table; no inner scroll container so the header sticks to the panel's
     scroller while scrolling a long trial list. */
  .table-section { display: flex; flex-direction: column; }
  .controls { display: flex; gap: 12px; align-items: end; padding: 2px 0 6px; font-size: var(--font-size-label); color: oklch(var(--muted-foreground)); }
  .controls label { display: flex; flex-direction: column; gap: 4px; }
  .controls input {
    width: 72px;
    padding: 2px 6px;
    font: inherit;
    color: oklch(var(--foreground));
    background: transparent;
    border: 1px solid oklch(var(--border));
    border-radius: var(--radius-md);
  }
  .controls button {
    padding: 2px 8px;
    font: inherit;
    color: oklch(var(--foreground));
    background: transparent;
    border: 1px solid oklch(var(--border));
    border-radius: var(--radius-md);
    cursor: pointer;
  }
  .count { margin-left: auto; }
  table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: var(--font-size-chrome); }
  th, td { text-align: right; padding: 4px 10px; border-bottom: 1px solid oklch(var(--border) / 0.4); }
  th { position: sticky; top: 0; z-index: 1; background: oklch(var(--card)); }
  tr.best { background: oklch(var(--surface-selected)); }
  @media (forced-colors: active) {
    tr.best { outline: 2px solid Highlight; outline-offset: -2px; }
  }
  .open { font-size: var(--font-size-label); padding: 2px 8px; border: 1px solid oklch(var(--border)); border-radius: var(--radius-md); background: transparent; color: oklch(var(--foreground)); cursor: pointer; }
</style>

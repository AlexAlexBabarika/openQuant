<script lang="ts">
  import { SweepState } from '$lib/features/sweep/sweepState.svelte';
  import { BacktestState } from '$lib/features/backtest/backtestState.svelte';
  import type { SweepFormValues } from '$lib/features/sweep/types';
  import ParamForm from './ParamForm.svelte';
  import Heatmap from './Heatmap.svelte';
  import ParallelCoords from './ParallelCoords.svelte';
  import TrialsTable from './TrialsTable.svelte';
  import BacktestPanel from '../backtest/BacktestPanel.svelte';

  let { code, symbol = 'SPY', provider = 'yfinance', sweep = new SweepState() }: { code: string; symbol?: string; provider?: string; sweep?: SweepState } = $props();

  let lastForm = $state<SweepFormValues | null>(null);
  let drillOpen = $state(false);
  let drillState = $state<BacktestState | null>(null);

  // Schema introspection when the panel mounts / code changes.
  $effect(() => {
    void sweep.loadSchema(code);
  });

  function start(form: SweepFormValues) {
    if (sweep.status === 'running') return;
    drillOpen = false;
    drillState = null;
    lastForm = form;
    void sweep.run(form);
  }

  async function openTrial(trialId: number) {
    if (!lastForm || !sweep.sweepId) return;
    // Drill-in reuses the dashboard reader: load this trial's full BacktestResult.
    const loader = sweep.trialLoader(trialId, lastForm);
    drillState = new BacktestState(loader);
    drillOpen = true;
  }

  const varied = $derived(lastForm?.vary ?? []);
  const resultMetric = $derived(lastForm?.metric ?? 'sharpe');
</script>

<div class="sweep">
  <ParamForm schema={sweep.schema} {code} {symbol} {provider} bind:vary={sweep.form.vary} bind:search={sweep.form.search} bind:metric={sweep.form.metric} bind:nRandom={sweep.form.nRandom} bind:seed={sweep.form.seed} onsubmit={start} disabled={sweep.schemaLoading || sweep.status === 'running'} />
  {#if sweep.schemaLoading}<p class="card">Loading parameters…</p>{/if}
  {#if sweep.schemaError}<p class="card err" role="alert">{sweep.schemaError}</p>{/if}

  {#if sweep.status !== 'idle'}
    <fieldset class="card">
      <legend>Progress</legend>
      <div class="status">
        <span class="badge {sweep.status}">{sweep.status}</span>
        <progress max={sweep.total || 1} value={sweep.done}></progress>
        <span>{sweep.done}/{sweep.total}</span>
        {#if sweep.status === 'running'}
          <button type="button" disabled={sweep.cancelling} onclick={() => sweep.cancel()}>{sweep.cancelling ? 'cancelling…' : 'cancel'}</button>
        {/if}
        {#if sweep.error}<span class="err">{sweep.error}</span>{/if}
        {#if sweep.cancelError}<span class="err" role="alert">{sweep.cancelError}</span>{/if}
      </div>
    </fieldset>
  {/if}

  {#if sweep.status === 'done' && sweep.trials.length === 0}
    <p class="card">No trials were returned for this sweep.</p>
  {/if}

  {#if sweep.trials.length > 0}
    {#if varied.length >= 2}
      <fieldset class="card">
        <legend>{varied.length === 2 ? 'Heatmap' : 'Parallel coordinates'}</legend>
        {#if varied.length === 2}
          <Heatmap trials={sweep.trials} xParam={varied[0]} yParam={varied[1]} metric={resultMetric} ontrial={openTrial} />
        {:else}
          <ParallelCoords trials={sweep.trials} {varied} metric={resultMetric} ontrial={openTrial} />
        {/if}
      </fieldset>
    {/if}
    <fieldset class="card">
      <legend>Trials</legend>
      <TrialsTable trials={sweep.trials} metric={resultMetric} {varied} bestTrialId={sweep.bestTrialId} onopen={openTrial} />
    </fieldset>
  {/if}
</div>

{#if drillState}
  <BacktestPanel bind:open={drillOpen} backtest={drillState} />
{/if}

<style>
  .sweep { display: flex; flex-direction: column; gap: 12px; height: 100%; overflow: auto; padding-bottom: 16px; }
  /* Children keep their natural height and the panel scrolls; without this,
     flex shrinks each section's box and tall content (the heatmap) paints
     over the sections below it. */
  .sweep > :global(*) { flex-shrink: 0; }
  /* Same labeled-card treatment as ParamForm's fieldsets; margin matches the
     form's 16px horizontal padding so all cards align. */
  .card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0 16px;
    min-width: 0;
    border: 1px dashed oklch(var(--border));
    border-radius: 8px;
    padding: 10px 12px;
  }
  legend {
    padding: 0 6px;
    font-size: 10px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: oklch(var(--muted-foreground));
  }
  .status { display: flex; align-items: center; gap: 12px; font-size: 12px; }
  .status progress { flex: 0 0 200px; }
  .status button { padding: 2px 10px; font: inherit; font-size: 11px; color: oklch(var(--foreground)); background: transparent; border: 1px solid oklch(var(--border)); border-radius: 4px; cursor: pointer; }
  .badge { padding: 2px 8px; border-radius: 999px; font-size: 10px; text-transform: uppercase; border: 1px solid oklch(var(--border)); }
  .badge.done { color: oklch(var(--primary)); }
  .badge.error { color: #ff9c9c; }
  .err { color: #ff9c9c; }
</style>

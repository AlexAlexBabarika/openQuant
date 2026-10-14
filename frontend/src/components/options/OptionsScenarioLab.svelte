<script lang="ts">
  import type { OptionsDraft, OptionsAnalysis } from '$lib/features/options/optionsTypes';
  import { exactValue } from '$lib/features/options/optionsChart';
  import { buildSurface, ivShiftBounds, requestChanged, scenarioInputError, scenarioNameError, surfaceCellLabel, surfaceDataError, surfaceKeyboardCell, surfaceSettings, surfaceSettingsErrors, surfaceValue } from '$lib/features/options/optionsScenario';
  import type { SurfaceSettings } from '$lib/features/options/optionsScenario';
  import { heatmapColor, heatmapLegend, heatmapScale } from '$lib/features/sweep/heatmap';
  import { untrack } from 'svelte';

  let { draft, result, onEdit, onAnalyze, pending = false, readOnly = false }: {
    draft: OptionsDraft;
    result: OptionsAnalysis | null;
    onEdit: (update: (draft: OptionsDraft) => void) => void;
    onAnalyze: () => void;
    pending?: boolean;
    readOnly?: boolean;
  } = $props();
  const id = $props.id();
  let settings = $state<SurfaceSettings>(untrack(() => surfaceSettings(draft)));
  let applied = $state('');
  let selected = $state({ row: 0, column: 0 });
  const bounds = $derived(ivShiftBounds(draft));
  const errors = $derived(surfaceSettingsErrors(draft, settings));
  const configValid = $derived(Object.keys(errors).length === 0);
  const surface = $derived(result?.surface ?? null);
  const dataError = $derived(surface ? surfaceDataError(surface) : null);
  const stale = $derived(result && requestChanged(draft, result.request));
  const cells = $derived(surface && !dataError ? surface.steps.map((_, row) => surface.spots.map((_, column) => surfaceValue(surface, row, column))) : []);
  const scale = $derived(heatmapScale(cells));
  const legend = $derived(heatmapLegend(scale));
  const missing = $derived(cells.some(row => row.some(v => v == null)));
  const configKey = $derived(JSON.stringify([draft.surface ?? null, draft.spot_grid, draft.strategy.days_to_expiry, bounds]));
  const active = $derived(surface && !dataError && selected.row < surface.steps.length && selected.column < surface.spots.length ? selected : { row: 0, column: 0 });

  $effect(() => { configKey; settings = untrack(() => surfaceSettings(draft)); });
  $effect(() => { result; selected = { row: 0, column: 0 }; });

  function addScenario() {
    if (pending || draft.scenarios.length >= 3) return;
    onEdit(d => {
      let n = 1;
      while (d.scenarios.some(s => s.name === `Scenario ${n}`)) n++;
      d.scenarios.push({ name: `Scenario ${n}`, elapsed_days: 0, iv_shift_pp: 0 });
    });
  }

  function editScenario(index: number, key: 'elapsed_days' | 'iv_shift_pp', value: number) {
    if (!pending) onEdit(d => { d.scenarios[index][key] = value; });
  }

  function changeAxis(axis: SurfaceSettings['axis']) {
    settings.axis = axis;
    settings.stepStart = axis === 'elapsed_days' ? 0 : Math.max(-10, bounds?.min ?? 0);
    settings.stepEnd = axis === 'elapsed_days' ? draft.strategy.days_to_expiry : Math.min(10, bounds?.max ?? 0);
    applied = '';
  }

  function applySurface(event: SubmitEvent) {
    event.preventDefault();
    if (pending) return;
    const next = buildSurface(draft, settings);
    if (!next) return;
    onEdit(d => { d.surface = next; });
    applied = 'Heatmap grid applied to draft. Analyze explicitly to request backend cells.';
  }

  function cellKey(event: KeyboardEvent, row: number, column: number) {
    if (!surface || event.altKey || event.metaKey || event.shiftKey || (event.ctrlKey && !['Home', 'End'].includes(event.key))) return;
    const next = surfaceKeyboardCell(row, column, surface.steps.length, surface.spots.length, event.key, event.ctrlKey);
    if (!next) return;
    event.preventDefault();
    selected = next;
    const button = event.currentTarget as HTMLButtonElement;
    button.closest('table')?.querySelector<HTMLButtonElement>(`[data-cell="${next.row}-${next.column}"]`)?.focus();
  }
</script>

<section class="scenario-lab" aria-label="Options scenario lab">
  {#if !readOnly}
  <header><h3>Scenario lab</h3><button type="button" class="ot-workbench-primary" disabled={pending} onclick={() => { if (!pending) onAnalyze(); }}>{pending ? 'Analyzing…' : 'Analyze draft'}</button></header>
  <p class="note">Manual European cash-settled USD research. Controls edit inputs only; no automatic Python execution. Premiums and entry fees stay fixed. No probability forecast or provider verification.</p>
  <div class="feedback" aria-live="polite" aria-atomic="true">
    {#if pending}<p>{result ? 'Analyzing current inputs; previous submitted evidence remains below.' : 'Analyzing current inputs; no results yet.'}</p>{/if}
    {#if stale}<p class="notice">Inputs changed. Previous submitted results below are stale; Analyze explicitly to refresh. New slider or grid inputs are never applied to old values.</p>{/if}
    {#if applied}<p>{applied}</p>{/if}
  </div>
  <div class="section-title"><h4>Explicit scenarios · {draft.scenarios.length}/3</h4><button type="button" class="ot-workbench-ghost" disabled={pending || draft.scenarios.length >= 3} onclick={addScenario}>Add scenario</button></div>
  <p class="note">Elapsed days: 0–{exactValue(draft.strategy.days_to_expiry)}. IV shift: {bounds ? `${exactValue(bounds.min, true)}–${exactValue(bounds.max, true)} pp` : 'unavailable until base and leg IVs are valid'}. A shift applies to every enabled option IV and the declared base, not their average. Undefined Greeks remain unavailable.</p>
  {#if draft.scenarios.length === 0}<p class="note">No scenarios configured. Add one to set explicit time and IV shifts.</p>{/if}
  {#each draft.scenarios as scenario, i}
    {@const error = scenarioInputError(draft, scenario.elapsed_days, scenario.iv_shift_pp)}
    {@const nameError = scenarioNameError(draft, i)}
    <fieldset disabled={pending} class="scenario"><legend>Scenario {i + 1}</legend>
      <label for={`${id}-name-${i}`}>Name · unique, 1–80 characters<input id={`${id}-name-${i}`} value={scenario.name} maxlength="80" aria-invalid={!!nameError} aria-describedby={`${id}-name-error-${i}`} oninput={e => onEdit(d => { d.scenarios[i].name = e.currentTarget.value; })} /></label>
      <p id={`${id}-name-error-${i}`} class:notice={!!nameError} class="note">{nameError ?? 'Names identify submitted scenario evidence.'}</p>
      <label for={`${id}-time-${i}`}>Elapsed calendar days · draft <output for={`${id}-time-${i}`}>{exactValue(scenario.elapsed_days)}</output>
        <input id={`${id}-time-${i}`} type="range" min="0" max={Math.max(0, draft.strategy.days_to_expiry)} step="any" value={scenario.elapsed_days} disabled={!Number.isFinite(draft.strategy.days_to_expiry) || draft.strategy.days_to_expiry <= 0 || draft.strategy.days_to_expiry > 3650} aria-valuetext={`${exactValue(scenario.elapsed_days)} calendar days elapsed`} aria-invalid={!!error} aria-describedby={`${id}-scenario-${i}`} oninput={e => editScenario(i, 'elapsed_days', Number(e.currentTarget.value))} />
      </label>
      <label for={`${id}-iv-${i}`}>IV shift · draft <output for={`${id}-iv-${i}`}>{exactValue(scenario.iv_shift_pp, true)} pp</output>
        <input id={`${id}-iv-${i}`} type="range" min={bounds?.min ?? 0} max={bounds?.max ?? 0} step="any" value={scenario.iv_shift_pp} disabled={!bounds || bounds.min === bounds.max} aria-valuetext={`${exactValue(scenario.iv_shift_pp, true)} volatility percentage points`} aria-invalid={!!error} aria-describedby={`${id}-scenario-${i}`} oninput={e => editScenario(i, 'iv_shift_pp', Number(e.currentTarget.value))} />
      </label>
      <p id={`${id}-scenario-${i}`} class:notice={!!error} class="note">{error ?? 'Draft inputs only. Analyze to produce a new scenario curve.'}</p>
      <button type="button" class="ot-workbench-ghost" onclick={() => onEdit(d => { d.scenarios.splice(i, 1); })} aria-label={`Remove scenario ${i + 1}`}>Remove scenario</button>
    </fieldset>
  {/each}

  <details class="configuration" open><summary>Spot–time / spot–IV heatmap configuration</summary>
    <p class="note">Stage a uniform grid, then Apply heatmap grid to the draft and Analyze. Spots: 2–41 columns in 0–1,000,000 USD. Steps: 2–21 distinct increasing rows; at most 861 cells. Changing axis does not run analysis.</p>
    <form onsubmit={applySurface}>
      <fieldset disabled={pending} class="grid-fields"><legend>Requested surface · draft inputs</legend>
        <label for={`${id}-axis`}>Step axis<select id={`${id}-axis`} value={settings.axis} onchange={e => changeAxis(e.currentTarget.value as SurfaceSettings['axis'])}><option value="elapsed_days">Spot × elapsed calendar days</option><option value="iv_shift_pp">Spot × IV shift (pp)</option></select></label>
        <label for={`${id}-spot-start`}>Spot start (USD)<input id={`${id}-spot-start`} type="number" min="0" max="1000000" step="any" bind:value={settings.spotStart} aria-invalid={!!errors.spots} aria-describedby={`${id}-spots-error`} /></label>
        <label for={`${id}-spot-end`}>Spot end (USD)<input id={`${id}-spot-end`} type="number" min="0" max="1000000" step="any" bind:value={settings.spotEnd} aria-invalid={!!errors.spots} aria-describedby={`${id}-spots-error`} /></label>
        <p id={`${id}-spots-error`} class="field-note">{errors.spots ?? 'Strictly increasing USD prices.'}</p>
        <label for={`${id}-spot-count`}>Spot columns (2–41)<input id={`${id}-spot-count`} type="number" min="2" max="41" step="1" bind:value={settings.spotCount} aria-invalid={!!errors.spotCount} aria-describedby={`${id}-columns-error`} /></label>
        <p id={`${id}-columns-error`} class="field-note">{errors.spotCount ?? 'Up to 41 columns.'}</p>
        <label for={`${id}-step-start`}>Step start ({settings.axis === 'elapsed_days' ? 'calendar days' : 'IV shift pp'})<input id={`${id}-step-start`} type="number" min={settings.axis === 'elapsed_days' ? 0 : bounds?.min ?? 0} max={settings.axis === 'elapsed_days' ? draft.strategy.days_to_expiry : bounds?.max ?? 0} step="any" bind:value={settings.stepStart} aria-invalid={!!errors.steps} aria-describedby={`${id}-steps-error`} /></label>
        <label for={`${id}-step-end`}>Step end ({settings.axis === 'elapsed_days' ? 'calendar days' : 'IV shift pp'})<input id={`${id}-step-end`} type="number" min={settings.axis === 'elapsed_days' ? 0 : bounds?.min ?? 0} max={settings.axis === 'elapsed_days' ? draft.strategy.days_to_expiry : bounds?.max ?? 0} step="any" bind:value={settings.stepEnd} aria-invalid={!!errors.steps} aria-describedby={`${id}-steps-error`} /></label>
        <p id={`${id}-steps-error`} class="field-note">{errors.steps ?? (settings.axis === 'elapsed_days' ? 'Common horizon only; IVs held at their resolved input values.' : 'Current time only; shift each resolved enabled IV and the declared base.')}</p>
        <label for={`${id}-step-count`}>Step rows (2–21)<input id={`${id}-step-count`} type="number" min="2" max="21" step="1" bind:value={settings.stepCount} aria-invalid={!!errors.stepCount} aria-describedby={`${id}-rows-error`} /></label>
        <p id={`${id}-rows-error`} class="field-note">{errors.stepCount ?? 'Up to 21 rows.'}</p>
        <div class="actions"><button type="submit" class="ot-workbench-ghost" disabled={!configValid}>Apply heatmap grid</button><button type="button" class="ot-workbench-ghost" disabled={!draft.surface} onclick={() => onEdit(d => { d.surface = null; })}>Remove draft heatmap</button></div>
      </fieldset>
    </form>
    <p class="note">{draft.surface ? `Draft requests ${draft.surface.spots.length} spot columns × ${draft.surface.steps.length} ${draft.surface.axis === 'elapsed_days' ? 'time' : 'IV-shift'} rows.` : 'No heatmap requested in the draft.'} Saved nonuniform grids remain unchanged until Apply explicitly replaces them with a uniform grid.</p>
  </details>

  {/if}
  <div class="section-title"><h4>Canonical heatmap · submitted evidence</h4></div>
  {#if !result}<p class="notice">No analysis yet. Apply a heatmap grid and Analyze explicitly.</p>
  {:else}
    <p class="note">Submitted {result.request.strategy.name} · spot {exactValue(result.request.spot)} USD · {exactValue(result.request.strategy.days_to_expiry)} days to common expiry · base IV {exactValue(result.request.volatility)} annual fraction · rate {exactValue(result.request.rate)} · yield {exactValue(result.request.dividend_yield)}. Manual inputs, not live quotes.</p>
    {#if !surface}<p class="notice">Heatmap unavailable: this submitted result contains no canonical surface. Missing is not zero; no browser pricing or reconstructed cells.</p>
    {:else if dataError}<p class="notice" role="alert">{dataError}</p>
    {:else}
      <p class="note">Returned axis: {surface.axis === 'elapsed_days' ? 'elapsed calendar days, current resolved IV per leg' : 'IV shift in percentage points, current time'}. Rows and columns below come only from the returned backend surface. Signed total P&amp;L in USD; unrounded raw values.</p>
      <div class="legend" aria-label="Heatmap low-to-high P&L legend">{#each legend as item}<span><i style:background={item.color} aria-hidden="true"></i>{exactValue(item.value, true)} USD</span>{/each}</div>
      <p class="note">{scale.state === 'constant' ? 'Constant results use one midpoint swatch.' : scale.state === 'missing' ? 'No finite results: cells are unavailable, not zero.' : 'Swatches map low to high values using the same scale as cells; not a profitability or safety rating.'}</p>
      {#if missing}<p class="notice">Some backend cells are missing or nonfinite: Unavailable (no result), never zero.</p>{/if}
      <p id={`${id}-keys`} class="note">Focus a cell: arrows move; Home/End move within the row; Ctrl+Home/End go to first/last cell. Tab leaves the grid. Scroll for all coordinates; focus or click for exact readout.</p>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard access to bounded two-dimensional scrolling) -->
      <div class="heatmap-scroll" role="region" aria-label="Canonical options P&L heatmap" tabindex="0">
        <table><caption>P&amp;L (USD) · columns: spot (USD) · rows: {surface.axis === 'elapsed_days' ? 'elapsed calendar days' : 'IV shift (pp)'}</caption>
          <thead><tr><th scope="col">{surface.axis === 'elapsed_days' ? 'Days / spot USD' : 'IV pp / spot USD'}</th>{#each surface.spots as spot}<th scope="col">{exactValue(spot)}</th>{/each}</tr></thead>
          <tbody>{#each surface.steps as step, row}<tr><th scope="row">{exactValue(step, surface.axis === 'iv_shift_pp')}</th>{#each surface.spots as _, column}{@const value = surfaceValue(surface, row, column)}<td>
            <button type="button" class="cell" style:--cell-color={heatmapColor(value, scale)} data-cell={`${row}-${column}`} tabindex={active.row === row && active.column === column ? 0 : -1} aria-label={surfaceCellLabel(surface, row, column)} aria-describedby={`${id}-keys`} title={surfaceCellLabel(surface, row, column)} onkeydown={e => cellKey(e, row, column)} onfocus={() => { selected = { row, column }; }} onclick={() => { selected = { row, column }; }}>{exactValue(value, true)}</button>
          </td>{/each}</tr>{/each}</tbody>
        </table>
      </div>
      <div class="readout" aria-live="polite" aria-atomic="true">{surfaceCellLabel(surface, active.row, active.column)}</div>
    {/if}
    <details class="configuration"><summary>Submitted scenario context · not current sliders</summary>
      {#if result.scenarios.length === 0}<p class="note">No scenarios in the submitted result.</p>{/if}
      {#each result.scenarios as scenario}<p class="note">{scenario.name}: {exactValue(scenario.elapsed_days)} calendar days elapsed · {exactValue(scenario.remaining_days)} remaining · shifted declared IV {exactValue(scenario.volatility)} annual fraction.</p>{/each}
    </details>
  {/if}
</section>

<style>
  .scenario-lab { min-width: 0; color: oklch(var(--foreground)); font: 12px var(--font-family-lato); }
  header, .section-title { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin: 8px 0; }
  h3, h4, p { margin: 0; } h3 { font-size: 14px; } h4 { font-size: 12px; }
  .note, .field-note { color: oklch(var(--muted-foreground)); font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; margin: 6px 0; }
  .notice, .readout { border: 1px dashed oklch(var(--input)); border-radius: 4px; padding: 8px; margin: 8px 0; background: oklch(var(--background)); line-height: 1.6; overflow-wrap: anywhere; }
  .readout, output { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
  .scenario, .grid-fields { min-width: 0; padding: 8px; margin: 8px 0; border: 1px solid oklch(var(--border)); border-radius: 4px; }
  legend, summary { font-weight: 700; } summary { cursor: pointer; line-height: 1.6; }
  label { display: flex; flex-direction: column; gap: 4px; min-width: 0; margin-bottom: 8px; font-size: 11px; }
  input, select { width: 100%; min-width: 0; min-height: 28px; padding: 3px 6px; border: 1px solid oklch(var(--input)); border-radius: 4px; color: oklch(var(--foreground)); background: oklch(var(--card)); font: inherit; }
  input { font-family: var(--font-mono); } input[type='range'] { padding: 0; accent-color: oklch(var(--ring)); }
  .actions, .legend { display: flex; flex-wrap: wrap; gap: 8px; }
  .configuration { padding: 8px 0; border-top: 1px solid oklch(var(--border)); }
  .grid-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 8px; }
  .grid-fields > label:first-of-type, .field-note, .actions { grid-column: 1 / -1; }
  .legend span { display: inline-flex; gap: 4px; align-items: center; font: 11px var(--font-mono); overflow-wrap: anywhere; }
  .legend i { display: inline-block; width: 14px; height: 14px; flex: 0 0 14px; border: 1px solid oklch(var(--border)); }
  .heatmap-scroll { overflow: auto; max-width: 100%; max-height: 340px; border: 1px solid oklch(var(--border)); }
  table { border-collapse: collapse; width: 100%; font: 11px var(--font-mono); font-variant-numeric: tabular-nums; }
  caption { text-align: left; padding: 8px; background: oklch(var(--background)); font-family: var(--font-family-lato); }
  th, td { text-align: right; white-space: nowrap; border-bottom: 1px solid oklch(var(--border)); padding: 6px; }
  thead th { position: sticky; top: 0; z-index: 2; background: oklch(var(--card)); }
  tbody th { position: sticky; left: 0; background: oklch(var(--card)); z-index: 1; }
  .cell { border: 1px solid oklch(var(--border)); border-left: 6px solid var(--cell-color); border-radius: 4px; color: oklch(var(--foreground)); background: oklch(var(--card)); font: inherit; padding: 6px 8px; min-height: 28px; cursor: pointer; }
  .cell:hover { background: oklch(var(--accent)); }
  button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible, .heatmap-scroll:focus-visible { outline: 2px solid oklch(var(--ring)); outline-offset: 2px; }
  @media (max-width: 420px) { .grid-fields { grid-template-columns: minmax(0, 1fr); } header { align-items: flex-start; } }
  @media (pointer: coarse) { button, input, select { min-height: var(--control-touch-height); } }
  @media (forced-colors: active) {
    input, select, .cell, .notice, .readout { border-color: CanvasText; }
    .legend i { border-color: CanvasText; }
    button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible, .heatmap-scroll:focus-visible { outline-color: Highlight; }
  }
</style>

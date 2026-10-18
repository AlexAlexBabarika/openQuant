<script lang="ts">
  import { formatGreek, formatUsd } from '$lib/features/options/optionsFormat';
  import { untrack } from 'svelte';
  import { getSessionGeneration } from '$lib/core/api';
  import type { OptionsResearchToolProps } from '$lib/features/options/optionsResearchTypes';
  import { exactValue } from '$lib/features/options/optionsChart';
  import { firstExpiryDays } from '$lib/features/options/optionsValidation';
  import { ivShiftBounds } from '$lib/features/options/optionsScenario';
  import { STRESS_PRESETS, GREEK_KEYS, applyStressScenario, runStress, stressErrors, stressEvidence, stressRequests, researchDifference } from '$lib/features/options/optionsStress';
  import type { StressResult, StressSettings } from '$lib/features/options/optionsStress';

  let { draft, onEdit, documentKey, readOnly = false }: OptionsResearchToolProps = $props();
  const id = $props.id();
  let name = $state(STRESS_PRESETS[0].name);
  let gap = $state(String(STRESS_PRESETS[0].spotChangePct));
  let elapsed = $state(String(STRESS_PRESETS[0].elapsedDays));
  let shift = $state(String(STRESS_PRESETS[0].ivShiftPP));
  const numeric = (value: string) => value.trim() === '' ? NaN : Number(value);
  const settings: StressSettings = $derived({ name, spotChangePct: numeric(gap), elapsedDays: numeric(elapsed), ivShiftPP: numeric(shift) });
  const errors = $derived(stressErrors(draft, settings));
  const horizon = $derived(firstExpiryDays(draft));
  const bounds = $derived(ivShiftBounds(draft));
  const inputKey = $derived(JSON.stringify([draft, settings]));
  let result = $state<StressResult | null>(null);
  let submittedSettings = $state<StressSettings | null>(null);
  let submittedKey = $state('');
  const stale = $derived(!!result && inputKey !== submittedKey);
  const evidence = $derived(result ? stressEvidence(result) : null);
  let pending = $state(false), error = $state(''), notice = $state('');
  let controller: AbortController | null = null, generation = 0;
  const display = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? exactValue(value, true) : 'Unavailable';

  function stop() { generation++; controller?.abort(); controller = null; pending = false; }
  function cancel() { stop(); notice = 'Stress run cancelled. Previous submitted evidence is unchanged.'; }
  function loadPreset(index: number) {
    if (readOnly) return;
    const preset = STRESS_PRESETS[index];
    name = preset.name; gap = String(preset.spotChangePct); elapsed = String(preset.elapsedDays); shift = String(preset.ivShiftPP);
    error = ''; notice = 'Preset loaded as editable hypothetical assumptions only. No request was sent; invalid time/IV is not clipped.';
  }
  $effect(() => {
    documentKey;
    untrack(() => { stop(); result = null; submittedSettings = null; submittedKey = ''; error = ''; notice = ''; name = STRESS_PRESETS[0].name; gap = String(STRESS_PRESETS[0].spotChangePct); elapsed = String(STRESS_PRESETS[0].elapsedDays); shift = String(STRESS_PRESETS[0].ivShiftPP); });
    return stop;
  });
  $effect(() => { if (readOnly) untrack(stop); });
  $effect(() => { inputKey; untrack(() => { if (pending) { stop(); notice = 'Stress request cancelled because inputs changed. Run explicitly to refresh.'; } }); });

  async function submit(event: SubmitEvent) {
    event.preventDefault(); if (readOnly || pending) return;
    const snapshot = structuredClone($state.snapshot(draft)), submitted = { ...settings };
    try { stressRequests(snapshot, submitted); } catch (e) { error = e instanceof Error ? e.message : 'Correct draft inputs before running.'; return; }
    stop(); const flight = ++generation, scope = documentKey, session = getSessionGeneration(), key = inputKey;
    const abort = new AbortController(); controller = abort; pending = true; error = ''; notice = '';
    const current = () => flight === generation && scope === documentKey && session === getSessionGeneration() && key === inputKey;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; abort.abort(); }, 15000);
    try {
      const response = await runStress(snapshot, submitted, abort.signal);
      if (current() && !abort.signal.aborted) { result = response; submittedSettings = submitted; submittedKey = key; }
    } catch {
      if (current()) { error = timedOut ? 'Stress analysis timed out. Retry explicitly.' : 'Canonical stress analysis failed. Check inputs and retry; draft and premiums are unchanged.'; abort.abort(); }
    } finally {
      clearTimeout(timer);
      if (flight === generation) {
        pending = false; controller = null;
        if (session !== getSessionGeneration()) { result = null; submittedSettings = null; submittedKey = ''; error = ''; notice = 'Account scope changed; submit explicitly in the current scope.'; }
      }
    }
  }
  function apply() {
    if (readOnly) return;
    try {
      const snapshot = structuredClone($state.snapshot(draft)), submitted = { ...settings };
      applyStressScenario(snapshot, submitted);
      onEdit(d => applyStressScenario(d, submitted));
      error = ''; notice = 'Time/IV scenario applied to draft only. The spot shock stays local to this lab; entry premiums and current spot are unchanged. Analyze explicitly.';
    } catch (e) { error = e instanceof Error ? e.message : 'Scenario was not applied.'; }
  }
</script>

<section class="stress-tool" aria-label="Hypothetical event stress lab">
  <h3>Hypothetical event stress</h3>
  <p class="note">Editable assumptions, not forecasts, observed events or historical replay. BSM European cash-settled USD research; fixed entry premiums/fees. The baseline is today at the submitted original spot; stress changes spot, elapsed time and each enabled option’s IV in parallel.</p>
  {#if readOnly}<p class="notice">Read-only source mode. Switch explicitly to the visual draft to edit or run this tool; Python source is never replaced.</p>{/if}
  <div class="actions" aria-label="Load editable hypothetical presets">
    {#each STRESS_PRESETS as preset, index}<button type="button" class="ot-workbench-ghost" disabled={readOnly} onclick={() => loadPreset(index)}>Load {preset.name}</button>{/each}
  </div>
  <form onsubmit={submit}>
    <fieldset disabled={readOnly}><legend>Stress assumptions · explicit run required</legend>
      <label for={`${id}-name`}>Hypothesis label · 1–80 characters<input id={`${id}-name`} maxlength="80" value={name} oninput={e => name = e.currentTarget.value} aria-invalid={!!errors.name} aria-describedby={`${id}-name-error`} /></label>
      <p class="note" id={`${id}-name-error`}>{errors.name ?? 'Label identifies submitted hypothetical evidence.'}</p>
      <div class="fields">
        <div><label for={`${id}-gap`}>Spot change · %<input id={`${id}-gap`} type="number" min="-100" max="1000" step="any" value={gap} oninput={e => gap = e.currentTarget.value} aria-invalid={!!errors.spotChangePct} aria-describedby={`${id}-gap-error`} /></label><p class="note" id={`${id}-gap-error`}>{errors.spotChangePct ?? `−100% exclusive to +1000%; implied spot ${display(draft.spot * (1 + settings.spotChangePct / 100))} USD.`}</p></div>
        <div><label for={`${id}-time`}>Elapsed time · calendar days<input id={`${id}-time`} type="number" min="0" max={horizon} step="any" value={elapsed} oninput={e => elapsed = e.currentTarget.value} aria-invalid={!!errors.elapsedDays} aria-describedby={`${id}-time-error`} /></label><p class="note" id={`${id}-time-error`}>{errors.elapsedDays ?? `0–${exactValue(horizon)} days (first active expiry).`}</p></div>
        <div><label for={`${id}-iv`}>Parallel IV shift · pp<input id={`${id}-iv`} type="number" min={bounds?.min ?? -100} max={bounds?.max ?? 100} step="any" value={shift} oninput={e => shift = e.currentTarget.value} aria-invalid={!!errors.ivShiftPP} aria-describedby={`${id}-iv-error`} /></label><p class="note" id={`${id}-iv-error`}>{errors.ivShiftPP ?? `Allowed ${bounds ? `${exactValue(bounds.min, true)} to ${exactValue(bounds.max, true)}` : 'unavailable'} pp; base and every enabled IV must remain 0–500%.`}</p></div>
      </div>
      <p class="note">A −10 pp shift turns 20% IV into 10%, not 18%. Inherited and explicit leg IV differences remain intact. Time cannot cross first expiry; expiry Greeks may be unavailable. No IV, spot or time is silently clipped.</p>
      <div class="actions"><button type="submit" class="ot-workbench-primary" disabled={pending || Object.keys(errors).length > 0}>Run hypothetical stress</button><button type="button" class="ot-workbench-ghost" disabled={Object.keys(errors).length > 0} onclick={apply}>Apply time/IV scenario to draft</button></div>
    </fieldset>
  </form>
  <div aria-live="polite" aria-atomic="true">
    {#if pending}<p>{result ? 'Running canonical stress; previous submitted evidence remains below.' : 'Running matched baseline and hypothetical stress on the backend…'}</p><button type="button" class="ot-workbench-ghost" onclick={cancel}>Cancel stress run</button>{/if}
    {#if stale}<p class="notice">Stale: draft or assumptions changed. Re-run explicitly; results below retain their submitted inputs.</p>{/if}
    {#if notice}<p>{notice}</p>{/if}{#if error}<p role="alert">{error}</p>{/if}
    {#if !result && !pending && !error}<p class="note">No stress submitted. Loading or editing a preset never runs analysis. Results are session-local, not saved.</p>{/if}
  </div>
  {#if result && submittedSettings && evidence}
    <h4>Submitted hypothesis · {result.stress.scenarios[0]?.name ?? submittedSettings.name}</h4>
    <p class="note">{result.baseline.request.strategy.name} · spot {exactValue(result.baseline.request.spot)} → {exactValue(result.stress.request.spot)} USD ({display(submittedSettings.spotChangePct)}%) · elapsed {exactValue(result.stress.scenarios[0]?.elapsed_days ?? submittedSettings.elapsedDays)} days · IV shift {display(submittedSettings.ivShiftPP)} pp · base IV {exactValue(result.baseline.request.volatility * 100)}%. Two-point canonical spot probes [0, submitted spot]; unrelated draft scenarios/surfaces excluded.</p>
    <p class="note">Annual rate {exactValue(result.baseline.request.rate)}, yield {exactValue(result.baseline.request.dividend_yield)} (fractions). Scenario volatility shown by the model is declared base only; each enabled option uses its own submitted override plus the same shift. P&amp;L is signed total USD after fixed entry cost, not return or event probability. Null Greeks remain unavailable, never zero.</p>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard-scrollable data region) -->
    <div class="results" role="region" tabindex="0" aria-label="Matched baseline versus hypothetical stress signed results">
      <table><thead><tr><th>Metric / units</th><th>Today baseline</th><th>Hypothetical stress</th><th>Stress − baseline</th></tr></thead><tbody>
        <tr><th>P&amp;L · USD</th><td title={exactValue(result.baseline.summary.pnl_today)}>{formatUsd(result.baseline.summary.pnl_today, { signed: true })}</td><td title={exactValue(evidence.pnl)}>{formatUsd(evidence.pnl, { signed: true })}</td><td title={exactValue(evidence.pnlDifference)}>{formatUsd(evidence.pnlDifference, { signed: true })}</td></tr>
        {#each GREEK_KEYS as key}<tr><th>{key} · {result.baseline.greek_units[key]}</th><td title={exactValue(result.baseline.greeks[key])}>{formatGreek(result.baseline.greeks[key], { signed: true })}</td><td title={exactValue(evidence.greeks?.[key])}>{formatGreek(evidence.greeks?.[key], { signed: true })}</td><td title={exactValue(researchDifference(evidence.greeks?.[key], result.baseline.greeks[key]))}>{formatGreek(researchDifference(evidence.greeks?.[key], result.baseline.greeks[key]), { signed: true })}</td></tr>{/each}
      </tbody></table>
    </div>
    {#if result.stress.scenarios[0]?.legs}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard-scrollable data region) -->
      <div class="results" role="region" tabindex="0" aria-label="Submitted per-leg stress IV and horizon assumptions">
        <table><thead><tr><th>Leg / right</th><th>Strike · USD</th><th>Base → shifted IV · %</th><th>Remaining days / state</th></tr></thead><tbody>
          {#each result.stress.scenarios[0].legs as mark}
            {@const leg = result.stress.request.strategy.legs[mark.leg_index]}
            <tr><th>Leg {mark.leg_index + 1} · {leg?.kind ?? 'Unavailable'}</th><td>{leg?.strike == null ? 'Not applicable' : exactValue(leg.strike)}</td><td>{leg?.enabled && leg.kind !== 'underlying' ? `${exactValue((leg.implied_volatility ?? result.stress.request.volatility) * 100)} → ${exactValue((leg.implied_volatility ?? result.stress.request.volatility) * 100 + submittedSettings.ivShiftPP)}` : 'Not applicable'}</td><td>{mark.remaining_days == null ? 'Not applicable' : exactValue(mark.remaining_days)} · {mark.state}</td></tr>
          {/each}
        </tbody></table>
      </div>
    {/if}
    {#each [...new Set([...result.baseline.warnings, ...result.stress.warnings])] as warning}<p class="note">{warning}</p>{/each}
  {/if}
</section>

<style>
  .stress-tool { display: grid; gap: 8px; min-width: 0; color: oklch(var(--foreground)); font-family: var(--font-family-lato); font-size: 12px; container-type: inline-size; }
  h3, h4, p { margin: 0; } h3, h4 { font-size: 12px; } p { line-height: 1.5; overflow-wrap: anywhere; }
  .note { color: oklch(var(--muted-foreground)); } .notice { border-left: 2px solid currentColor; padding-left: 8px; }
  .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; } .fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 145px), 1fr)); gap: 8px; }
  fieldset { min-width: 0; display: grid; gap: 8px; padding: 8px; border: 1px solid oklch(var(--border)); border-radius: 4px; } legend { padding: 0 4px; }
  label { display: grid; gap: 4px; min-width: 0; line-height: 1.5; }
  input { width: 100%; min-width: 0; box-sizing: border-box; min-height: 28px; padding: 4px 6px; color: inherit; background: oklch(var(--background)); border: 1px solid oklch(var(--input)); border-radius: 4px; font: inherit; }
  input[type="number"], td { font-family: var(--font-mono); font-variant-numeric: tabular-nums; } input[aria-invalid="true"] { border-color: oklch(var(--destructive)); }
  button { min-height: 28px; height: auto; white-space: normal; overflow-wrap: anywhere; } button:disabled { cursor: not-allowed; }
  :is(input, button, [tabindex]):focus-visible { outline: 2px solid oklch(var(--ring)); outline-offset: 2px; }
  .results { overflow: auto; max-height: 320px; border: 1px solid oklch(var(--border)); border-radius: 4px; }
  table { width: 100%; border-collapse: collapse; } td, th { padding: 6px; border-bottom: 1px solid oklch(var(--border)); text-align: right; } th:first-child { text-align: left; } td { white-space: nowrap; }
  @media (forced-colors: active) { fieldset, input, .results { border-color: CanvasText; } :is(input, button, [tabindex]):focus-visible { outline-color: Highlight; } input[aria-invalid="true"] { outline: 1px solid CanvasText; } }
  @media (pointer: coarse) { input, button { min-height: var(--control-touch-height); } }
</style>

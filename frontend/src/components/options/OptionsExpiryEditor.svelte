<script lang="ts">
  import { untrack } from 'svelte';
  import type { OptionsResearchToolProps } from '$lib/features/options/optionsResearchTypes';
  import { applyCalendar, calendarControls, calendarProposal, researchValue, setLegExpiry, type CalendarControls } from '$lib/features/options/optionsLifecycle';
  import { optionsErrors, resolvedLegDays } from '$lib/features/options/optionsValidation';

  let { draft, onEdit, documentKey, readOnly = false }: OptionsResearchToolProps = $props();
  const uid = $props.id();
  let construction = $state<CalendarControls>(untrack(() => calendarControls(draft)));
  let notice = $state('');
  const errors = $derived(optionsErrors(draft));
  const proposal = $derived(calendarProposal(construction));
  $effect.pre(() => { documentKey; untrack(() => { construction = calendarControls(draft); notice = ''; }); });
  function expiry(index: number, field: 'days_to_expiry' | 'expiry_date', value: number | string | null) {
    if (!readOnly) onEdit(d => setLegExpiry(d, index, field, value));
  }
  function construct() {
    if (readOnly || !proposal.legs) return;
    onEdit(d => { applyCalendar(d, structuredClone($state.snapshot(construction))); });
    notice = 'Replaced legs with the explicit short-near / long-far construction. Review premiums, fees and assumptions; analyze explicitly.';
  }
</script>

<section class="expiry-editor" aria-label="Per-leg expiry authoring">
  <h3>Expiries · common default or per-leg overrides</h3>
  <p>Blank overrides inherit the common {researchValue(draft.strategy.days_to_expiry)} calendar days. Dates require a valuation date. Editing days clears that leg’s date; editing its date clears its days override. No assignment or physical delivery is modeled.</p>
  <p>Expiry edits do not refresh premiums or IV. Retained quote provenance refers to the original imported contract; review those values as manual assumptions for a changed expiry.</p>
  {#if readOnly}<p role="note">Read-only source mode. Switch explicitly to the visual draft editor to change expiry inputs.</p>{/if}
  <fieldset disabled={readOnly}>
    <legend>Date anchor · optional</legend>
    <label>Valuation date · UTC<input type="date" value={draft.strategy.valuation_date ?? ''} aria-invalid={!!errors['strategy.valuation_date']} aria-describedby={`${uid}-valuation-error`} oninput={e => { const value = e.currentTarget.value; if (!readOnly) onEdit(d => { d.strategy.valuation_date = value || null; }); }} /></label>
    <small id={`${uid}-valuation-error`}>{errors['strategy.valuation_date'] ?? 'Existing common dates/days are not silently changed. Resolve paired-date errors in the common assumptions editor.'}</small>
    {#each draft.strategy.legs as leg, i}
      {#if leg.kind !== 'underlying'}
        <div class="leg">
          <h4>Leg {i + 1} · {leg.kind} · {leg.quantity} signed contracts{!leg.enabled ? ' · disabled (still validated)' : ''}</h4>
          <div class="fields">
            <label>Override · calendar days (0–3650)<input type="number" min="0" max="3650" step="any" value={leg.days_to_expiry ?? ''} placeholder="Common default" aria-invalid={!!errors[`legs.${i}.days_to_expiry`]} aria-describedby={`${uid}-leg-${i}`} oninput={e => expiry(i, 'days_to_expiry', e.currentTarget.value === '' ? null : e.currentTarget.valueAsNumber)} /></label>
            <label>Override · expiry date (UTC)<input type="date" value={leg.expiry_date ?? ''} aria-invalid={!!errors[`legs.${i}.expiry_date`]} aria-describedby={`${uid}-leg-${i}`} oninput={e => expiry(i, 'expiry_date', e.currentTarget.value || null)} /></label>
          </div>
          <p id={`${uid}-leg-${i}`}>{errors[`legs.${i}.days_to_expiry`] ?? errors[`legs.${i}.expiry_date`] ?? `Resolved horizon: ${researchValue(resolvedLegDays(draft.strategy, leg))} calendar days.`}</p>
          <button class="ot-workbench-ghost" type="button" onclick={() => expiry(i, 'days_to_expiry', null)}>Use common expiry · leg {i + 1}</button>
        </div>
      {:else}<p>Leg {i + 1} · shares have no expiry.</p>{/if}
    {/each}
  </fieldset>
  <details>
    <summary>Construct a calendar / diagonal · replaces all legs explicitly</summary>
    <p>Short near expiry and long far expiry of the same option kind. Specify both entry premiums; no invented quotes or frontend pricing. Common context, name and fees stay unchanged. Review the leg editor for reverse structures.</p>
    <fieldset disabled={readOnly}>
      <legend>Explicit construction inputs</legend>
      <div class="fields">
        <label>Construction<select bind:value={construction.template}><option value="calendar">Calendar · equal strikes</option><option value="diagonal">Diagonal · different strikes</option></select></label>
        <label>Option kind<select bind:value={construction.kind}><option value="call">Call</option><option value="put">Put</option></select></label>
        {#each ([['nearDays', 'Near expiry · calendar days', 0, 3650], ['farDays', 'Far expiry · calendar days', 0, 3650], ['nearStrike', 'Near strike · USD', 0, 1000000], ['farStrike', 'Far strike · USD', 0, 1000000], ['nearPremium', 'Near entry premium · USD/unit', 0, 1000000], ['farPremium', 'Far entry premium · USD/unit', 0, 1000000], ['contracts', 'Size · contracts per leg', 1, 10000], ['multiplier', 'Multiplier · units/contract', 1, 1000]] as const) as [key, label, min, max]}
          {#if key !== 'farStrike' || construction.template === 'diagonal'}
            <label>{label}<input type="number" {min} {max} step={key === 'contracts' || key === 'multiplier' ? '1' : 'any'} value={construction[key]} aria-invalid={!!proposal.errors[key]} aria-describedby={`${uid}-${key}`} oninput={e => { construction[key] = e.currentTarget.value; }} /><small id={`${uid}-${key}`}>{proposal.errors[key] ?? (key.includes('Premium') ? 'Required; explicit zero is allowed.' : '')}</small></label>
          {/if}
        {/each}
      </div>
      <button class="ot-workbench-ghost" type="button" disabled={!proposal.legs} onclick={construct}>Replace all legs with {construction.template}</button>
    </fieldset>
  </details>
  <p aria-live="polite">{notice}</p>
</section>

<style>
  .expiry-editor { min-width: 0; display: grid; gap: 8px; padding: 10px; color: oklch(var(--foreground)); font-family: var(--font-family-lato); border: 1px solid oklch(var(--border)); border-radius: 4px; }
  h3, h4, p { margin: 0; } h3 { font-size: 13px; } h4 { font-size: 12px; }
  p, small { color: oklch(var(--muted-foreground)); font-size: 12px; overflow-wrap: anywhere; }
  fieldset { min-width: 0; border: 0; padding: 0; display: grid; gap: 8px; } legend { font-size: 12px; padding: 4px 0; }
  .fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr)); gap: 8px; }
  label { display: grid; gap: 4px; min-width: 0; font-size: 12px; } input, select { width: 100%; min-width: 0; min-height: 28px; padding: 4px 6px; border: 1px solid oklch(var(--border)); border-radius: 4px; color: oklch(var(--foreground)); background: oklch(var(--background)); }
  .leg { display: grid; gap: 6px; border-top: 1px solid oklch(var(--border)); padding-top: 8px; } button { white-space: normal; height: auto; min-height: 28px; justify-self: start; }
  summary { cursor: pointer; font-size: 12px; padding: 6px 0; } :is(input, select, button, summary):focus-visible { outline: 2px solid oklch(var(--ring)); outline-offset: 2px; }
  [aria-invalid="true"] { border-color: oklch(var(--destructive)); } @media (forced-colors: active) { :is(input, select, button, summary):focus-visible { outline-color: Highlight; } [aria-invalid="true"] { outline: 1px solid CanvasText; } }
  @media (pointer: coarse) { input, select, button { min-height: var(--control-touch-height); } }
</style>

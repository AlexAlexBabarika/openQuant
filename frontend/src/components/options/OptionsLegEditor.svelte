<script lang="ts">
  import { tick } from 'svelte';
  import type { OptionLeg } from '$lib/features/options/optionsTypes';
  import {
    MAX_OPTIONS_LEGS, addOptionLeg, editOptionLeg, legSide, manualQuoteAge,
    moveOptionLeg, optionsEditorErrors, quoteMidpoint, removeOptionLeg,
    setLegKind, setLegSize, useQuoteMidpoint, type OptionsEditorProps,
  } from '$lib/features/options/optionsLegEditor';
  import { OPTIONS_TEMPLATES, applyOptionsTemplate, type OptionsTemplate } from '$lib/features/options/optionsTemplates';

  let { draft, onEdit, fieldErrors = {}, canUndo = false, canRedo = false, onUndo, onRedo }: OptionsEditorProps = $props();
  const uid = $props.id();
  let root: HTMLElement;
  let nextTemplate = $state<OptionsTemplate>('long_call');
  const errors = $derived({ ...optionsEditorErrors(draft), ...fieldErrors });
  const errorId = (key: string) => `${uid}-${key.replace(/\./g, '-')}-error`;
  const editLeg = (i: number, update: (leg: OptionLeg) => void) => onEdit(d => editOptionLeg(d, i, update));

  async function focusLeg(index: number) {
    await tick();
    root.querySelector<HTMLSelectElement>(`[data-leg-index="${index}"] select`)?.focus();
  }
  function add(copyIndex?: number) {
    const index = copyIndex === undefined ? draft.strategy.legs.length : copyIndex + 1;
    onEdit(d => { addOptionLeg(d, copyIndex); });
    void focusLeg(index);
  }
  function remove(index: number) {
    onEdit(d => { removeOptionLeg(d, index); });
    void focusLeg(Math.min(index, draft.strategy.legs.length - 1));
  }
  function move(index: number, direction: -1 | 1) {
    onEdit(d => { moveOptionLeg(d, index, direction); });
    void focusLeg(index + direction);
  }
</script>

{#snippet error(key: string)}
  {#if errors[key]}<small id={errorId(key)} class="field-error">{errors[key]}</small>{/if}
{/snippet}
{#snippet numeric(label: string, key: string, value: number | null | undefined, min: number, max: number, step: string, update: (value: number | null) => void, optional = false)}
  <label class="field">
    <span>{label}</span>
    <input type="number" value={value != null && Number.isFinite(value) ? value : ''} {min} {max} {step}
      placeholder={optional ? 'Unset (optional)' : undefined} aria-invalid={!!errors[key]}
      aria-describedby={errors[key] ? errorId(key) : undefined}
      oninput={e => update(optional && e.currentTarget.value === '' ? null : e.currentTarget.valueAsNumber)} />
    {@render error(key)}
  </label>
{/snippet}

<section class="leg-editor" aria-label="Options strategy legs" bind:this={root}>
  <header class="actions">
    <h3>Strategy legs <span>{draft.strategy.legs.length}/{MAX_OPTIONS_LEGS}</span></h3>
    <div class="actions">
      <button type="button" class="ot-workbench-ghost" disabled={!canUndo || !onUndo} onclick={() => onUndo?.()}>Undo</button>
      <button type="button" class="ot-workbench-ghost" disabled={!canRedo || !onRedo} onclick={() => onRedo?.()}>Redo</button>
      <button type="button" class="ot-workbench-ghost" disabled={draft.strategy.legs.length >= MAX_OPTIONS_LEGS} onclick={() => add()}>Add leg</button>
    </div>
  </header>
  <div class="template-row">
    <label class="field"><span>Next synthetic template</span><select bind:value={nextTemplate}>{#each OPTIONS_TEMPLATES as [id, name]}<option value={id}>{name}</option>{/each}</select></label>
    <button type="button" class="ot-workbench-ghost" onclick={() => onEdit(d => applyOptionsTemplate(d, nextTemplate))}>Replace legs</button>
  </div>
  <p class="hint">Templates replace legs and name explicitly; synthetic premiums are not quotes. Common assumptions stay unchanged. Explicit legs—not the template label—define exposure.</p>
  <label class="field"><span>Strategy name · up to 120 characters</span><input value={draft.strategy.name} maxlength="120"
    aria-invalid={!!errors['strategy.name']} aria-describedby={errors['strategy.name'] ? errorId('strategy.name') : undefined}
    oninput={e => onEdit(d => { d.strategy.name = e.currentTarget.value; })} />{@render error('strategy.name')}</label>
  {@render error('legs')}
  {#each draft.strategy.legs as leg, i}
    <fieldset class="leg-row" data-leg-index={i}>
      <legend>Leg {i + 1} · {legSide(leg) === 'buy' ? 'Buy / long' : 'Sell / short'}{!leg.enabled ? ' · disabled' : ''}</legend>
      <div class="actions leg-actions">
        <label class="check"><input type="checkbox" checked={leg.enabled} aria-invalid={!!errors[`legs.${i}.enabled`]}
          aria-describedby={errors[`legs.${i}.enabled`] ? errorId(`legs.${i}.enabled`) : undefined}
          onchange={e => editLeg(i, l => { l.enabled = e.currentTarget.checked; })} />Enabled</label>
        <div class="actions">
          <button type="button" class="ot-workbench-ghost" disabled={i === 0} aria-label={`Move leg ${i + 1} up`} onclick={() => move(i, -1)}>Up</button>
          <button type="button" class="ot-workbench-ghost" disabled={i === draft.strategy.legs.length - 1} aria-label={`Move leg ${i + 1} down`} onclick={() => move(i, 1)}>Down</button>
          <button type="button" class="ot-workbench-ghost" disabled={draft.strategy.legs.length >= MAX_OPTIONS_LEGS} aria-label={`Duplicate leg ${i + 1}`} onclick={() => add(i)}>Duplicate</button>
          <button type="button" class="ot-workbench-ghost" disabled={draft.strategy.legs.length <= 1} aria-label={`Remove leg ${i + 1}`} onclick={() => remove(i)}>Remove</button>
        </div>
      </div>
      {@render error(`legs.${i}.enabled`)}
      <div class="leg-fields">
        <label class="field"><span>Instrument</span><select value={leg.kind} aria-invalid={!!errors[`legs.${i}.kind`]}
          aria-describedby={errors[`legs.${i}.kind`] ? errorId(`legs.${i}.kind`) : undefined}
          onchange={e => editLeg(i, l => setLegKind(l, e.currentTarget.value as OptionLeg['kind'], draft.spot))}>
          <option value="call">Call</option><option value="put">Put</option><option value="underlying">Underlying shares</option>
        </select>{@render error(`legs.${i}.kind`)}</label>
        <label class="field"><span>Side</span><select value={legSide(leg)} onchange={e => editLeg(i, l => setLegSize(l, Math.abs(l.quantity), e.currentTarget.value === 'sell' ? 'sell' : 'buy'))}><option value="buy">Buy / long</option><option value="sell">Sell / short</option></select></label>
        {@render numeric(leg.kind === 'underlying' ? 'Size · shares (1–1m)' : 'Size · contracts (1–10k)', `legs.${i}.quantity`, Math.abs(leg.quantity), 1, leg.kind === 'underlying' ? 1000000 : 10000, '1', v => editLeg(i, l => setLegSize(l, v ?? NaN)))}
        {#if leg.kind !== 'underlying'}
          {@render numeric('Strike · USD (>0–1m)', `legs.${i}.strike`, leg.strike, 0, 1000000, 'any', v => editLeg(i, l => { l.strike = v ?? NaN; }))}
        {:else}<div class="field"><span>Strike</span><span class="not-applicable">Not applicable</span>{@render error(`legs.${i}.strike`)}</div>{/if}
        {@render numeric(leg.kind === 'underlying' ? 'Entry · USD/share' : 'Premium · USD/unit', `legs.${i}.entry_premium`, leg.entry_premium, 0, 1000000, 'any', v => editLeg(i, l => { l.entry_premium = v ?? NaN; }))}
        {#if leg.kind !== 'underlying'}
          {@render numeric('Multiplier · units', `legs.${i}.multiplier`, leg.multiplier, 1, 1000, '1', v => editLeg(i, l => { l.multiplier = v ?? NaN; }))}
          {@render numeric('IV fraction · blank = base', `legs.${i}.implied_volatility`, leg.implied_volatility, 0, 5, 'any', v => editLeg(i, l => { l.implied_volatility = v; }), true)}
        {:else}<div class="field"><span>Multiplier</span><span class="not-applicable">1 · shares</span>{@render error(`legs.${i}.multiplier`)}</div>{/if}
      </div>
      {#if leg.kind === 'underlying' && (leg.strike !== null || leg.multiplier !== 1 || [leg.implied_volatility, leg.bid, leg.ask, leg.quote_as_of].some(v => v != null))}
        <button type="button" class="ot-workbench-ghost" aria-label={`Reset share fields for leg ${i + 1}`} onclick={() => editLeg(i, l => setLegKind(l, 'underlying', draft.spot))}>Reset share fields · clear option metadata</button>
      {/if}
      {#if leg.kind !== 'underlying'}
        <details open={leg.bid != null || leg.ask != null || leg.quote_as_of != null}>
          <summary>Manual quote inputs · unverified</summary>
          <div class="quote-fields">
            {@render numeric('Manual bid · USD/unit', `legs.${i}.bid`, leg.bid, 0, 1000000, 'any', v => editLeg(i, l => { l.bid = v; }), true)}
            {@render numeric('Manual ask · USD/unit', `legs.${i}.ask`, leg.ask, 0, 1000000, 'any', v => editLeg(i, l => { l.ask = v; }), true)}
            <label class="field timestamp"><span>As of · explicit ISO timestamp + timezone</span><input type="text" value={leg.quote_as_of ?? ''} maxlength="64" placeholder="2026-10-14T11:00:00Z" spellcheck="false"
              aria-invalid={!!errors[`legs.${i}.quote_as_of`]} aria-describedby={errors[`legs.${i}.quote_as_of`] ? errorId(`legs.${i}.quote_as_of`) : undefined}
              oninput={e => editLeg(i, l => { l.quote_as_of = e.currentTarget.value || null; })} />{@render error(`legs.${i}.quote_as_of`)}</label>
          </div>
          <p class="hint">Manually entered · unverified · not real-time. {manualQuoteAge(leg.quote_as_of)} Bid/ask spreads are not executable fills.</p>
          <button type="button" class="ot-workbench-ghost" aria-label={`Use midpoint as entry for leg ${i + 1}`} disabled={quoteMidpoint(leg) === null} onclick={() => onEdit(d => { useQuoteMidpoint(d, i); })}>Use midpoint as entry</button>
          <p class="hint">Only this explicit action changes entry premium. A valid bid/ask pair and timezone-aware as-of are required; neither verifies price nor fill.</p>
        </details>
      {/if}
    </fieldset>
  {/each}
  <p class="hint">Buy/Sell is serialized as signed quantity. Zero size is invalid. Disabled legs stay editable and validated but contribute zero. Blank IV uses base IV; 0.20 = 20%. Common expiry is the default; use the per-leg expiry controls for calendars and diagonals.</p>
</section>

<style>
  .leg-editor { container-type: inline-size; min-width: 0; display: grid; gap: 8px; color: oklch(var(--foreground)); font-family: var(--font-family-lato); font-size: 12px; }
  .actions, .template-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
  header, .leg-actions { justify-content: space-between; }
  .template-row .field { flex: 1 1 180px; }
  .template-row button { align-self: end; }
  h3 { margin: 0; font-size: 12px; }
  h3 span { color: oklch(var(--muted-foreground)); font-family: var(--font-mono); }
  .field { display: flex; flex-direction: column; gap: 5px; min-width: 0; line-height: 1.4; }
  input:not([type="checkbox"]), select { box-sizing: border-box; width: 100%; min-width: 0; min-height: 32px; padding: 5px 7px; border: 1px solid oklch(var(--input)); border-radius: 4px; background: oklch(var(--background)); color: oklch(var(--foreground)); font: inherit; }
  input[type="number"] { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
  input[type="checkbox"] { width: 16px; height: 16px; accent-color: oklch(var(--primary)); }
  input:focus-visible, select:focus-visible, summary:focus-visible { outline: 2px solid oklch(var(--ring)); outline-offset: 2px; }
  [aria-invalid="true"] { border-color: oklch(var(--destructive)); }
  .field-error { font-size: 12px; color: oklch(var(--down-color)); line-height: 1.5; overflow-wrap: anywhere; }
  .hint { margin: 0; color: oklch(var(--muted-foreground)); line-height: 1.5; overflow-wrap: anywhere; }
  .leg-row { margin: 0; min-width: 0; border: 1px solid oklch(var(--border)); border-radius: 4px; padding: 8px; }
  legend { font-family: var(--font-mono); font-size: 11px; padding: 0 4px; overflow-wrap: anywhere; }
  .leg-fields, .quote-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 8px; }
  .timestamp { grid-column: 1 / -1; }
  .check { display: inline-flex; align-items: center; gap: 6px; min-height: 28px; }
  .not-applicable { color: oklch(var(--muted-foreground)); font-family: var(--font-mono); min-height: 32px; display: flex; align-items: center; }
  details { margin-top: 8px; border-top: 1px solid oklch(var(--border)); padding-top: 4px; }
  details .hint, details button { margin-top: 8px; }
  summary { min-height: 28px; line-height: 1.5; padding: 4px 0; cursor: pointer; overflow-wrap: anywhere; }
  button { white-space: normal; height: auto; min-height: 28px; overflow-wrap: anywhere; }
  @container (min-width: 600px) { .leg-fields { grid-template-columns: repeat(4, minmax(0, 1fr)); } .quote-fields { grid-template-columns: 1fr 1fr 2fr; } .timestamp { grid-column: auto; } }
  @container (min-width: 900px) { .leg-fields { grid-template-columns: 1.2fr 1fr .9fr 1fr 1fr 1fr 1.2fr; } }
  @container (max-width: 280px) { .leg-fields, .quote-fields { grid-template-columns: minmax(0, 1fr); } }
  @media (pointer: coarse) { button, input:not([type="checkbox"]), select, summary { min-height: var(--control-touch-height); } }
  @media (forced-colors: active) { input, select, .leg-row { border-color: CanvasText; } input:focus-visible, select:focus-visible, summary:focus-visible { outline-color: Highlight; } [aria-invalid="true"] { outline: 1px solid CanvasText; } }
</style>

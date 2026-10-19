<script lang="ts">
  import { tick } from 'svelte';
  import type { OptionLeg } from '$lib/features/options/optionsTypes';
  import {
    MAX_OPTIONS_LEGS, addOptionLeg, editLegContract, editOptionLeg, legSide, manualQuoteAge,
    moveOptionLeg, optionsEditorErrors, quoteMidpoint, removeOptionLeg,
    setLegKind, setLegSize, useQuoteMidpoint, type OptionsEditorProps,
  } from '$lib/features/options/optionsLegEditor';
  import { OPTIONS_TEMPLATES, applyOptionsTemplate, templateGlyph, type OptionsTemplate } from '$lib/features/options/optionsTemplates';
  import { fractionInput, matchTemplate, percentFieldError, percentInput } from '$lib/features/options/optionsInputs';
  import { formatUsd } from '$lib/features/options/optionsFormat';

  const glyphs = new Map(OPTIONS_TEMPLATES.map(([template]) => [template, templateGlyph(template)]));

  let { draft, onEdit, fieldErrors = {}, canUndo = false, canRedo = false, onUndo, onRedo, onTemplate, legs, modelLegs, modelPrices = [], onUseModel }: OptionsEditorProps & {
    /** Replace the legs with a template; defaults to a plain draft edit. */
    onTemplate?: (template: OptionsTemplate) => void;
    /** Leg operations that keep each leg's model tag with it; default to plain draft edits. */
    legs?: { add: (copyIndex?: number) => void; remove: (index: number) => void; move: (index: number, direction: -1 | 1) => void };
    /** Per leg: true while the premium follows the model price. */
    modelLegs?: boolean[];
    /** Current model price per unit for each leg, when the analysis is up to date. */
    modelPrices?: (number | null)[];
    onUseModel?: (index: number) => void;
  } = $props();
  const uid = $props.id();
  let root: HTMLElement;
  const current = $derived(matchTemplate(draft));
  const errors = $derived({ ...optionsEditorErrors(draft), ...fieldErrors });
  const errorId = (key: string) => `${uid}-${key.replace(/\./g, '-')}-error`;
  const editLeg = (i: number, update: (leg: OptionLeg) => void) => onEdit(d => editOptionLeg(d, i, update));

  async function focusLeg(index: number) {
    await tick();
    root.querySelector<HTMLSelectElement>(`[data-leg-index="${index}"] select`)?.focus();
  }
  function add(copyIndex?: number) {
    const index = copyIndex === undefined ? draft.strategy.legs.length : copyIndex + 1;
    if (legs) legs.add(copyIndex); else onEdit(d => { addOptionLeg(d, copyIndex); });
    void focusLeg(index);
  }
  function remove(index: number) {
    if (legs) legs.remove(index); else onEdit(d => { removeOptionLeg(d, index); });
    void focusLeg(Math.min(index, draft.strategy.legs.length - 1));
  }
  let expanded = $state<number[]>([]);
  const detailKeys = ['enabled', 'multiplier', 'implied_volatility', 'bid', 'ask', 'quote_as_of'];
  /** Contract details open on request, and whenever they hold quotes, errors or share fields to reset. */
  function details(index: number, leg: OptionLeg): boolean {
    return expanded.includes(index) || [leg.bid, leg.ask, leg.quote_as_of].some(v => v != null)
      || detailKeys.some(k => errors[`legs.${index}.${k}`])
      || (leg.kind === 'underlying' && (leg.strike !== null || leg.multiplier !== 1 || leg.implied_volatility != null));
  }
  function toggle(index: number) {
    expanded = expanded.includes(index) ? expanded.filter(i => i !== index) : [...expanded, index];
  }
  function closeOnEscape(event: KeyboardEvent) {
    const menu = root?.querySelector<HTMLDetailsElement>('details.menu[open]');
    if (event.key !== 'Escape' || !menu) return;
    event.preventDefault();
    menu.open = false;
    menu.querySelector('summary')?.focus();
  }
  function closeMenus(event: MouseEvent) {
    for (const menu of root?.querySelectorAll<HTMLDetailsElement>('details.menu[open]') ?? [])
      if (!(event.target instanceof Node && menu.contains(event.target))) menu.open = false;
  }
  /** Close the row menu, then act. */
  function act(event: MouseEvent, action: () => void) {
    (event.currentTarget as HTMLElement).closest('details')?.removeAttribute('open');
    action();
  }
  function move(index: number, direction: -1 | 1) {
    if (legs) legs.move(index, direction); else onEdit(d => { moveOptionLeg(d, index, direction); });
    void focusLeg(index + direction);
  }
</script>

{#snippet error(key: string)}
  {#if errors[key]}<small id={errorId(key)} class="field-error">{percentFieldError(key, errors[key])}</small>{/if}
{/snippet}
{#snippet cell(label: string, key: string, value: number | null | undefined, min: number, max: number, step: string, update: (value: number | null) => void)}
  <input type="number" name={key} autocomplete="off" aria-label={label} value={value != null && Number.isFinite(value) ? value : ''} {min} {max} {step}
    aria-invalid={!!errors[key]} aria-describedby={errors[key] ? errorId(key) : undefined}
    oninput={e => update(e.currentTarget.valueAsNumber)} />{@render error(key)}
{/snippet}
{#snippet numeric(label: string, key: string, value: number | null | undefined, min: number, max: number, step: string, update: (value: number | null) => void, optional = false)}
  <label class="field">
    <span>{label}</span>
    <input type="number" name={key} autocomplete="off" value={value != null && Number.isFinite(value) ? value : ''} {min} {max} {step}
      placeholder={optional ? 'Unset (optional)' : undefined} aria-invalid={!!errors[key]}
      aria-describedby={errors[key] ? errorId(key) : undefined}
      oninput={e => update(optional && e.currentTarget.value === '' ? null : e.currentTarget.valueAsNumber)} />
    {@render error(key)}
  </label>
{/snippet}

<svelte:window onclick={closeMenus} onkeydown={closeOnEscape} />

<section class="leg-editor" aria-label="Options strategy legs" bind:this={root}>
  <header class="actions">
    <h3>Legs <span>{draft.strategy.legs.length}/{MAX_OPTIONS_LEGS}</span></h3>
    <div class="actions">
      <button type="button" class="ot-workbench-ghost" disabled={!canUndo || !onUndo} onclick={() => onUndo?.()}>Undo</button>
      <button type="button" class="ot-workbench-ghost" disabled={!canRedo || !onRedo} onclick={() => onRedo?.()}>Redo</button>
      <button type="button" class="ot-workbench-ghost" disabled={draft.strategy.legs.length >= MAX_OPTIONS_LEGS} onclick={() => add()}>Add leg</button>
    </div>
  </header>
  <div class="templates" role="group" aria-label="Strategy templates">
    {#each OPTIONS_TEMPLATES as [template, name] (template)}
      <button type="button" class="chip" aria-pressed={current === template}
        onclick={() => onTemplate ? onTemplate(template) : onEdit(d => applyOptionsTemplate(d, template))}>
        <svg viewBox="0 0 100 18" preserveAspectRatio="none" aria-hidden="true"><path d={glyphs.get(template)} /></svg>{name}
      </button>
    {/each}
  </div>
  <label class="field name"><span>Strategy name</span><input name="strategy.name" autocomplete="off" value={draft.strategy.name} maxlength="120"
    aria-invalid={!!errors['strategy.name']} aria-describedby={errors['strategy.name'] ? errorId('strategy.name') : undefined}
    oninput={e => onEdit(d => { d.strategy.name = e.currentTarget.value; })} />{@render error('strategy.name')}</label>
  {@render error('legs')}
  <table class="legs">
    <thead><tr><th scope="col">Side</th><th scope="col" class="num">Qty</th><th scope="col">Type</th><th scope="col" class="num">Strike</th><th scope="col" class="num">Premium</th><th scope="col"><span class="sr-only">Leg actions</span></th></tr></thead>
    {#each draft.strategy.legs as leg, i}
      {@const side = legSide(leg)}
      {@const option = leg.kind !== 'underlying'}
      <tbody data-leg-index={i} class:off={!leg.enabled}>
        <tr>
          <td data-k="side"><button type="button" class={`side ${side}`} aria-label={`Leg ${i + 1}: ${side === 'buy' ? 'Buy' : 'Sell'}. Switch to ${side === 'buy' ? 'Sell' : 'Buy'}`}
            onclick={() => editLeg(i, l => setLegSize(l, Math.abs(l.quantity), side === 'buy' ? 'sell' : 'buy'))}>{side === 'buy' ? 'Buy' : 'Sell'}</button></td>
          <td data-k="qty" data-label="Qty">{@render cell(`Leg ${i + 1} ${option ? 'contracts' : 'shares'}`, `legs.${i}.quantity`, Math.abs(leg.quantity), 1, option ? 10000 : 1000000, '1', v => editLeg(i, l => setLegSize(l, v ?? NaN)))}</td>
          <td data-k="type">
            <select name={`legs.${i}.kind`} value={leg.kind} aria-label={`Leg ${i + 1} type`} aria-invalid={!!errors[`legs.${i}.kind`]}
              aria-describedby={errors[`legs.${i}.kind`] ? errorId(`legs.${i}.kind`) : undefined}
              onchange={e => editLeg(i, l => setLegKind(l, e.currentTarget.value as OptionLeg['kind'], draft.spot))}>
              <option value="call">Call</option><option value="put">Put</option><option value="underlying">Shares</option>
            </select>{#if !leg.enabled}<small class="off-tag">Off</small>{/if}{@render error(`legs.${i}.kind`)}
          </td>
          <td data-k="strike" data-label="Strike">
            {#if option}{@render cell(`Leg ${i + 1} strike`, `legs.${i}.strike`, leg.strike, 0, 1000000, 'any', v => editLeg(i, l => editLegContract(l, { strike: v ?? NaN })))}
            {:else}<span class="na" aria-hidden="true">—</span><span class="sr-only">Not applicable</span>{@render error(`legs.${i}.strike`)}{/if}
          </td>
          <td data-k="prem" data-label={option ? 'Premium' : 'Entry'}>
            {@render cell(option ? `Leg ${i + 1} premium per unit` : `Leg ${i + 1} entry price per share`, `legs.${i}.entry_premium`, leg.entry_premium, 0, 1000000, 'any', v => editLeg(i, l => { l.entry_premium = v ?? NaN; }))}
            {#if modelLegs}
              {#if modelLegs[i]}<small class="premium-source">Model price</small>
              {:else}<small class="premium-source manual">Manual{#if onUseModel} · <button type="button" class="link" onclick={() => onUseModel(i)}>Use model price</button>{#if modelPrices[i] != null} ({formatUsd(modelPrices[i])}){/if}{/if}</small>{/if}
            {/if}
          </td>
          <td data-k="menu">
            <details class="menu">
              <summary aria-label={`Leg ${i + 1} actions`}>⋯</summary>
              <div class="menu-items">
                <button type="button" disabled={i === 0} aria-label={`Move leg ${i + 1} up`} onclick={e => act(e, () => move(i, -1))}>Move up</button>
                <button type="button" disabled={i === draft.strategy.legs.length - 1} aria-label={`Move leg ${i + 1} down`} onclick={e => act(e, () => move(i, 1))}>Move down</button>
                <button type="button" disabled={draft.strategy.legs.length >= MAX_OPTIONS_LEGS} aria-label={`Duplicate leg ${i + 1}`} onclick={e => act(e, () => add(i))}>Duplicate</button>
                <button type="button" aria-label={`${leg.enabled ? 'Disable' : 'Enable'} leg ${i + 1}`} onclick={e => act(e, () => editLeg(i, l => { l.enabled = !l.enabled; }))}>{leg.enabled ? 'Disable' : 'Enable'}</button>
                <button type="button" aria-expanded={details(i, leg)} aria-label={`Multiplier, IV and quotes for leg ${i + 1}`} onclick={e => act(e, () => toggle(i))}>Multiplier, IV &amp; quotes</button>
                <button type="button" disabled={draft.strategy.legs.length <= 1} aria-label={`Remove leg ${i + 1}`} onclick={e => act(e, () => remove(i))}>Remove</button>
              </div>
            </details>
          </td>
        </tr>
        {#if details(i, leg)}
          <tr class="more"><td colspan="6">
            {@render error(`legs.${i}.enabled`)}
            {#if option}
              <div class="detail-fields">
                {@render numeric('Multiplier · units', `legs.${i}.multiplier`, leg.multiplier, 1, 1000, '1', v => editLeg(i, l => editLegContract(l, { multiplier: v ?? NaN })))}
                {@render numeric('IV % · blank = base', `legs.${i}.implied_volatility`, leg.implied_volatility == null ? null : percentInput(leg.implied_volatility), 0, 500, 'any', v => editLeg(i, l => { l.implied_volatility = v == null ? null : fractionInput(v); }), true)}
              </div>
              <p class="quote-title">Manual quote inputs · unverified</p>
              <div class="detail-fields">
                {@render numeric('Manual bid · USD/unit', `legs.${i}.bid`, leg.bid, 0, 1000000, 'any', v => editLeg(i, l => { l.bid = v; }), true)}
                {@render numeric('Manual ask · USD/unit', `legs.${i}.ask`, leg.ask, 0, 1000000, 'any', v => editLeg(i, l => { l.ask = v; }), true)}
                <label class="field timestamp"><span>As of · ISO timestamp with timezone</span><input type="text" name={`legs.${i}.quote_as_of`} autocomplete="off" value={leg.quote_as_of ?? ''} maxlength="64" placeholder="2026-10-14T11:00:00Z" spellcheck="false"
                  aria-invalid={!!errors[`legs.${i}.quote_as_of`]} aria-describedby={errors[`legs.${i}.quote_as_of`] ? errorId(`legs.${i}.quote_as_of`) : undefined}
                  oninput={e => editLeg(i, l => { l.quote_as_of = e.currentTarget.value || null; })} />{@render error(`legs.${i}.quote_as_of`)}</label>
              </div>
              <p class="hint">Manually entered · unverified · not real-time. {manualQuoteAge(leg.quote_as_of)} Bid/ask spreads are not executable fills.</p>
              <button type="button" class="ot-workbench-ghost" aria-label={`Use midpoint as entry for leg ${i + 1}`} disabled={quoteMidpoint(leg) === null} onclick={() => onEdit(d => { useQuoteMidpoint(d, i); })}>Use midpoint as entry</button>
            {:else}
              <p class="hint">Shares use multiplier 1 and no strike.</p>{@render error(`legs.${i}.multiplier`)}
              {#if leg.strike !== null || leg.multiplier !== 1 || [leg.implied_volatility, leg.bid, leg.ask, leg.quote_as_of].some(v => v != null)}
                <button type="button" class="ot-workbench-ghost" aria-label={`Reset share fields for leg ${i + 1}`} onclick={() => editLeg(i, l => setLegKind(l, 'underlying', draft.spot))}>Reset share fields · clear option metadata</button>
              {/if}
            {/if}
          </td></tr>
        {/if}
      </tbody>
    {/each}
  </table>
  <p class="hint">Legs share one expiry; set per-leg expiries below for calendars and diagonals.</p>
</section>

<style>
  .leg-editor { container-type: inline-size; min-width: 0; display: grid; gap: 8px; color: oklch(var(--foreground)); font-family: var(--font-family-lato); font-size: 12px; }
  .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
  header { justify-content: space-between; }
  h3 { margin: 0; font-size: 12px; }
  h3 span { color: oklch(var(--muted-foreground)); font-variant-numeric: tabular-nums; }
  .templates { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 6px; }
  .chip { display: grid; gap: 4px; justify-items: start; min-height: 48px; padding: 6px 8px; border: 1px solid oklch(var(--border)); border-radius: 4px; background: oklch(var(--background)); color: oklch(var(--foreground)); font: inherit; text-align: left; cursor: pointer; }
  .chip svg { width: 100%; height: 18px; overflow: visible; }
  .chip path { fill: none; stroke: oklch(var(--muted-foreground)); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
  .chip:hover { border-color: oklch(var(--input)); }
  .chip[aria-pressed="true"] { border-color: oklch(var(--ring)); background: oklch(var(--accent)); }
  .chip[aria-pressed="true"] path { stroke: oklch(var(--foreground)); }
  .field { display: flex; flex-direction: column; gap: 5px; min-width: 0; line-height: 1.4; }
  input, select { box-sizing: border-box; width: 100%; min-width: 0; min-height: 30px; padding: 4px 6px; border: 1px solid oklch(var(--input)); border-radius: 4px; background: oklch(var(--background)); color: oklch(var(--foreground)); font: inherit; }
  input[type="number"] { font-variant-numeric: tabular-nums; text-align: right; }
  .chip:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible, button:focus-visible { outline: 2px solid oklch(var(--ring)); outline-offset: 2px; }
  [aria-invalid="true"] { border-color: oklch(var(--destructive)); }
  .field-error { display: block; font-size: 11px; color: oklch(var(--down-color)); line-height: 1.4; overflow-wrap: anywhere; }
  .hint { margin: 0; color: oklch(var(--muted-foreground)); line-height: 1.5; overflow-wrap: anywhere; }
  .legs { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .legs th { padding: 0 4px 6px; text-align: left; font-size: 11px; font-weight: 700; color: oklch(var(--muted-foreground)); white-space: nowrap; }
  .legs th:nth-child(1) { width: 52px; } .legs th:nth-child(2) { width: 56px; } .legs th:nth-child(3) { width: 78px; } .legs th:nth-child(6) { width: 32px; }
  .legs th.num { text-align: right; }
  .legs td { padding: 3px 4px; vertical-align: top; }
  .legs tbody + tbody tr:first-child td { border-top: 1px solid oklch(var(--border)); }
  .off > tr:first-child td:not([data-k="menu"]) { opacity: 0.55; }
  .off-tag { display: block; color: oklch(var(--muted-foreground)); font-size: 11px; }
  .side { width: 100%; min-height: 30px; border: 1px solid; border-radius: 4px; background: transparent; font: inherit; font-weight: 700; cursor: pointer; }
  .side.buy { color: oklch(var(--up-color)); border-color: oklch(var(--up-color)); }
  .side.sell { color: oklch(var(--down-color)); border-color: oklch(var(--down-color)); }
  .na { display: block; min-height: 30px; line-height: 30px; text-align: right; color: oklch(var(--muted-foreground)); }
  .premium-source { display: block; margin-top: 2px; color: oklch(var(--muted-foreground)); font-size: 11px; line-height: 1.4; text-align: right; }
  .premium-source.manual { color: oklch(var(--risk)); }
  .link { min-height: 0; padding: 0; border: 0; background: none; color: oklch(var(--ring)); font: inherit; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
  .menu { position: relative; }
  .menu summary { list-style: none; width: 28px; min-height: 30px; line-height: 28px; border: 1px solid transparent; border-radius: 4px; text-align: center; cursor: pointer; color: oklch(var(--muted-foreground)); }
  .menu summary::-webkit-details-marker { font-size: 0; }
  .menu summary:hover, .menu[open] summary { border-color: oklch(var(--border)); color: oklch(var(--foreground)); }
  .menu-items { position: absolute; right: 0; top: calc(100% + 4px); z-index: 4; display: grid; min-width: 168px; padding: 4px; border: 1px solid oklch(var(--border)); border-radius: 4px; background: oklch(var(--card)); box-shadow: 0 6px 18px rgb(0 0 0 / 0.25); }
  .menu-items button { min-height: 28px; padding: 4px 8px; border: 0; border-radius: 3px; background: none; color: oklch(var(--foreground)); font: inherit; text-align: left; cursor: pointer; }
  .menu-items button:hover:not(:disabled) { background: oklch(var(--accent)); }
  .menu-items button:disabled { color: oklch(var(--muted-foreground)); cursor: not-allowed; }
  .more td { padding: 4px 4px 10px; }
  .detail-fields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 6px 0; }
  .timestamp { grid-column: span 1; }
  .quote-title { margin: 8px 0 0; font-weight: 700; }
  .more button { margin-top: 6px; }
  button { white-space: normal; height: auto; overflow-wrap: anywhere; }
  @container (max-width: 380px) {
    .legs thead { position: absolute; width: 1px; height: 1px; clip-path: inset(50%); }
    .legs, .legs tbody { display: block; }
    .legs tbody > tr:first-child { display: grid; grid-template-columns: 56px minmax(0, 1fr) minmax(0, 1fr) 32px; grid-template-areas: "side qty type menu" ". strike prem ."; gap: 6px; padding: 8px 0; align-items: end; }
    .legs tbody > tr.more { display: block; }
    .legs td { padding: 0; }
    .legs tbody + tbody tr:first-child td { border-top: 0; }
    .legs tbody + tbody { border-top: 1px solid oklch(var(--border)); }
    td[data-k="side"] { grid-area: side; } td[data-k="qty"] { grid-area: qty; } td[data-k="type"] { grid-area: type; }
    td[data-k="strike"] { grid-area: strike; align-self: start; } td[data-k="prem"] { grid-area: prem; align-self: start; } td[data-k="menu"] { grid-area: menu; }
    td[data-label]::before { content: attr(data-label); display: block; margin-bottom: 2px; color: oklch(var(--muted-foreground)); font-size: 11px; }
    .detail-fields { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  }
  @media (pointer: coarse) { input, select, summary, .side, .menu-items button { min-height: var(--control-touch-height); } }
  @media (forced-colors: active) { .chip[aria-pressed="true"] { outline: 2px solid Highlight; } input, select, .side { border-color: CanvasText; } input:focus-visible, select:focus-visible, summary:focus-visible, button:focus-visible { outline-color: Highlight; } [aria-invalid="true"] { outline: 1px solid CanvasText; } }
</style>

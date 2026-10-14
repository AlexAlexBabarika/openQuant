<script lang="ts">
  import { clearCommonDates, commonDateHorizon, optionsEditorErrors, setCommonDate, type OptionsEditorProps } from '$lib/features/options/optionsLegEditor';
  let { draft, onEdit, fieldErrors = {} }: OptionsEditorProps = $props();
  const uid = $props.id();
  const errors = $derived({ ...optionsEditorErrors(draft), ...fieldErrors });
  const dated = $derived(draft.strategy.valuation_date != null || draft.strategy.expiry_date != null);
  const horizon = $derived(commonDateHorizon(draft.strategy.valuation_date, draft.strategy.expiry_date));
  const errorId = (key: string) => `${uid}-${key.replace(/\./g, '-')}-error`;
</script>

{#snippet error(key: string)}
  {#if errors[key]}<small id={errorId(key)} class="field-error">{errors[key]}</small>{/if}
{/snippet}
{#snippet numeric(label: string, key: string, value: number, min: number, max: number, update: (value: number) => void, disabled = false)}
  <label class="field"><span>{label}</span><input type="number" value={Number.isFinite(value) ? value : ''} {min} {max} step="any" {disabled}
    aria-invalid={!!errors[key]} aria-describedby={errors[key] ? errorId(key) : undefined}
    oninput={e => update(e.currentTarget.valueAsNumber)} />{@render error(key)}</label>
{/snippet}

<section class="assumptions" aria-label="Common options assumptions">
  <h3>Common contract &amp; assumptions</h3>
  <p class="hint">Manual / synthetic · European · cash-settled · USD. One common expiry, ACT/365. No provider lookup or live chain.</p>
  {@render error('strategy')}
  <label class="field"><span>Underlying identity · manual, optional (up to 80 characters)</span><input value={draft.strategy.underlying ?? ''} maxlength="80" placeholder="e.g. SPX · manual identifier"
    aria-invalid={!!errors['strategy.underlying']} aria-describedby={errors['strategy.underlying'] ? errorId('strategy.underlying') : undefined}
    oninput={e => onEdit(d => { d.strategy.underlying = e.currentTarget.value || null; })} />{@render error('strategy.underlying')}</label>
  <div class="inputs-grid">
    <label class="field"><span>Valuation date · UTC</span><input type="date" value={draft.strategy.valuation_date ?? ''} min="0001-01-01" max="9999-12-31"
      aria-invalid={!!errors['strategy.valuation_date']} aria-describedby={errors['strategy.valuation_date'] ? errorId('strategy.valuation_date') : undefined}
      oninput={e => onEdit(d => setCommonDate(d, 'valuation_date', e.currentTarget.value))} />{@render error('strategy.valuation_date')}</label>
    <label class="field"><span>Common expiry date · UTC</span><input type="date" value={draft.strategy.expiry_date ?? ''} min="0001-01-01" max="9999-12-31"
      aria-invalid={!!errors['strategy.expiry_date']} aria-describedby={errors['strategy.expiry_date'] ? errorId('strategy.expiry_date') : undefined}
      oninput={e => onEdit(d => setCommonDate(d, 'expiry_date', e.currentTarget.value))} />{@render error('strategy.expiry_date')}</label>
    {@render numeric('Common expiry · calendar days (0–3650)', 'strategy.days_to_expiry', draft.strategy.days_to_expiry, 0, 3650, v => onEdit(d => { d.strategy.days_to_expiry = v; }), dated)}
    {@render numeric('Spot · USD (>0–1m)', 'spot', draft.spot, 0, 1000000, v => onEdit(d => { d.spot = v; }))}
    {@render numeric('Base annual IV · fraction (0–5)', 'volatility', draft.volatility, 0, 5, v => onEdit(d => { d.volatility = v; }))}
    {@render numeric('Annual rate · fraction (−1–1)', 'rate', draft.rate, -1, 1, v => onEdit(d => { d.rate = v; }))}
    {@render numeric('Dividend yield · fraction (−1–1)', 'dividend_yield', draft.dividend_yield, -1, 1, v => onEdit(d => { d.dividend_yield = v; }))}
    {@render numeric('Entry fee · USD/contract (0–10k)', 'strategy.entry_fee_per_contract', draft.strategy.entry_fee_per_contract, 0, 10000, v => onEdit(d => { d.strategy.entry_fee_per_contract = v; }))}
  </div>
  {#if dated}
    <p class="hint">{horizon === null ? 'Date pair incomplete or invalid: correct both dates before analysis.' : `Paired dates define ${horizon} UTC calendar days; all enabled option legs use this expiry.`} Dates are user-declared, not market freshness. Expiry before valuation is invalid; past calendar dates may be hypothetical research, not historical execution.</p>
    <button type="button" class="ot-workbench-ghost" onclick={() => onEdit(clearCommonDates)}>Clear both dates · use days horizon</button>
  {:else}<p class="hint">Dates are optional. With both blank, use the legacy days horizon. Entering dates requires a valid pair and exactly matching UTC horizon; no silent clamping.</p>{/if}
  <p class="hint">0.20 IV = 20%; 0.03 rate = 3%. Option IV overrides resolve per leg. Fees are charged once per enabled absolute option quantity, not multiplied; no share fee. Scenario/surface times must remain within the common horizon.</p>
</section>

<style>
  .assumptions { container-type: inline-size; display: grid; gap: 8px; min-width: 0; color: oklch(var(--foreground)); font-family: var(--font-family-lato); font-size: 12px; }
  h3 { margin: 0; font-size: 12px; }
  .hint { margin: 0; color: oklch(var(--muted-foreground)); line-height: 1.5; overflow-wrap: anywhere; }
  .field { display: flex; flex-direction: column; gap: 5px; min-width: 0; line-height: 1.4; }
  .inputs-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  input { box-sizing: border-box; width: 100%; min-width: 0; min-height: 32px; border: 1px solid oklch(var(--input)); border-radius: 4px; background: oklch(var(--background)); color: oklch(var(--foreground)); padding: 5px 7px; font: inherit; }
  input[type="number"] { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
  input:focus-visible { outline: 2px solid oklch(var(--ring)); outline-offset: 2px; }
  input[aria-invalid="true"] { border-color: oklch(var(--destructive)); }
  .field-error { color: oklch(var(--down-color)); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
  button { justify-self: start; white-space: normal; height: auto; min-height: 28px; overflow-wrap: anywhere; }
  @container (min-width: 650px) { .inputs-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
  @container (max-width: 280px) { .inputs-grid { grid-template-columns: minmax(0, 1fr); } }
  @media (pointer: coarse) { button, input { min-height: var(--control-touch-height); } }
  @media (forced-colors: active) { input { border-color: CanvasText; } input:focus-visible { outline-color: Highlight; } input[aria-invalid="true"] { outline: 1px solid CanvasText; } }
</style>

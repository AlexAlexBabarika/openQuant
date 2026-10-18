<script lang="ts">
  import { clearCommonDates, commonDateHorizon, optionsEditorErrors, setCommonDate, type OptionsEditorProps } from '$lib/features/options/optionsLegEditor';
  import { addDays, fractionInput, localIsoDate, percentFieldError, percentInput } from '$lib/features/options/optionsInputs';
  import { formatPrice } from '$lib/features/options/optionsFormat';
  let { draft, onEdit, fieldErrors = {}, workspace, spotLinked = false, onSpot, onLink }: OptionsEditorProps & {
    /** The workspace chart's loaded symbol and last close; spot follows it while linked. */
    workspace?: { symbol: string | null; spot: number | null };
    spotLinked?: boolean;
    onSpot?: (spot: number) => void;
    onLink?: () => void;
  } = $props();
  const uid = $props.id();
  const errors = $derived({ ...optionsEditorErrors(draft), ...fieldErrors });
  const dated = $derived(draft.strategy.expiry_date != null);
  const horizon = $derived(commonDateHorizon(draft.strategy.valuation_date, draft.strategy.expiry_date));
  const pricingErrors = $derived(['strategy.valuation_date', 'rate', 'dividend_yield', 'strategy.entry_fee_per_contract', 'strategy.underlying'].some(k => errors[k]));
  const errorId = (key: string) => `${uid}-${key.replace(/\./g, '-')}-error`;
  const message = (key: string) => percentFieldError(key, errors[key]);

  function useDates() {
    onEdit(d => {
      const valuation = localIsoDate(new Date());
      d.strategy.valuation_date = valuation;
      d.strategy.expiry_date = addDays(valuation, d.strategy.days_to_expiry);
    });
  }
</script>

{#snippet error(key: string)}
  {#if message(key)}<small id={errorId(key)} class="field-error">{message(key)}</small>{/if}
{/snippet}
{#snippet numeric(label: string, key: string, value: number, min: number, max: number, update: (value: number) => void, disabled = false)}
  <label class="field"><span>{label}</span><input type="number" name={key} autocomplete="off" value={Number.isFinite(value) ? value : ''} {min} {max} step="any" {disabled}
    aria-invalid={!!errors[key]} aria-describedby={errors[key] ? errorId(key) : undefined}
    oninput={e => update(e.currentTarget.valueAsNumber)} />{@render error(key)}</label>
{/snippet}

<section class="assumptions" aria-label="Common options assumptions">
  <h3>Instrument &amp; assumptions</h3>
  {@render error('strategy')}
  <div class="inputs-grid">
    <div class="field">
      {@render numeric('Spot · USD', 'spot', draft.spot, 0, 1000000, v => onSpot ? onSpot(v) : onEdit(d => { d.spot = v; }))}
      {#if workspace?.spot != null && workspace.symbol}
        {#if spotLinked}<small class="hint">From the {workspace.symbol} chart</small>
        {:else}<button type="button" class="link" onclick={() => onLink?.()}>Use {workspace.symbol} {formatPrice(workspace.spot)}</button>{/if}
      {/if}
    </div>
    {#if dated}
      <div class="field">
        <label class="field"><span>Expiry</span><input type="date" name="strategy.expiry_date" value={draft.strategy.expiry_date ?? ''} min="0001-01-01" max="9999-12-31"
          aria-invalid={!!errors['strategy.expiry_date']} aria-describedby={errors['strategy.expiry_date'] ? errorId('strategy.expiry_date') : `${uid}-days`}
          oninput={e => onEdit(d => setCommonDate(d, 'expiry_date', e.currentTarget.value))} /></label>
        <small id={`${uid}-days`} class="hint">{horizon === null ? 'Choose a date on or after the valuation date.' : `${horizon} days`}</small>
        {@render error('strategy.expiry_date')}{@render error('strategy.days_to_expiry')}
      </div>
    {:else}
      <div class="field">
        {@render numeric('Expiry · days', 'strategy.days_to_expiry', draft.strategy.days_to_expiry, 0, 3650, v => onEdit(d => { d.strategy.days_to_expiry = v; }))}
        <button type="button" class="link" disabled={!Number.isInteger(draft.strategy.days_to_expiry)} onclick={useDates}>Use dates</button>
      </div>
    {/if}
    {@render numeric('IV · %', 'volatility', percentInput(draft.volatility), 0, 500, v => onEdit(d => { d.volatility = fractionInput(v); }))}
  </div>
  <details class="pricing" open={pricingErrors}>
    <summary>Pricing assumptions</summary>
    <div class="inputs-grid">
      {#if dated}
        <label class="field"><span>Valuation date</span><input type="date" name="strategy.valuation_date" value={draft.strategy.valuation_date ?? ''} min="0001-01-01" max="9999-12-31"
          aria-invalid={!!errors['strategy.valuation_date']} aria-describedby={errors['strategy.valuation_date'] ? errorId('strategy.valuation_date') : undefined}
          oninput={e => onEdit(d => setCommonDate(d, 'valuation_date', e.currentTarget.value))} />{@render error('strategy.valuation_date')}</label>
      {/if}
      {@render numeric('Interest rate · %', 'rate', percentInput(draft.rate), -100, 100, v => onEdit(d => { d.rate = fractionInput(v); }))}
      {@render numeric('Dividend yield · %', 'dividend_yield', percentInput(draft.dividend_yield), -100, 100, v => onEdit(d => { d.dividend_yield = fractionInput(v); }))}
      {@render numeric('Fee · USD per contract', 'strategy.entry_fee_per_contract', draft.strategy.entry_fee_per_contract, 0, 10000, v => onEdit(d => { d.strategy.entry_fee_per_contract = v; }))}
      <label class="field"><span>Underlying name · optional</span><input name="strategy.underlying" autocomplete="off" value={draft.strategy.underlying ?? ''} maxlength="80" placeholder="e.g. SPX…"
        aria-invalid={!!errors['strategy.underlying']} aria-describedby={errors['strategy.underlying'] ? errorId('strategy.underlying') : undefined}
        oninput={e => onEdit(d => { d.strategy.underlying = e.currentTarget.value || null; })} />{@render error('strategy.underlying')}</label>
    </div>
    {#if dated}
      <p class="hint">Dates are UTC calendar days and set the time to expiry for legs without their own expiry. Fees are charged once per option contract.</p>
      <button type="button" class="ot-workbench-ghost" onclick={() => onEdit(clearCommonDates)}>Use days instead of dates</button>
    {:else}<p class="hint">Fees are charged once per option contract. Per-leg expiries are set in the legs' expiry controls.</p>{/if}
  </details>
</section>

<style>
  .assumptions { container-type: inline-size; display: grid; gap: 8px; min-width: 0; color: oklch(var(--foreground)); font-family: var(--font-family-lato); font-size: 12px; }
  h3 { margin: 0; font-size: 12px; }
  .hint { margin: 0; color: oklch(var(--muted-foreground)); line-height: 1.5; overflow-wrap: anywhere; }
  .field { display: flex; flex-direction: column; gap: 5px; min-width: 0; line-height: 1.4; }
  .inputs-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; align-items: start; }
  input { box-sizing: border-box; width: 100%; min-width: 0; min-height: 32px; border: 1px solid oklch(var(--input)); border-radius: 4px; background: oklch(var(--background)); color: oklch(var(--foreground)); padding: 5px 7px; font: inherit; }
  input[type="number"] { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
  input:focus-visible, summary:focus-visible, button:focus-visible { outline: 2px solid oklch(var(--ring)); outline-offset: 2px; }
  input[aria-invalid="true"] { border-color: oklch(var(--destructive)); }
  .field-error { color: oklch(var(--down-color)); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
  button { justify-self: start; white-space: normal; height: auto; min-height: 28px; overflow-wrap: anywhere; }
  .link { align-self: start; min-height: 24px; padding: 0; border: 0; background: none; color: oklch(var(--ring)); font: inherit; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
  .link:disabled { color: oklch(var(--muted-foreground)); cursor: not-allowed; text-decoration: none; }
  .pricing { border-top: 1px solid oklch(var(--border)); padding-top: 4px; }
  .pricing > :not(summary) { margin-top: 8px; }
  summary { cursor: pointer; min-height: 28px; line-height: 28px; font-weight: 700; }
  @container (max-width: 340px) { .inputs-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @container (max-width: 220px) { .inputs-grid { grid-template-columns: minmax(0, 1fr); } }
  @media (pointer: coarse) { button, input, summary { min-height: var(--control-touch-height); } }
  @media (forced-colors: active) { input { border-color: CanvasText; } input:focus-visible { outline-color: Highlight; } input[aria-invalid="true"] { outline: 1px solid CanvasText; } .link { color: LinkText; } }
</style>

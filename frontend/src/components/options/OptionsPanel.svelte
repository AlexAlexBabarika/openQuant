<script lang="ts">
  import { onMount } from 'svelte';
  import { authState } from '$lib/features/auth/auth';
  import { OptionsState } from '$lib/features/options/optionsState.svelte';
  import { OPTIONS_TEMPLATES, spotGrid, templateStrategy, type OptionsTemplate } from '$lib/features/options/optionsTemplates';
  import type { OptionsDraft } from '$lib/features/options/optionsTypes';
  import OptionsCharts from './OptionsCharts.svelte';

  const options = new OptionsState();
  let panel: HTMLElement;
  let template = $state<OptionsTemplate>('long_call');
  let saveName = $state('');
  let savedIndex = $state('');
  let exportConfirm = $state(false);
  let scopeLabel = $state('Guest drafts · this browser');
  let gridStart = $state(50);
  let gridEnd = $state(150);
  let gridCount = $state(81);
  type Leg = OptionsDraft['strategy']['legs'][number];
  const result = $derived(options.result);

  function syncGrid() {
    gridStart = options.draft.spot_grid[0];
    gridEnd = options.draft.spot_grid[options.draft.spot_grid.length - 1];
    gridCount = options.draft.spot_grid.length;
  }
  onMount(() => {
    let previous: string | null | undefined;
    const unsubscribe = authState.subscribe(auth => {
      const id = auth.user?.id ?? null;
      if (id === previous) return;
      previous = id;
      options.setAccount(id);
      scopeLabel = id ? 'Account drafts · this browser' : 'Guest drafts · this browser';
      saveName = ''; savedIndex = ''; template = 'long_call'; exportConfirm = false;
      syncGrid();
    });
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key === 'Enter' && !event.isComposing && !panel.closest('[hidden]')) {
        event.preventDefault();
        event.stopPropagation();
        void options.run();
      }
    };
    panel.addEventListener('keydown', keydown);
    return () => { unsubscribe(); panel.removeEventListener('keydown', keydown); options.dispose(); };
  });

  function setTop(key: 'spot' | 'volatility' | 'rate' | 'dividend_yield', value: number) {
    options.editDraft(d => { d[key] = value; });
  }
  function setStrategy(key: 'days_to_expiry' | 'entry_fee_per_contract', value: number) {
    options.editDraft(d => { d.strategy[key] = value; });
  }
  function setLeg(index: number, update: (leg: Leg) => void) {
    options.editDraft(d => { update(d.strategy.legs[index]); d.strategy.template = 'custom'; });
  }
  function setKind(index: number, kind: Leg['kind']) {
    setLeg(index, l => {
      l.kind = kind;
      l.strike = kind === 'underlying' ? null : l.strike ?? options.draft.spot;
      l.multiplier = kind === 'underlying' ? 1 : 100;
    });
  }
  function applyTemplate() {
    options.editDraft(d => {
      d.strategy = {
        ...templateStrategy(template, Number.isFinite(d.spot) && d.spot > 0 ? d.spot : 100),
        days_to_expiry: d.strategy.days_to_expiry,
        entry_fee_per_contract: d.strategy.entry_fee_per_contract,
      };
    });
  }
  function updateGrid() {
    options.editDraft(d => {
      d.spot_grid = Number.isInteger(gridCount) && gridCount >= 2 && gridCount <= 201
        ? spotGrid(gridStart, gridEnd, gridCount) : [];
    });
  }
  function restoreDraft() {
    if (savedIndex === '') return;
    options.restore(Number(savedIndex));
    saveName = options.saved[Number(savedIndex)]?.name ?? '';
    exportConfirm = false;
    syncGrid();
  }
  async function copyPython() {
    try { await navigator.clipboard.writeText(options.source); options.notice = 'Python copied.'; }
    catch { options.notice = 'Clipboard is unavailable. Select and copy the Python text directly.'; }
  }
  const errorId = (key: string) => `options-error-${key.replace(/[^a-zA-Z0-9-]/g, '-')}`;
  function number(value: number | null, signed = false): string {
    if (value === null || !Number.isFinite(value)) return '—';
    return new Intl.NumberFormat('en-US', {
      maximumSignificantDigits: 6,
      notation: value !== 0 && Math.abs(value) < 0.0001 ? 'scientific' : 'standard',
      signDisplay: signed ? 'exceptZero' : 'auto',
    }).format(value);
  }
</script>

{#snippet error(key: string)}
  {#if options.fieldErrors[key]}
    <small id={errorId(key)} class="field-error">{options.fieldErrors[key]}</small>
  {/if}
{/snippet}
{#snippet numeric(label: string, key: string, value: number, min: number, max: number, step: string, update: (v: number) => void)}
  <label class="field">
    <span>{label}</span>
    <input type="number" value={Number.isFinite(value) ? value : ''} {min} {max} {step}
      aria-invalid={!!options.fieldErrors[key]} aria-describedby={options.fieldErrors[key] ? errorId(key + label) : undefined}
      oninput={e => update(e.currentTarget.valueAsNumber)} />
    {#if options.fieldErrors[key]}<small id={errorId(key + label)} class="field-error">{options.fieldErrors[key]}</small>{/if}
  </label>
{/snippet}

<section class="options-panel" aria-label="Options research" bind:this={panel}>
  <header class="panel-header">
    <div class="identity"><strong>Options research</strong><span>Manual / synthetic · European · cash-settled · USD</span></div>
    <div class="run-actions">
      <span class="shortcut">Ctrl+Enter</span>
      {#if options.loading}<button type="button" class="ot-workbench-ghost" onclick={() => options.cancel()}>Cancel</button>{/if}
      <button type="button" class="ot-workbench-primary" disabled={options.loading} onclick={() => options.run()}>
        {options.loading ? (result ? 'Refreshing…' : 'Analyzing…') : 'Analyze'}
      </button>
    </div>
  </header>
  <div class="panel-scroll">
    <p class="boundary">Theoretical analytics only. No provider snapshot, historical options execution, brokerage, American assignment or futures execution.</p>
    <div class="feedback" aria-live="polite" aria-atomic="true">
      {#if options.loading}<p>{result ? 'Refreshing analysis; previous submitted evidence remains below.' : 'Running bounded options analysis…'}</p>{/if}
      {#if options.notice}<p>{options.notice}</p>{/if}
      {#if options.stale}<p class="risk">Inputs changed. Charts and readouts are previous submitted evidence; Analyze to recalculate.</p>{/if}
    </div>
    {#if options.error}
      <div class="error-banner" role="alert"><span>{options.error}</span><button type="button" class="ot-workbench-ghost" disabled={options.loading} onclick={() => options.run()}>Retry current inputs</button></div>
    {/if}
    <div class="workbench-grid">
      <div class="editor-column">
        <div class="mode-row" role="group" aria-label="Options authoring mode">
          <button type="button" class="ot-workbench-ghost" aria-pressed={options.mode === 'editor'} onclick={() => options.setMode('editor')}>Editor</button>
          <button type="button" class="ot-workbench-ghost" aria-pressed={options.mode === 'python'} onclick={() => options.setMode('python')}>Python</button>
        </div>
        {#if options.mode === 'editor'}
          <div class="template-row">
            <label class="field"><span>Leg template</span><select bind:value={template}>{#each OPTIONS_TEMPLATES as [id, label]}<option value={id}>{label}</option>{/each}</select></label>
            <button type="button" class="ot-workbench-ghost" onclick={applyTemplate}>Replace legs</button>
          </div>
          <p class="hint">Synthetic premiums, not quotes. Templates replace legs explicitly; edited legs define the payoff, not safety or coverage.</p>
          <label class="field"><span>Strategy name</span><input value={options.draft.strategy.name} maxlength="120" aria-invalid={!!options.fieldErrors['strategy.name']} aria-describedby={options.fieldErrors['strategy.name'] ? errorId('strategy.name') : undefined} oninput={e => options.editDraft(d => { d.strategy.name = e.currentTarget.value; })} />{@render error('strategy.name')}</label>
          <div class="inputs-grid assumptions">
            {@render numeric('Spot · USD (0–1m, >0)', 'spot', options.draft.spot, 0, 1000000, 'any', v => setTop('spot', v))}
            {@render numeric('Expiry · days (0–3650)', 'strategy.days_to_expiry', options.draft.strategy.days_to_expiry, 0, 3650, 'any', v => setStrategy('days_to_expiry', v))}
            {@render numeric('Annual IV · fraction (0–5)', 'volatility', options.draft.volatility, 0, 5, 'any', v => setTop('volatility', v))}
            {@render numeric('Annual rate · fraction (−1–1)', 'rate', options.draft.rate, -1, 1, 'any', v => setTop('rate', v))}
            {@render numeric('Dividend yield · fraction (−1–1)', 'dividend_yield', options.draft.dividend_yield, -1, 1, 'any', v => setTop('dividend_yield', v))}
            {@render numeric('Entry fee · USD/contract (0–10k)', 'strategy.entry_fee_per_contract', options.draft.strategy.entry_fee_per_contract, 0, 10000, 'any', v => setStrategy('entry_fee_per_contract', v))}
          </div>
          <p class="hint">0.20 IV = 20%; 0.03 rate = 3%. ACT/365 calendar days. One entry fee per enabled option contract, including sells; no multiplier on fees or stock fee.</p>
          <div class="section-title"><h3>Legs <span>{options.draft.strategy.legs.length}/16</span></h3><button type="button" class="ot-workbench-ghost" disabled={options.draft.strategy.legs.length >= 16} onclick={() => options.editDraft(d => { d.strategy.template = 'custom'; d.strategy.legs.push({ kind: 'call', quantity: 1, strike: d.spot, entry_premium: 0, multiplier: 100, enabled: true }); })}>Add leg</button></div>
          {@render error('legs')}
          {#each options.draft.strategy.legs as leg, i}
            <fieldset class="leg-card">
              <legend>Leg {i + 1} · {Number.isFinite(leg.quantity) && leg.quantity !== 0 ? (leg.quantity > 0 ? 'BUY / LONG' : 'SELL / SHORT') : 'SET QUANTITY'}{!leg.enabled ? ' · disabled' : ''}</legend>
              <div class="leg-actions">
                <label class="check"><input type="checkbox" checked={leg.enabled} onchange={e => setLeg(i, l => { l.enabled = e.currentTarget.checked; })} />Enabled</label>
                <button type="button" class="ot-workbench-ghost" aria-label={`Remove leg ${i + 1}`} disabled={options.draft.strategy.legs.length === 1} onclick={() => options.editDraft(d => { d.strategy.legs.splice(i, 1); d.strategy.template = 'custom'; })}>Remove</button>
              </div>
              <div class="inputs-grid">
                <label class="field"><span>Instrument</span><select value={leg.kind} onchange={e => setKind(i, e.currentTarget.value as Leg['kind'])}><option value="call">Call</option><option value="put">Put</option><option value="underlying">Underlying shares</option></select></label>
                {@render numeric(`Signed ${leg.kind === 'underlying' ? 'shares (±1m)' : 'contracts (±10k)'}`, `legs.${i}.quantity`, leg.quantity, leg.kind === 'underlying' ? -1000000 : -10000, leg.kind === 'underlying' ? 1000000 : 10000, '1', v => setLeg(i, l => { l.quantity = v; }))}
                {#if leg.kind !== 'underlying'}
                  {@render numeric('Strike · USD (>0–1m)', `legs.${i}.strike`, leg.strike!, 0, 1000000, 'any', v => setLeg(i, l => { l.strike = v; }))}
                {:else}<div class="field"><span>Strike</span><span class="not-applicable">Not applicable</span></div>{/if}
                {@render numeric(leg.kind === 'underlying' ? 'Entry price · USD/share' : 'Premium · USD/unit (0–1m)', `legs.${i}.entry_premium`, leg.entry_premium, 0, 1000000, 'any', v => setLeg(i, l => { l.entry_premium = v; }))}
                {#if leg.kind !== 'underlying'}
                  {@render numeric('Multiplier · units (1–1000)', `legs.${i}.multiplier`, leg.multiplier, 1, 1000, '1', v => setLeg(i, l => { l.multiplier = v; }))}
                {:else}<div class="field"><span>Multiplier</span><span class="not-applicable">1 · shares</span></div>{/if}
              </div>
            </fieldset>
          {/each}
          <p class="hint">Positive quantity buys, negative sells; zero is invalid. Disabled legs remain editable and validated but contribute no costs, marks or Greeks.</p>
          <details class="configuration" open={options.draft.scenarios.length > 0 || !!options.fieldErrors.spot_grid}>
            <summary>Scenario &amp; chart range controls</summary>
            <p class="hint">Display grid only; expiry risk and breakevens cover all nonnegative spots, even outside this range.</p>
            <div class="inputs-grid">
              {@render numeric('Grid start · USD (0–1m)', 'spot_grid', gridStart, 0, 1000000, 'any', v => { gridStart = v; updateGrid(); })}
              {@render numeric('Grid end · USD (0–1m)', 'spot_grid', gridEnd, 0, 1000000, 'any', v => { gridEnd = v; updateGrid(); })}
              {@render numeric('Grid points (2–201)', 'spot_grid', gridCount, 2, 201, '1', v => { gridCount = v; updateGrid(); })}
            </div>
            <div class="section-title"><h3>Scenarios <span>{options.draft.scenarios.length}/3</span></h3><button type="button" class="ot-workbench-ghost" disabled={options.draft.scenarios.length >= 3} onclick={() => options.editDraft(d => { let n = 1; while (d.scenarios.some(s => s.name === `Scenario ${n}`)) n++; d.scenarios.push({ name: `Scenario ${n}`, elapsed_days: 0, iv_shift_pp: 5 }); })}>Add scenario</button></div>
            {#each options.draft.scenarios as scenario, i}
              <fieldset class="leg-card"><legend>Scenario {i + 1}</legend>
                <label class="field"><span>Name · unique, up to 80 characters</span><input maxlength="80" value={scenario.name} aria-invalid={!!options.fieldErrors[`scenarios.${i}.name`]} aria-describedby={options.fieldErrors[`scenarios.${i}.name`] ? errorId(`scenarios.${i}.name`) : undefined} oninput={e => options.editDraft(d => { d.scenarios[i].name = e.currentTarget.value; })} />{@render error(`scenarios.${i}.name`)}</label>
                <div class="inputs-grid">
                  {@render numeric('Elapsed · days (≤ expiry)', `scenarios.${i}.elapsed_days`, scenario.elapsed_days, 0, options.draft.strategy.days_to_expiry, 'any', v => options.editDraft(d => { d.scenarios[i].elapsed_days = v; }))}
                  {@render numeric('IV shift · pp (−100–100)', `scenarios.${i}.iv_shift_pp`, scenario.iv_shift_pp, -100, 100, 'any', v => options.editDraft(d => { d.scenarios[i].iv_shift_pp = v; }))}
                </div>
                <button type="button" class="ot-workbench-ghost" onclick={() => options.editDraft(d => { d.scenarios.splice(i, 1); })} aria-label={`Remove scenario ${i + 1}`}>Remove scenario</button>
              </fieldset>
            {/each}
            <p class="hint">+5 pp shifts 20% IV to 25%. Elapsed days may reach expiry, never cross it. Shifted IV must stay within 0–500%.</p>
          </details>
        {:else}
          <label class="field python-field"><span>Options Python · up to 20,000 characters</span><textarea class="python-source" value={options.source} maxlength="20000" spellcheck="false" oninput={e => options.setSource(e.currentTarget.value)} aria-describedby="options-python-help"></textarea></label>
          <p id="options-python-help" class="hint">Set <code>result = analyze_options(request)</code>. The sandbox supplies <code>OptionLeg</code>, <code>OptionStrategy</code> and <code>analyze_options</code>; no arbitrary imports. Explicit Analyze runs this source, not the editor fields.</p>
          <button type="button" class="ot-workbench-ghost" onclick={copyPython}>Copy Python</button>
        {/if}
        <div class="export-controls">
          <button type="button" class="ot-workbench-ghost" onclick={() => { exportConfirm = true; }}>Replace Python from editor…</button>
          {#if exportConfirm}
            <p class="risk">This explicitly overwrites the current Python source. Switching modes never overwrites it.</p>
            <div class="mode-row"><button type="button" class="ot-workbench-primary" onclick={() => { if (options.exportPython()) exportConfirm = false; }}>Replace Python</button><button type="button" class="ot-workbench-ghost" onclick={() => { exportConfirm = false; }}>Keep source</button></div>
          {/if}
        </div>
        <details class="configuration">
          <summary>Named local drafts <span>{options.saved.length}/10</span></summary>
          <p class="hint">{scopeLabel}. Guest records are never adopted by an account. Browser-local, not encrypted or cloud-synced. Restore explicitly; saved drafts contain no results.</p>
          <label class="field"><span>Draft name · up to 120 characters</span><input bind:value={saveName} maxlength="120" /></label>
          <button type="button" class="ot-workbench-ghost" onclick={() => { options.save(saveName); }}>Save named draft</button>
          <label class="field"><span>Saved drafts · current scope</span><select bind:value={savedIndex}><option value="">Choose a draft…</option>{#each options.saved as saved, i}<option value={String(i)}>{saved.name} · {saved.updatedAt}</option>{/each}</select></label>
          <div class="mode-row"><button type="button" class="ot-workbench-ghost" disabled={savedIndex === ''} onclick={restoreDraft}>Restore selected draft</button><button type="button" class="ot-workbench-ghost" disabled={savedIndex === ''} onclick={() => { if (options.remove(Number(savedIndex))) savedIndex = ''; }}>Delete local draft</button></div>
        </details>
        {#if options.storageError}<p class="field-error storage-error" role="alert">{options.storageError}</p>{/if}
      </div>
      <div class="evidence-column" aria-busy={options.loading}>
        <OptionsCharts result={result} spot={options.draft.spot} />
        {#if result}
          <div class="evidence-heading"><h3>{result.request.strategy.name} · submitted evidence</h3><span>{options.stale ? 'STALE' : options.loading ? 'REFRESHING' : 'SUBMITTED'} · manual / synthetic</span></div>
          <dl class="summary-grid">
            <div><dt>Entry debit · USD</dt><dd>{number(result.summary.entry_debit)}</dd></div>
            <div><dt>Entry credit · USD</dt><dd>{number(result.summary.entry_credit)}</dd></div>
            <div><dt>Expiry max profit · USD</dt><dd>{result.summary.profit_unbounded ? 'Unbounded' : number(result.summary.max_profit)}</dd></div>
            <div><dt>Expiry max loss · USD</dt><dd>{result.summary.loss_unbounded ? 'Unbounded' : number(result.summary.max_loss)}</dd></div>
            <div><dt>Today theoretical P&amp;L · USD</dt><dd>{number(result.summary.pnl_today, true)}</dd></div>
            <div><dt>Entry fees · USD</dt><dd>{number(result.summary.entry_fees)}</dd></div>
          </dl>
          <p class="breakevens"><strong>Expiry breakevens · USD spot:</strong> {result.summary.breakevens.length ? result.summary.breakevens.map(v => number(v)).join(', ') : 'No isolated breakevens'}.</p>
          {#if result.summary.zero_intervals.length}<p class="breakevens"><strong>Zero-P&amp;L intervals · USD spot:</strong> {result.summary.zero_intervals.map(i => `${number(i.start)} to ${i.end === null ? '∞' : number(i.end)} (inclusive)`).join('; ')}.</p>{/if}
          <h3>Signed strategy Greeks · at submitted spot {number(result.request.spot)} USD</h3>
          <dl class="greeks-grid">
            {#each ['delta', 'gamma', 'theta', 'vega', 'rho'] as greek}
              {@const key = greek as keyof typeof result.greeks}
              <div><dt>{greek}</dt><dd>{number(result.greeks[key], true)}</dd><small>{result.greek_units[key]}</small></div>
            {/each}
          </dl>
          <p class="hint">Quantity × multiplier exposures, not per-contract Greeks. 6 significant digits; small nonzero values use scientific notation. — means undefined/not reported, never zero.</p>
          <details class="configuration submitted" open>
            <summary>Submitted assumptions &amp; provenance</summary>
            <p>Manual / synthetic · European · cash-settled · {result.request.strategy.currency}. BSM {result.model.version} · {result.model.day_basis} · no stock-provider data.</p>
            <dl class="summary-grid assumptions-readout">
              <div><dt>Spot · USD</dt><dd>{number(result.request.spot)}</dd></div><div><dt>Expiry · calendar days</dt><dd>{number(result.request.strategy.days_to_expiry)}</dd></div>
              <div><dt>Annual IV · %</dt><dd>{number(result.request.volatility * 100)}</dd></div><div><dt>Annual rate · %</dt><dd>{number(result.request.rate * 100)}</dd></div>
              <div><dt>Dividend yield · %</dt><dd>{number(result.request.dividend_yield * 100)}</dd></div><div><dt>Fee · USD/option contract</dt><dd>{number(result.request.strategy.entry_fee_per_contract)}</dd></div>
            </dl>
            <ul class="submitted-legs">{#each result.request.strategy.legs as leg, i}<li>Leg {i + 1}: {leg.quantity > 0 ? 'Buy' : 'Sell'} {number(Math.abs(leg.quantity))} {leg.kind === 'underlying' ? 'shares' : `${leg.kind} contracts`} · strike {leg.strike === null ? 'n/a' : `${number(leg.strike)} USD`} · entry {number(leg.entry_premium)} USD/unit · multiplier {leg.multiplier} · {leg.enabled ? 'enabled' : 'disabled'}</li>{/each}</ul>
            <p class="hint">Display grid: {number(result.spot_grid[0])}–{number(result.spot_grid[result.spot_grid.length - 1])} USD · {result.spot_grid.length} points. Expiry maximum risk/reward is not clipped to this range.</p>
            {#each result.scenarios as scenario, i}
              <p class="hint">{scenario.name}: +{number(scenario.elapsed_days)} days elapsed · {number(scenario.remaining_days)} days remaining · IV shift {number(result.request.scenarios[i].iv_shift_pp, true)} pp · resolved IV {number(scenario.volatility * 100)}%. Greeks below use the same submitted spot.</p>
              <dl class="greeks-grid">{#each ['delta', 'gamma', 'theta', 'vega', 'rho'] as greek}{@const key = greek as keyof typeof scenario.greeks}<div><dt>{scenario.name} · {greek}</dt><dd>{number(scenario.greeks[key], true)}</dd><small>{result.greek_units[key]}</small></div>{/each}</dl>
            {/each}
            {#if options.submittedSource !== null}<details><summary>Submitted Python source</summary><pre class="submitted-source">{options.submittedSource}</pre></details>{/if}
          </details>
          <ul class="warnings">{#each result.warnings as warning}<li>{warning}</li>{/each}</ul>
        {:else}<p class="empty-state">Choose a synthetic template or enter manual legs, then Analyze. No analysis runs automatically.</p>{/if}
      </div>
    </div>
  </div>
</section>

<style>
  .options-panel { display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0; color: oklch(var(--foreground)); background: oklch(var(--card)); font-family: var(--font-family-lato); font-size: 12px; }
  .panel-header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; border-bottom: 1px solid oklch(var(--border)); flex: none; }
  .identity { display: grid; gap: 4px; min-width: 0; }
  .identity strong { font-size: 13px; }
  .identity span, .shortcut, .hint, .boundary, .feedback, .evidence-heading span { color: oklch(var(--muted-foreground)); }
  .identity span { font-family: var(--font-mono); font-size: 11px; }
  .run-actions, .mode-row, .section-title, .leg-actions, .template-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .panel-scroll { min-height: 0; flex: 1; overflow: auto; padding: 12px; scrollbar-gutter: stable; }
  p { line-height: 1.5; margin: 8px 0; overflow-wrap: anywhere; }
  .boundary { margin-top: 0; }
  .workbench-grid { display: grid; grid-template-columns: minmax(260px, 340px) minmax(0, 1fr); gap: 16px; align-items: start; }
  .editor-column, .evidence-column { min-width: 0; }
  .editor-column { display: grid; gap: 8px; }
  .mode-row button[aria-pressed="true"] { background: oklch(var(--accent)); box-shadow: inset 0 -2px oklch(var(--primary)); }
  .field { display: flex; flex-direction: column; gap: 5px; min-width: 0; color: oklch(var(--foreground)); }
  .field > span:first-child { line-height: 1.4; }
  input:not([type="checkbox"]), select, textarea { width: 100%; min-width: 0; box-sizing: border-box; border: 1px solid oklch(var(--input)); border-radius: 4px; background: oklch(var(--background)); color: oklch(var(--foreground)); padding: 5px 7px; font: inherit; }
  input:not([type="checkbox"]), select { min-height: 32px; }
  input[type="number"] { font-family: var(--font-mono); font-size: 12px; font-variant-numeric: tabular-nums; }
  input[type="checkbox"] { accent-color: oklch(var(--primary)); width: 16px; height: 16px; }
  input:focus-visible, select:focus-visible, textarea:focus-visible, summary:focus-visible { outline: 2px solid oklch(var(--ring)); outline-offset: 2px; }
  input[aria-invalid="true"] { border-color: oklch(var(--destructive)); }
  .field-error { color: oklch(var(--down-color)); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
  .inputs-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .template-row .field { flex: 1 1 190px; }
  .template-row button { align-self: end; }
  .hint { font-size: 12px; margin: 0; }
  .section-title { justify-content: space-between; }
  h3 { font-size: 12px; font-weight: 700; margin: 8px 0; overflow-wrap: anywhere; }
  h3 span, summary span { color: oklch(var(--muted-foreground)); font-family: var(--font-mono); margin-left: 4px; }
  .leg-card { margin: 0; min-width: 0; padding: 8px; border: 1px solid oklch(var(--border)); border-radius: 4px; }
  legend { padding: 0 4px; font-family: var(--font-mono); font-size: 11px; }
  .leg-actions { justify-content: space-between; margin-bottom: 8px; }
  .check { display: inline-flex; align-items: center; gap: 6px; min-height: 28px; }
  .not-applicable { font-family: var(--font-mono); color: oklch(var(--muted-foreground)); min-height: 32px; display: flex; align-items: center; }
  .configuration { border-top: 1px solid oklch(var(--border)); padding-top: 8px; }
  summary { cursor: pointer; min-height: 28px; line-height: 28px; }
  .configuration > :not(summary) { margin-top: 8px; }
  .python-source { font-family: var(--font-mono); font-size: 12px; line-height: 1.6; min-height: 320px; resize: vertical; tab-size: 4; white-space: pre; overflow: auto; }
  code, .submitted-source { font-family: var(--font-mono); }
  .export-controls { display: grid; gap: 6px; padding-top: 8px; border-top: 1px solid oklch(var(--border)); }
  .risk { color: oklch(var(--risk)); }
  .error-banner { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; border: 1px solid oklch(var(--destructive)); padding: 8px; margin: 8px 0; color: oklch(var(--down-color)); overflow-wrap: anywhere; }
  .evidence-heading { margin: 12px 0 8px; }
  .evidence-heading span { font-family: var(--font-mono); font-size: 11px; }
  .summary-grid, .greeks-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(135px, 1fr)); gap: 8px; margin: 8px 0; }
  .summary-grid > div, .greeks-grid > div { min-width: 0; border: 1px solid oklch(var(--border)); padding: 8px; border-radius: 4px; }
  dt { color: oklch(var(--muted-foreground)); line-height: 1.5; }
  dd { font-family: var(--font-mono); font-variant-numeric: tabular-nums; margin: 4px 0 0; font-size: 14px; overflow-wrap: anywhere; }
  .greeks-grid small { display: block; margin-top: 5px; color: oklch(var(--muted-foreground)); font-size: 12px; line-height: 1.5; }
  .breakevens { font-family: var(--font-mono); line-height: 1.7; }
  .submitted-legs, .warnings { padding-left: 18px; overflow-wrap: anywhere; line-height: 1.6; }
  .submitted-legs li, .warnings li { margin: 6px 0; }
  .warnings { color: oklch(var(--muted-foreground)); }
  .submitted-source { max-height: 320px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; border: 1px solid oklch(var(--border)); padding: 8px; background: oklch(var(--background)); }
  .empty-state { color: oklch(var(--muted-foreground)); padding: 16px 0; }
  @media (max-width: 1000px) { .workbench-grid { grid-template-columns: minmax(240px, 300px) minmax(0, 1fr); gap: 12px; } }
  @media (max-width: 760px) { .workbench-grid { grid-template-columns: minmax(0, 1fr); } .evidence-column { grid-row: 1; } .panel-header, .panel-scroll { padding: 8px; } .shortcut { display: none; } .identity { flex: 1 1 210px; } }
  @media (forced-colors: active) { input, select, textarea, .leg-card, .summary-grid > div, .greeks-grid > div { border-color: CanvasText; } .mode-row button[aria-pressed="true"] { outline: 1px solid Highlight; } input:focus-visible, select:focus-visible, textarea:focus-visible, summary:focus-visible { outline-color: Highlight; } }
</style>

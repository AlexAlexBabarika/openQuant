<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { authState } from '$lib/features/auth/auth';
  import { getSessionGeneration } from '$lib/core/api';
  import { OptionsState } from '$lib/features/options/optionsState.svelte';
  import { spotGrid } from '$lib/features/options/optionsTemplates';
  import { exactValue } from '$lib/features/options/optionsChart';
  import { formatGreek, formatPrice } from '$lib/features/options/optionsFormat';
  import { modelUnitPrices } from '$lib/features/options/optionsPricing';
  import OptionsCharts from './OptionsCharts.svelte';
  import OptionsSummary from './OptionsSummary.svelte';
  import OptionsLegEditor from './OptionsLegEditor.svelte';
  import OptionsAssumptionsEditor from './OptionsAssumptionsEditor.svelte';
  import OptionsPythonEditor from './OptionsPythonEditor.svelte';
  import OptionsScenarioLab from './OptionsScenarioLab.svelte';
  import OptionsLibrary from './OptionsLibrary.svelte';
  import OptionsComparison from './OptionsComparison.svelte';
  import OptionsExpiryEditor from './OptionsExpiryEditor.svelte';
  import OptionsResearchTools from './OptionsResearchTools.svelte';

  let { workspaceSymbol = null, workspaceSpot = null }: {
    /** The workspace chart's loaded symbol and last close; spot follows them until typed. */
    workspaceSymbol?: string | null;
    workspaceSpot?: number | null;
  } = $props();
  const options = new OptionsState(undefined, undefined, 300);
  const statusLabel = {
    editor: { idle: 'Updating…', pending: 'Updating…', updating: 'Updating…', current: 'Up to date', invalid: 'Fix highlighted inputs', error: 'Analysis failed' },
    python: { idle: 'Not run yet', pending: 'Source changed', updating: 'Running…', current: 'Up to date', invalid: 'Source changed', error: 'Run failed' },
  } as const;
  let panel: HTMLElement;
  let exportConfirm = $state(false);
  let scopeLabel = $state('Guest drafts · this browser');
  let gridStart = $state(50);
  let gridEnd = $state(150);
  let gridCount = $state(81);
  let sessionKey = $state('guest');
  const result = $derived(options.result);
  const toolKey = $derived(`${sessionKey}:${options.documentKey}:${options.mode}`);
  const terminalAvailable = $derived(result?.horizon?.kind !== 'mixed_expiry' && result?.horizon?.exact_terminal_available !== false);
  const submittedPython = $derived(options.mode === 'python' && result !== null && options.submittedSource !== null && options.source === options.submittedSource);

  function syncGrid() {
    gridStart = options.draft.spot_grid[0];
    gridEnd = options.draft.spot_grid[options.draft.spot_grid.length - 1];
    gridCount = options.draft.spot_grid.length;
  }
  onMount(() => {
    let previous: string | null | undefined;
    const unsubscribe = authState.subscribe(auth => {
      const id = auth.user?.id ?? null;
      sessionKey = `${id ?? 'guest'}:${getSessionGeneration()}`;
      if (id === previous) return;
      previous = id;
      options.setAccount(id);
      scopeLabel = id ? 'Account drafts · this browser' : 'Guest drafts · this browser';
      exportConfirm = false;
      syncGrid();
    });
    const keydown = (event: KeyboardEvent) => {
      if (!event.defaultPrevented && (event.ctrlKey || event.metaKey) && !event.altKey && event.key === 'Enter' && !event.isComposing && !panel.closest('[hidden]')) {
        event.preventDefault();
        event.stopPropagation();
        void options.run();
      }
    };
    panel.addEventListener('keydown', keydown);
    return () => { unsubscribe(); panel.removeEventListener('keydown', keydown); options.dispose(); };
  });

  $effect(() => { options.documentKey; untrack(syncGrid); });
  $effect(() => { const symbol = workspaceSymbol, spot = workspaceSpot; untrack(() => options.syncWorkspace(symbol, spot)); });
  $effect(() => { if (options.gridAuto) { options.draft.spot_grid; untrack(syncGrid); } });

  function updateGrid() {
    options.setGrid(Number.isInteger(gridCount) && gridCount >= 2 && gridCount <= 201
      ? spotGrid(gridStart, gridEnd, gridCount) : []);
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
      <span class="status" data-status={options.status} role="status"><i aria-hidden="true"></i><span>{statusLabel[options.mode][options.status]}</span></span>
      {#if options.mode === 'python'}<span class="shortcut">Ctrl+Enter</span>{/if}
      {#if options.loading}<button type="button" class="ot-workbench-ghost" onclick={() => options.cancel()}>Cancel</button>{/if}
    </div>
  </header>
  <div class="panel-scroll">
    <p class="boundary">Theoretical European cash-settled analytics only. Optional authenticated read-only Tradier observations require explicit hypothetical conversion; real US exercise and physical delivery are not modeled. No historical options execution, brokerage or futures execution.</p>
    <div class="feedback" aria-live="polite" aria-atomic="true">
      {#if options.notice}<p>{options.notice}</p>{/if}
      {#if options.stale && options.mode === 'python'}<p class="risk">Source changed. The charts show the last run; Run to update them.</p>{/if}
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
          <OptionsAssumptionsEditor draft={options.draft} onEdit={update => options.editDraft(update)} fieldErrors={options.fieldErrors}
            workspace={options.workspace} spotLinked={options.spotLinked} onSpot={spot => options.setSpot(spot)} onLink={() => options.linkWorkspace()} />
          <OptionsLegEditor draft={options.draft} onEdit={update => options.editDraft(update)} fieldErrors={options.fieldErrors}
            canUndo={options.canUndo} canRedo={options.canRedo}
            onUndo={() => { options.undo(); syncGrid(); }} onRedo={() => { options.redo(); syncGrid(); }}
            onTemplate={template => options.applyTemplate(template)}
            legs={{ add: copyIndex => options.addLeg(copyIndex), remove: index => options.removeLeg(index), move: (index, direction) => options.moveLeg(index, direction) }}
            modelLegs={options.modelLegs} modelPrices={result && !options.stale ? modelUnitPrices(result) : []} onUseModel={index => options.useModelPremium(index)} />
          <details class="configuration"><summary>Per-leg expiries · calendar / diagonal construction</summary>
            {#key toolKey}<OptionsExpiryEditor draft={options.draft} onEdit={update => options.editDraft(update)} documentKey={toolKey} />{/key}
          </details>
          <details class="configuration" open={!!options.fieldErrors.spot_grid}>
            <summary>Price-domain chart grid</summary>
            <p class="hint">Display grid only; common-expiry risk and breakevens cover all nonnegative spots, even outside this range. Mixed-expiry terminal risk is unavailable.</p>
            <p class="hint">{options.gridAuto ? 'Fitted to strikes, spot and breakevens.' : 'Manual grid.'} <button type="button" class="ot-workbench-ghost" disabled={options.gridAuto} onclick={() => options.fitGrid()}>Fit to strikes</button></p>
            <div class="inputs-grid">
              {@render numeric('Grid start · USD (0–1m)', 'spot_grid', gridStart, 0, 1000000, 'any', v => { gridStart = v; updateGrid(); })}
              {@render numeric('Grid end · USD (0–1m)', 'spot_grid', gridEnd, 0, 1000000, 'any', v => { gridEnd = v; updateGrid(); })}
              {@render numeric('Grid points (2–201)', 'spot_grid', gridCount, 2, 201, '1', v => { gridCount = v; updateGrid(); })}
            </div>
          </details>
          <OptionsScenarioLab draft={options.draft} {result} onEdit={update => options.editDraft(update)} />
        {:else}
          <OptionsPythonEditor source={options.source} onChange={source => options.setSource(source)}
            onRun={() => { void options.run(); }} pending={options.loading} stdout={options.stdout ?? ''}
            error={options.error} documentKey={options.documentKey} />
        {/if}
        {#key toolKey}
          {#if options.mode === 'editor'}
            <OptionsResearchTools draft={options.draft} onEdit={update => options.editDraft(update)} documentKey={toolKey} />
          {:else if submittedPython && result}
            {#key result}<OptionsResearchTools draft={result.request} onEdit={() => {}} documentKey={toolKey} readOnly />{/key}
          {:else}<p class="hint">Analyze the current Python source to inspect its submitted request read-only. Research tools never use the visual draft in Python mode.</p>{/if}
        {/key}
        <div class="export-controls">
          <button type="button" class="ot-workbench-ghost" onclick={() => { exportConfirm = true; }}>Replace Python from editor…</button>
          {#if exportConfirm}
            <p class="risk">This explicitly overwrites the current Python source. Switching modes never overwrites it.</p>
            <div class="mode-row"><button type="button" class="ot-workbench-primary" onclick={() => { if (options.exportPython()) exportConfirm = false; }}>Replace Python</button><button type="button" class="ot-workbench-ghost" onclick={() => { exportConfirm = false; }}>Keep source</button></div>
          {/if}
        </div>
        <p class="hint">{scopeLabel}. Browser-local only; guest records are never adopted by an account.</p>
        <OptionsLibrary state={options} />
      </div>
      <div class="evidence-column" aria-busy={options.loading}>
        {#if result}<OptionsSummary {result} stale={options.stale} pending={options.loading} />{/if}
        {#key toolKey}<OptionsCharts {result} spot={options.mode === 'editor' ? options.draft.spot : result?.request.spot} draft={options.mode === 'editor' ? options.draft : undefined} onEdit={update => options.editDraft(update)} documentKey={toolKey} readOnly={options.mode === 'python'} onFit={options.mode === 'editor' ? () => options.fitGrid() : undefined} />{/key}
        {#if options.mode === 'python' && result}
          <OptionsScenarioLab draft={result.request} {result} onEdit={() => {}} readOnly />
        {/if}
        {#if result}<button type="button" class="ot-workbench-ghost" disabled={options.comparisons.length >= 3} onclick={() => options.pin()}>Pin submitted analysis for comparison</button>{/if}
        <OptionsComparison items={options.comparisons} onRemove={id => options.unpin(id)} />
        {#if result}
          <div class="evidence-heading"><h3>{result.request.strategy.name} · submitted evidence</h3><span>{options.stale ? 'STALE' : options.loading ? 'REFRESHING' : 'SUBMITTED'} · manual / synthetic</span></div>
          {#if terminalAvailable}<p class="breakevens"><strong>Expiry breakevens · USD spot:</strong> {result.summary.breakevens.length ? result.summary.breakevens.map(v => formatPrice(v)).join(', ') : 'No isolated breakevens'}.</p>
          {:else}<p class="risk">Mixed-expiry horizon: exact terminal payoff, maxima, breakevens and zero intervals are unavailable. First-expiry marks are not terminal risk limits. Use lifecycle research for settlement transitions.</p>{/if}
          {#if result.summary.zero_intervals.length}<p class="breakevens"><strong>Zero-P&amp;L intervals · USD spot:</strong> {result.summary.zero_intervals.map(i => `${number(i.start)} to ${i.end === null ? '∞' : number(i.end)} (inclusive)`).join('; ')}.</p>{/if}
          <h3>Signed strategy Greeks · at submitted spot {number(result.request.spot)} USD</h3>
          <dl class="greeks-grid">
            {#each ['delta', 'gamma', 'theta', 'vega', 'rho'] as greek}
              {@const key = greek as keyof typeof result.greeks}
              <div><dt>{greek}</dt><dd title={exactValue(result.greeks[key])}>{formatGreek(result.greeks[key], { signed: true })}</dd><small>{result.greek_units[key]}</small></div>
            {/each}
          </dl>
          <p class="hint">Quantity × multiplier exposures, not per-contract Greeks. 4 significant figures; hover for the exact value. Unavailable means undefined or not reported, never zero.</p>
          <details class="configuration submitted" open>
            <summary>Submitted assumptions &amp; provenance</summary>
            <p>Manual / synthetic · European · cash-settled · {result.request.strategy.currency}. BSM {result.model.version} · {result.model.day_basis} · no stock-provider data.</p>
            <dl class="summary-grid assumptions-readout">
              <div><dt>Spot · USD</dt><dd>{number(result.request.spot)}</dd></div><div><dt>Default expiry · calendar days</dt><dd>{number(result.request.strategy.days_to_expiry)}</dd></div>
              <div><dt>Declared base IV · %</dt><dd>{number(result.request.volatility * 100)}</dd></div><div><dt>Annual rate · %</dt><dd>{number(result.request.rate * 100)}</dd></div>
              <div><dt>Dividend yield · %</dt><dd>{number(result.request.dividend_yield * 100)}</dd></div><div><dt>Fee · USD/option contract</dt><dd>{number(result.request.strategy.entry_fee_per_contract)}</dd></div>
            </dl>
            <ul class="submitted-legs">{#each result.request.strategy.legs as leg, i}<li>Leg {i + 1}: {leg.quantity > 0 ? 'Buy' : 'Sell'} {number(Math.abs(leg.quantity))} {leg.kind === 'underlying' ? 'shares' : `${leg.kind} contracts`} · strike {leg.strike === null ? 'n/a' : `${number(leg.strike)} USD`} · entry {number(leg.entry_premium)} USD/unit · multiplier {leg.multiplier} · {leg.enabled ? 'enabled' : 'disabled'}
              {#if leg.kind !== 'underlying'}<span> · expiry override {leg.days_to_expiry == null ? 'inherits default days' : `${number(leg.days_to_expiry)} days`} / {leg.expiry_date ?? 'no date override'}</span>{/if}
              {#if leg.source}<p class="hint">Original contract observation: {leg.source.provider} / {leg.source.environment} / {leg.source.contract_symbol}. Observed exercise / delivery: {leg.source.observed_exercise_style ?? 'unknown'} / {leg.source.observed_settlement ?? 'unknown'}. Bid as of {leg.source.bid_as_of ?? 'unavailable'}; ask as of {leg.source.ask_as_of ?? 'unavailable'}; fetched {leg.source.fetched_at}. Hypothetical conversion only; edits do not refresh original-contract quotes.</p>{/if}
            </li>{/each}</ul>
            <p class="hint">Display grid: {number(result.spot_grid[0])}–{number(result.spot_grid[result.spot_grid.length - 1])} USD · {result.spot_grid.length} points. {terminalAvailable ? 'Exact expiry maximum risk/reward is not clipped to this range.' : 'Mixed-expiry first-horizon marks are not exact terminal payoff or risk limits.'}</p>
            {#each result.scenarios as scenario, i}
              <p class="hint">{scenario.name}: +{number(scenario.elapsed_days)} days elapsed · {number(scenario.remaining_days)} days remaining · IV shift {number(result.request.scenarios[i].iv_shift_pp, true)} pp · declared base IV {number(scenario.volatility * 100)}%. Per-leg overrides shift in parallel. Greeks below use the same submitted spot.</p>
              <dl class="greeks-grid">{#each ['delta', 'gamma', 'theta', 'vega', 'rho'] as greek}{@const key = greek as keyof typeof scenario.greeks}<div><dt>{scenario.name} · {greek}</dt><dd title={exactValue(scenario.greeks[key])}>{formatGreek(scenario.greeks[key], { signed: true })}</dd><small>{result.greek_units[key]}</small></div>{/each}</dl>
            {/each}
            {#if options.submittedSource !== null}<details><summary>Submitted Python source</summary><pre class="submitted-source">{options.submittedSource}</pre></details>{/if}
          </details>
          <ul class="warnings">{#each result.warnings as warning}<li>{warning}</li>{/each}</ul>
        {:else}<p class="empty-state">{options.mode === 'editor' ? 'Choose a template or enter legs; the analysis updates as you edit.' : 'Run the Python source to see its analysis. Python never runs by itself.'}</p>{/if}
      </div>
    </div>
  </div>
</section>

<style>
  .options-panel { container-type: inline-size; display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0; color: oklch(var(--foreground)); background: oklch(var(--card)); font-family: var(--font-family-lato); font-size: 12px; }
  .panel-header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; border-bottom: 1px solid oklch(var(--border)); flex: none; }
  .identity { display: grid; gap: 4px; min-width: 0; }
  .identity strong { font-size: 13px; }
  .identity span, .shortcut, .hint, .boundary, .feedback, .evidence-heading span { color: oklch(var(--muted-foreground)); }
  .identity span { font-family: var(--font-mono); font-size: 11px; }
  .status { display: inline-flex; align-items: center; gap: 6px; color: oklch(var(--muted-foreground)); }
  .status i { width: 7px; height: 7px; border-radius: 50%; background: oklch(var(--muted-foreground)); }
  .status[data-status="current"] i { background: oklch(var(--up-color)); }
  .status[data-status="invalid"] i, .status[data-status="error"] i { background: oklch(var(--down-color)); }
  .status[data-status="invalid"], .status[data-status="error"] { color: oklch(var(--foreground)); }
  .run-actions, .mode-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .panel-scroll { min-height: 0; flex: 1; overflow: auto; padding: 12px; scrollbar-gutter: stable; }
  p { line-height: 1.5; margin: 8px 0; overflow-wrap: anywhere; }
  .boundary { margin-top: 0; }
  .workbench-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: start; }
  .editor-column, .evidence-column { min-width: 0; }
  .evidence-column { grid-row: 1; }
  @container (min-width: 1100px) {
    .panel-scroll { display: flex; flex-direction: column; overflow: hidden; }
    .workbench-grid { flex: 1; min-height: 0; grid-template-columns: minmax(380px, 460px) minmax(0, 1fr); align-items: stretch; }
    .evidence-column { grid-row: auto; }
    .editor-column, .evidence-column { min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; padding-right: 4px; }
  }
  .editor-column { display: grid; gap: 8px; }
  .mode-row button[aria-pressed="true"] { background: oklch(var(--accent)); box-shadow: inset 0 -2px oklch(var(--primary)); }
  .field { display: flex; flex-direction: column; gap: 5px; min-width: 0; color: oklch(var(--foreground)); }
  .field > span:first-child { line-height: 1.4; }
  input { width: 100%; min-width: 0; box-sizing: border-box; border: 1px solid oklch(var(--input)); border-radius: 4px; background: oklch(var(--background)); color: oklch(var(--foreground)); padding: 5px 7px; font: inherit; }
  input { min-height: 32px; }
  input[type="number"] { font-family: var(--font-mono); font-size: 12px; font-variant-numeric: tabular-nums; }
  input:focus-visible, summary:focus-visible { outline: 2px solid oklch(var(--ring)); outline-offset: 2px; }
  input[aria-invalid="true"] { border-color: oklch(var(--destructive)); }
  .field-error { color: oklch(var(--down-color)); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
  .inputs-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .hint { font-size: 12px; margin: 0; }
  h3 { font-size: 12px; font-weight: 700; margin: 8px 0; overflow-wrap: anywhere; }
  .configuration { border-top: 1px solid oklch(var(--border)); padding-top: 8px; }
  summary { cursor: pointer; min-height: 28px; line-height: 28px; }
  .configuration > :not(summary) { margin-top: 8px; }
  .submitted-source { font-family: var(--font-mono); }
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
  @media (max-width: 760px) { .panel-header, .panel-scroll { padding: 8px; } .shortcut { display: none; } .identity { flex: 1 1 210px; } }
  @media (forced-colors: active) { input, .summary-grid > div, .greeks-grid > div { border-color: CanvasText; } .mode-row button[aria-pressed="true"] { outline: 1px solid Highlight; } input:focus-visible, summary:focus-visible { outline-color: Highlight; } }
</style>

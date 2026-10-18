<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { findStrategies } from '$lib/features/options/optionsResearchApi';
  import type { FinderRequest, FinderResponse, OptionsResearchToolProps } from '$lib/features/options/optionsResearchTypes';
  import type { OptionLeg } from '$lib/features/options/optionsTypes';
  import { exactValue } from '$lib/features/options/optionsChart';
  import { applyFinderCandidate, editFinderContract, finderErrors, manualFinderContract, parseFinderSpots, seedFinderUniverse } from '$lib/features/options/optionsFinder';
  import { RequestFlight } from '$lib/features/options/optionsRequest';

  let { draft, onEdit, documentKey, readOnly = false }: OptionsResearchToolProps = $props();
  const id = $props.id();
  const flight = new RequestFlight();
  let universe = $state<OptionLeg[]>([]);
  let thesis = $state<FinderRequest['thesis']>('neutral');
  let maxDebit = $state(1000), maxLoss = $state(1000), maxContracts = $state(4), maxLegs = $state(4);
  let limit = $state(10), maxEvaluations = $state(2000), scenarioText = $state('');
  let result = $state<FinderResponse | null>(null);
  let submitted = $state<FinderRequest | null>(null);
  let submittedKey = $state('');
  let pending = $state(false), attempted = $state(false);
  let failure = $state(''), notice = $state('');
  const request: FinderRequest = $derived({
    analysis: draft, universe, thesis,
    constraints: { max_entry_debit: maxDebit, max_loss: maxLoss, max_total_contracts: maxContracts, max_legs: maxLegs },
    scenario_spots: parseFinderSpots(scenarioText), scoring: 'mean_scenario_pnl_v1', limit, max_evaluations: maxEvaluations,
  });
  const requestKey = $derived(JSON.stringify(request));
  const errors = $derived(finderErrors(request));
  const stale = $derived(result !== null && requestKey !== submittedKey);
  const key = () => `${documentKey}:${readOnly}:${requestKey}`;
  const errorId = (field: string) => `${id}-${field.replace(/\./g, '-')}-error`;

  $effect(() => {
    documentKey;
    untrack(() => {
      flight.cancel(); pending = false; result = null; submitted = null; submittedKey = '';
      universe = []; scenarioText = ''; thesis = 'neutral'; maxDebit = 1000; maxLoss = 1000; maxContracts = 4; maxLegs = 4; limit = 10; maxEvaluations = 2000;
      attempted = false; failure = ''; notice = '';
    });
  });
  $effect(() => {
    requestKey; readOnly;
    untrack(() => {
      if (pending) { flight.cancel(); pending = false; notice = 'Search cancelled because its inputs changed. Submit explicitly to search again.'; }
    });
  });
  onDestroy(() => flight.cancel());

  function edit(index: number, update: Partial<OptionLeg>) {
    if (!readOnly) universe[index] = editFinderContract($state.snapshot(universe[index]), update);
  }
  async function search(event: SubmitEvent) {
    event.preventDefault();
    if (readOnly || pending) return;
    attempted = true; failure = ''; notice = '';
    if (Object.keys(errors).length) return;
    const snapshot = structuredClone($state.snapshot(request));
    const inputKey = requestKey;
    const run = flight.start(key, () => { pending = false; failure = 'Search timed out. Inputs are unchanged; retry explicitly with a smaller search limit.'; });
    pending = true;
    try {
      const response = await findStrategies(snapshot, run.signal);
      if (!run.current()) return;
      result = response; submitted = snapshot; submittedKey = inputKey;
      notice = response.candidates.length ? 'Search complete. Review the submitted evidence before applying a candidate.' : 'Search complete: no candidates satisfy these constraints in the submitted universe.';
    } catch {
      if (run.current()) failure = 'Strategy search failed. Check the field constraints and retry explicitly; no candidate was applied.';
    } finally {
      if (run.current()) pending = false;
      run.finish();
    }
  }
  function cancel() {
    flight.cancel(); pending = false; notice = 'Search cancelled. Any previous submitted evidence remains below.';
  }
  function apply(index: number) {
    if (readOnly || pending || stale || !result || !submitted) return;
    const candidate = structuredClone($state.snapshot(result.candidates[index]));
    const snapshot = structuredClone($state.snapshot(submitted));
    onEdit(current => {
      if (applyFinderCandidate(current, snapshot, candidate)) notice = `Candidate ${candidate.rank} applied to the draft. Analyze explicitly for updated workbench evidence.`;
    });
  }
</script>

{#snippet error(field: string)}
  {#if attempted && errors[field]}<small class="error" id={errorId(field)}>{errors[field]}</small>{/if}
{/snippet}
{#snippet numberField(label: string, field: string, value: number, min: number, max: number, update: (n: number) => void, step = 'any')}
  <label><span>{label}</span><input type="number" name={`finder-${field}`} autocomplete="off" value={Number.isFinite(value) ? value : ''} {min} {max} {step} oninput={e => update(e.currentTarget.valueAsNumber)} aria-invalid={attempted && !!errors[field]} aria-describedby={attempted && errors[field] ? errorId(field) : undefined} />{@render error(field)}</label>
{/snippet}

<section class="finder" aria-label="Constrained options strategy finder">
  <h3>Strategy finder · bounded research</h3>
  <p>Explicit manual universe, European cash-settled USD assumptions. Backend prices and ranks finite unit-size combinations, not an exhaustive optimizer or trade recommendation. Results are session-local, not saved evidence.</p>
  {#if readOnly}<p class="notice">Read-only source mode. Switch to an editable visual draft in the parent workbench to author, search or apply.</p>{/if}
  <form onsubmit={search} novalidate>
    <fieldset disabled={readOnly}>
      <legend>Contract universe · {universe.length}/24</legend>
      <p>Seed only on request; enabled draft options (including imported identities) become +1 contracts. Each premium stays explicitly authored. Identity edits clear provider provenance; changing a premium never reprices other rows.</p>
      <div class="actions">
        <button type="button" class="ot-workbench-ghost" onclick={() => { if (!readOnly) universe = seedFinderUniverse($state.snapshot(draft)); }}>Replace universe from enabled draft options</button>
        <button type="button" class="ot-workbench-ghost" disabled={universe.length >= 24} onclick={() => { if (!readOnly && universe.length < 24) universe.push(manualFinderContract(draft)); }}>Add manual contract</button>
      </div>
      {@render error('universe')}
      {#each universe as leg, i}
        <fieldset class="contract">
          <legend>Contract {i + 1} · +1 enabled</legend>
          {#if leg.source}<p>{leg.source.contract_symbol} · {leg.source.underlying} · {leg.source.provider}/{leg.source.environment}. Model approximation remains European/cash. Fetched {leg.source.fetched_at}.</p>{:else}<p>Manual/synthetic contract · not provider verified</p>{/if}
          <div class="grid">
            <label><span>Kind</span><select name={`universe.${i}.kind`} value={leg.kind} onchange={e => edit(i, { kind: e.currentTarget.value as 'call' | 'put' })}><option value="call">Call</option><option value="put">Put</option></select></label>
            {@render numberField('Strike · USD (>0–1m)', `universe.${i}.strike`, leg.strike ?? NaN, 0, 1e6, n => edit(i, { strike: n }))}
            {@render numberField('Entry premium · USD/unit (0–1m)', `universe.${i}.entry_premium`, leg.entry_premium, 0, 1e6, n => edit(i, { entry_premium: n }))}
            {@render numberField('Multiplier · units/contract (1–1000)', `universe.${i}.multiplier`, leg.multiplier, 1, 1000, n => edit(i, { multiplier: n }), '1')}
            <label><span>Days override · blank inherits, 0–3650</span><input type="number" name={`universe.${i}.days_to_expiry`} autocomplete="off" min="0" max="3650" step="any" value={leg.days_to_expiry ?? ''} oninput={e => edit(i, { days_to_expiry: e.currentTarget.value === '' ? null : e.currentTarget.valueAsNumber })} />{@render error(`universe.${i}.days_to_expiry`)}</label>
            <label><span>Expiry date · optional UTC, uses draft valuation</span><input type="date" name={`universe.${i}.expiry_date`} min="0001-01-01" max="9999-12-31" value={leg.expiry_date ?? ''} oninput={e => edit(i, { expiry_date: e.currentTarget.value || null })} />{@render error(`universe.${i}.expiry_date`)}</label>
            <label><span>Annual IV fraction · blank inherits, 0–5</span><input type="number" name={`universe.${i}.implied_volatility`} autocomplete="off" min="0" max="5" step="any" value={leg.implied_volatility ?? ''} oninput={e => edit(i, { implied_volatility: e.currentTarget.value === '' ? null : e.currentTarget.valueAsNumber })} />{@render error(`universe.${i}.implied_volatility`)}</label>
          </div>
          {@render error(`universe.${i}`)}{@render error(`universe.${i}.source`)}
          <button type="button" class="ot-workbench-ghost" onclick={() => { if (!readOnly) universe.splice(i, 1); }} aria-label={`Remove finder contract ${i + 1}`}>Remove contract {i + 1}</button>
        </fieldset>
      {/each}
    </fieldset>
    <fieldset disabled={readOnly}>
      <legend>Search assumptions and limits</legend>
      <div class="grid">
        <label><span>Thesis · current canonical delta sign</span><select name="finder-thesis" bind:value={thesis}><option value="bullish">Bullish · delta &gt; 0</option><option value="bearish">Bearish · delta &lt; 0</option><option value="neutral">Neutral · no directional filter</option></select>{@render error('thesis')}</label>
        <label><span>Scenario spots · USD, 1–9 increasing values</span><input name="finder-scenario-spots" autocomplete="off" bind:value={scenarioText} maxlength="256" placeholder="80, 100, 120" aria-invalid={attempted && !!errors.scenario_spots} aria-describedby={attempted && errors.scenario_spots ? errorId('scenario_spots') : undefined} />{@render error('scenario_spots')}</label>
        {@render numberField('Maximum entry debit · total USD', 'constraints.max_entry_debit', maxDebit, 0, 1e12, n => maxDebit = n)}
        {@render numberField('Maximum finite expiry loss · total USD', 'constraints.max_loss', maxLoss, 0, 1e12, n => maxLoss = n)}
        {@render numberField('Maximum absolute contracts · 1–100', 'constraints.max_total_contracts', maxContracts, 1, 100, n => maxContracts = n, '1')}
        {@render numberField('Maximum legs · 1–4', 'constraints.max_legs', maxLegs, 1, 4, n => maxLegs = n, '1')}
        {@render numberField('Returned candidates · 1–20', 'limit', limit, 1, 20, n => limit = n, '1')}
        {@render numberField('Evaluation budget · 1–2000', 'max_evaluations', maxEvaluations, 1, 2000, n => maxEvaluations = n, '1')}
      </div>
      <p>Ranking = arithmetic mean of submitted common-expiry scenario P&amp;L (USD), not probability-weighted expected return. Neutral is not delta-neutral. Unknown, mixed-expiry or unbounded loss candidates are excluded. A bounded model loss is not a margin or assignment guarantee.</p>
    </fieldset>
    {#if attempted && Object.keys(errors).length}<div class="notice" role="alert"><strong>Correct inputs before search:</strong><ul>{#each Object.entries(errors) as [field, message]}<li>{field}: {message}</li>{/each}</ul></div>{/if}
    <div class="actions">
      <button type="submit" class="ot-workbench-primary" disabled={readOnly || pending}>{pending ? 'Searching…' : 'Search strategies'}</button>
      <button type="button" class="ot-workbench-ghost" disabled={!pending} onclick={cancel}>Cancel search</button>
    </div>
  </form>
  <div aria-live="polite" aria-atomic="true">
    {#if pending}<p>{result ? 'Searching; previous submitted evidence remains below.' : 'Searching explicit inputs; no results yet.'}</p>{/if}
    {#if !pending && !result && !failure && !notice}<p>No search submitted. Author a universe and explicit scenario spots, then Search.</p>{/if}
    {#if notice}<p>{notice}</p>{/if}
    {#if failure}<p role="alert" class="notice">{failure}</p>{/if}
    {#if stale}<p class="notice">Stale evidence: draft or finder settings changed. Search again before applying; old results are not relabelled.</p>{/if}
  </div>
  {#if result}
    <section aria-label="Submitted strategy finder evidence">
      <h4>Submitted: {result.request.analysis.strategy.name} · spot {exactValue(result.request.analysis.spot)} USD · {result.request.thesis}</h4>
      <p>{result.provenance.model} v{result.provenance.version} · {result.provenance.exercise_style}/{result.provenance.settlement} · {result.provenance.currency} · {result.provenance.day_basis}. Scoring: {result.scoring}. Base annual IV {exactValue(result.request.analysis.volatility)}, rate {exactValue(result.request.analysis.rate)}, dividend yield {exactValue(result.request.analysis.dividend_yield)}. Entry fee {exactValue(result.request.analysis.strategy.entry_fee_per_contract)} USD/contract.</p>
      <p>Evaluated {result.searched_count}/{result.request.max_evaluations ?? 2000}; eligible {result.eligible_count}; shown {result.candidates.length}/{result.request.limit ?? 10}. {result.search_truncated ? 'Search truncated at the declared budget; not exhaustive.' : 'Bounded enumeration complete; not an exhaustive market search.'} Submitted scenarios: {result.request.scenario_spots.map(v => exactValue(v)).join(', ')} USD.</p>
      <p>Limits: debit {exactValue(result.request.constraints.max_entry_debit)} USD; loss {exactValue(result.request.constraints.max_loss)} USD; {result.request.constraints.max_total_contracts ?? 10} absolute contracts, {result.request.constraints.max_legs ?? 4} legs.</p>
      {#each result.warnings as warning}<p class="notice">{warning}</p>{/each}
      {#if result.candidates.length === 0}<p>No matches. Change explicit limits or universe and submit again; no draft changes were made.</p>{/if}
      {#each result.candidates as candidate, i (candidate.candidate_id)}
        <article>
          <h4>#{candidate.rank} · {candidate.request.strategy.name}</h4>
          <p>Score {exactValue(candidate.score, true)} USD · debit {exactValue(candidate.summary.entry_debit)} USD · credit {exactValue(candidate.summary.entry_credit)} USD · fees {exactValue(candidate.summary.entry_fees)} USD · net cost {exactValue(candidate.summary.net_entry_cost, true)} USD.</p>
          <p>Maximum expiry loss: {candidate.summary.max_loss === null ? (candidate.summary.loss_unbounded === true ? 'unbounded' : 'unavailable') : `${exactValue(candidate.summary.max_loss)} USD`}; maximum profit: {candidate.summary.max_profit === null ? (candidate.summary.profit_unbounded === true ? 'unbounded' : 'unavailable') : `${exactValue(candidate.summary.max_profit)} USD`}.</p>
          <ul>{#each candidate.request.strategy.legs as leg}<li>{leg.quantity > 0 ? 'Buy' : 'Sell'} {Math.abs(leg.quantity)} {leg.kind} · strike {exactValue(leg.strike)} USD · premium {exactValue(leg.entry_premium)} USD/unit · multiplier {leg.multiplier} · expiry {leg.expiry_date ?? `${leg.days_to_expiry ?? candidate.request.strategy.days_to_expiry} days`} · IV {exactValue(leg.implied_volatility ?? candidate.request.volatility)}{#if leg.source} · {leg.source.contract_symbol} ({leg.source.environment}){/if}</li>{/each}</ul>
          <!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard scrolling for the bounded evidence table) -->
          <div class="table-scroll" role="region" aria-label={`Candidate ${candidate.rank} canonical scenario evidence`} tabindex="0">
            <table><caption>Submitted canonical common-expiry evidence · signed total USD</caption><thead><tr><th scope="col">Spot · USD</th><th scope="col">Elapsed days</th><th scope="col">P&amp;L · USD</th></tr></thead><tbody>{#each candidate.evidence as point}<tr><td>{exactValue(point.spot)}</td><td>{exactValue(point.elapsed_days)}</td><td>{exactValue(point.pnl, true)}</td></tr>{/each}</tbody></table>
          </div>
          <button type="button" class="ot-workbench-ghost" disabled={readOnly || pending || stale} onclick={() => apply(i)}>Apply candidate {candidate.rank} to draft</button>
        </article>
      {/each}
    </section>
  {/if}
</section>

<style>
  .finder { container-type: inline-size; min-width: 0; display: grid; gap: 8px; font: 12px var(--font-family-lato); color: oklch(var(--foreground)); }
  h3, h4, p { margin: 0; } h3, h4 { font-size: 12px; } p, li { line-height: 1.5; overflow-wrap: anywhere; }
  p { color: oklch(var(--muted-foreground)); } form, section, article { display: grid; gap: 8px; min-width: 0; }
  fieldset { margin: 0; min-width: 0; border: 1px solid oklch(var(--border)); border-radius: 4px; padding: 8px; display: grid; gap: 8px; }
  legend { padding: 0 4px; font-weight: 700; } .contract, article { border-top: 1px solid oklch(var(--border)); padding-top: 8px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr)); gap: 8px; min-width: 0; }
  label { display: grid; gap: 4px; min-width: 0; line-height: 1.5; }
  input, select { box-sizing: border-box; min-width: 0; width: 100%; min-height: 32px; padding: 5px 7px; border: 1px solid oklch(var(--input)); border-radius: 4px; background: oklch(var(--background)); color: oklch(var(--foreground)); font: inherit; }
  input[type="number"], td { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; } button { height: auto; min-height: 28px; white-space: normal; overflow-wrap: anywhere; justify-self: start; }
  .notice { padding: 8px; border: 1px solid oklch(var(--border)); color: oklch(var(--foreground)); } .error { font-size: 12px; color: oklch(var(--foreground)); } [aria-invalid="true"] { border-color: oklch(var(--destructive)); }
  .table-scroll { max-width: 100%; overflow: auto; max-height: 260px; border: 1px solid oklch(var(--border)); }
  table { border-collapse: collapse; width: 100%; } caption { padding: 6px; text-align: left; } th, td { text-align: right; padding: 6px; border-bottom: 1px solid oklch(var(--border)); white-space: nowrap; } th { background: oklch(var(--card)); }
  button:focus-visible, input:focus-visible, select:focus-visible, .table-scroll:focus-visible { outline: 2px solid oklch(var(--ring)); outline-offset: 2px; }
  @media (pointer: coarse) { button, input, select { min-height: var(--control-touch-height); } }
  @media (forced-colors: active) { fieldset, input, select, .notice, .table-scroll { border-color: CanvasText; } button:focus-visible, input:focus-visible, select:focus-visible, .table-scroll:focus-visible { outline-color: Highlight; } }
</style>

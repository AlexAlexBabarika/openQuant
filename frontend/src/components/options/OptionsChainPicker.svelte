<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { getAccessToken } from '$lib/core/api';
  import { getChainStatus, getChainExpirations, getOptionChain } from '$lib/features/options/optionsResearchApi';
  import type { ChainEnvironment, ChainExpirationsResponse, ChainQuote, ChainResponse, ChainStatusResponse, OptionsResearchToolProps } from '$lib/features/options/optionsResearchTypes';
  import { applyChainImport, chainFailureMessage, chainFilterErrors, chainPremium, chainRows, chainSpread, needsChainModelAcknowledgment, proposeChainImport, type ChainFilters, type ChainImportSettings } from '$lib/features/options/optionsChain';
  import { OptionsToolFlight } from '$lib/features/options/optionsFinder';
  import { exactValue } from '$lib/features/options/optionsChart';

  let { draft, onEdit, documentKey, readOnly = false }: OptionsResearchToolProps = $props();
  const id = $props.id();
  const flight = new OptionsToolFlight();
  let symbol = $state(''), environment = $state<ChainEnvironment>('production'), expiration = $state('');
  let status = $state<ChainStatusResponse | null>(null);
  let expirations = $state<ChainExpirationsResponse | null>(null);
  let response = $state<ChainResponse | null>(null);
  let responseKey = $state('');
  let selected = $state<ChainQuote | null>(null);
  let settings = $state<ChainImportSettings>(emptySettings());
  let filters = $state<ChainFilters>({ kind: 'all', minStrike: null, maxStrike: null, sort: 'strike', descending: false, page: 0 });
  let pending = $state<'status' | 'expirations' | 'chain' | null>(null);
  let failure = $state(''), notice = $state(''), attempted = $state(false);
  const normalizedSymbol = $derived(symbol.trim().toUpperCase());
  const queryKey = $derived(JSON.stringify([normalizedSymbol, environment, expiration]));
  const scopeKey = () => `${documentKey}:${readOnly}:${queryKey}`;
  const activeStatus = $derived(status?.environments.find(s => s.environment === environment));
  const connected = $derived(activeStatus?.configured === true && activeStatus?.available === true);
  const symbolError = $derived(/^[A-Za-z0-9.^_/-]{1,32}$/.test(normalizedSymbol) ? '' : 'Enter a symbol of 1–32 letters, digits, . ^ _ / or - .');
  const matchingExpirations = $derived(expirations?.environment === environment && expirations.symbol === normalizedSymbol ? expirations : null);
  const stale = $derived(response !== null && queryKey !== responseKey);
  const filterErrors = $derived(chainFilterErrors(filters));
  const rows = $derived(response && !Object.keys(filterErrors).length ? chainRows(response, filters) : null);
  const importErrors = $derived(selected ? proposeChainImport($state.snapshot(draft), selected, settings).errors : {});
  const errorId = (field: string) => `${id}-${field.replace(/\./g, '-')}-error`;
  const value = (n: number | null) => n === null ? 'Unknown' : exactValue(n);

  function emptySettings(): ChainImportSettings {
    return { side: 'buy', size: 1, premiumChoice: '', customPremium: NaN, multiplier: NaN, valuationDate: '', ivChoice: '', customIv: NaN, acknowledgeModel: false, acknowledgeQuote: false, setUnderlying: false };
  }
  $effect(() => {
    documentKey;
    untrack(() => {
      flight.cancel(); pending = null; status = null; expirations = null; response = null; responseKey = ''; selected = null;
      symbol = draft.strategy.underlying ?? ''; environment = 'production'; expiration = ''; settings = emptySettings();
      filters = { kind: 'all', minStrike: null, maxStrike: null, sort: 'strike', descending: false, page: 0 };
      failure = ''; notice = ''; attempted = false;
    });
  });
  $effect(() => {
    queryKey; readOnly;
    untrack(() => {
      if (pending) { flight.cancel(); pending = null; notice = 'Request cancelled because its query or source mode changed. Fetch explicitly to continue.'; }
      selected = null; attempted = false;
    });
  });
  $effect(() => {
    filters.kind; filters.minStrike; filters.maxStrike; filters.sort; filters.descending;
    untrack(() => { filters.page = 0; });
  });
  onDestroy(() => flight.cancel());

  async function fetchData(kind: 'status' | 'expirations' | 'chain') {
    if (readOnly || pending) return;
    failure = ''; notice = '';
    if (!getAccessToken()) { failure = 'Sign in before reading provider chains, then open Settings → API keys. Guest drafts cannot access an account’s provider credentials.'; return; }
    if (kind !== 'status' && (symbolError || !connected)) { failure = symbolError || 'Check connection status and configure this environment in Settings → API keys first.'; return; }
    if (kind === 'chain' && (!matchingExpirations || !matchingExpirations.expirations.includes(expiration))) { failure = 'Fetch available expirations and explicitly choose one before loading a chain.'; return; }
    const query = { symbol: normalizedSymbol, environment, expiration };
    const submittedKey = queryKey;
    const run = flight.start(scopeKey, () => { pending = null; failure = 'Provider request timed out. Retry explicitly; previous observations are not refreshed.'; });
    pending = kind;
    try {
      if (kind === 'status') {
        const next = await getChainStatus(run.signal);
        if (!run.current()) return;
        pending = null; status = next;
        notice = 'Connection status checked. Availability does not prove market-data entitlement or quote freshness.';
      } else if (kind === 'expirations') {
        const next = await getChainExpirations(query.symbol, query.environment, run.signal);
        if (!run.current()) return;
        if (next.symbol !== query.symbol || next.environment !== query.environment || next.expirations.length > 128) throw new Error('Mismatched expiration response.');
        pending = null; expirations = next;
        if (!next.expirations.includes(expiration)) expiration = '';
        notice = next.expirations.length ? 'Expirations fetched. Choose a date and explicitly Load chain.' : 'No expirations returned for this symbol/environment.';
      } else {
        const next = await getOptionChain(query.symbol, query.expiration, query.environment, run.signal);
        if (!run.current()) return;
        if (next.symbol !== query.symbol || next.environment !== query.environment || next.expiration !== query.expiration || next.quotes.length > 2000 || next.quotes.some(q => q.expiration !== query.expiration || q.underlying.toUpperCase() !== query.symbol || q.source.environment !== query.environment)) throw new Error('Mismatched chain response.');
        pending = null; response = next; responseKey = submittedKey; selected = null; filters.page = 0;
        notice = next.quotes.length ? 'Read-only observations fetched. Buy/Sell below only prepares an explicit draft import, not an order.' : 'Chain fetched successfully: no contracts returned.';
      }
    } catch (error) {
      if (run.current()) failure = chainFailureMessage(error);
    } finally {
      if (run.current()) pending = null;
      run.finish();
    }
  }
  function cancel() { flight.cancel(); pending = null; notice = 'Provider request cancelled. Previous observations, if any, remain unchanged.'; }
  function select(quote: ChainQuote, side: 'buy' | 'sell') {
    if (readOnly || stale || pending) return;
    selected = structuredClone($state.snapshot(quote));
    settings = { ...emptySettings(), side, multiplier: quote.multiplier ?? NaN, valuationDate: draft.strategy.valuation_date ?? '' };
    attempted = false; notice = 'Contract selected, not imported. Choose entry assumptions and confirm below.';
  }
  function importContract(event: SubmitEvent) {
    event.preventDefault();
    if (readOnly || pending || stale || !selected) return;
    attempted = true;
    if (Object.keys(importErrors).length) return;
    const quote = structuredClone($state.snapshot(selected)), choices = structuredClone($state.snapshot(settings));
    onEdit(current => {
      if (applyChainImport(current, quote, choices)) { selected = null; notice = 'Contract added to draft with explicit entry assumptions and source provenance. Existing leg premiums/quotes are unchanged. Analyze explicitly to recompute.'; }
    });
  }
</script>

{#snippet error(field: string)}
  {#if attempted && importErrors[field]}<small class="error" id={errorId(field)}>{importErrors[field]}</small>{/if}
{/snippet}

<section class="chain" aria-label="Read-only provider option chain picker">
  <h3>Provider chain · read-only observations</h3>
  <p>Tradier production/sandbox chains are not order routing, live accounts, subscriptions or historical replay. Only explicit confirmed imports edit the draft. No API keys are entered, stored or exported here.</p>
  {#if readOnly}<p class="notice">Read-only source mode. Switch explicitly to an editable visual draft in the workbench before fetching or importing.</p>{/if}
  <fieldset disabled={readOnly}>
    <legend>Connection and query</legend>
    <div class="grid">
      <label><span>Environment</span><select bind:value={environment}><option value="production">Production · tradier</option><option value="sandbox">Sandbox · tradier_sandbox</option></select></label>
      <label><span>Underlying symbol · 1–32 characters</span><input bind:value={symbol} maxlength="32" autocomplete="off" spellcheck="false" aria-invalid={!!symbolError} aria-describedby={`${id}-symbol-help`} /><small id={`${id}-symbol-help`}>{symbolError || 'Changing a query cancels pending responses; fetch explicitly.'}</small></label>
      <label><span>Expiration · UTC</span><select bind:value={expiration} disabled={!matchingExpirations || !!pending}><option value="">Choose expiration</option>{#each matchingExpirations?.expirations ?? [] as date}<option value={date}>{date}</option>{/each}</select></label>
    </div>
    <div class="actions">
      <button type="button" class="ot-workbench-ghost" disabled={!!pending} onclick={() => fetchData('status')}>Check connection status</button>
      <button type="button" class="ot-workbench-ghost" disabled={!!pending || !connected || !!symbolError} onclick={() => fetchData('expirations')}>Fetch expirations</button>
      <button type="button" class="ot-workbench-primary" disabled={!!pending || !connected || !expiration || !matchingExpirations || !!symbolError} onclick={() => fetchData('chain')}>Load chain</button>
    </div>
  </fieldset>
  <button type="button" class="ot-workbench-ghost" disabled={!pending} onclick={cancel}>Cancel provider request</button>
  <div aria-live="polite" aria-atomic="true">
    {#if pending}<p>Loading {pending} for {normalizedSymbol || 'connection status'} · {environment}. Previous observations are not a fresh response.</p>{/if}
    {#if notice}<p>{notice}</p>{/if}
    {#if failure}<p class="notice" role="alert">{failure}</p>{/if}
    {#if stale}<p class="notice">Stale query: the observations below belong to their submitted symbol/environment/expiry. Load the current chain before selecting contracts.</p>{/if}
  </div>
  {#if !status}<p>No connection check submitted. Sign in and open Settings → API keys to configure Tradier or Tradier sandbox; then Check connection status. Never paste credentials into this tool.</p>{:else}
    {#each status.environments as connection}<p>{connection.environment} · {connection.configured ? 'configured' : 'not configured'} · {connection.available ? 'available' : 'unavailable'}: {connection.message}</p>{/each}
    {#if !connected}<p class="notice">This environment is disconnected/unavailable. Open Settings → API keys and configure {environment === 'production' ? 'Tradier (tradier)' : 'Tradier sandbox (tradier_sandbox)'}, then check status again. Existing keys are managed by encrypted server-side settings, not this component.</p>{/if}
  {/if}
  {#if matchingExpirations}
    <p>Expirations for {matchingExpirations.symbol} · {matchingExpirations.environment} · fetched {matchingExpirations.fetched_at}. {matchingExpirations.truncated ? 'Expiration list truncated (maximum 128).' : `${matchingExpirations.expirations.length} dates returned.`}</p>
    {#each matchingExpirations.warnings as warning}<p class="notice">{warning}</p>{/each}
  {/if}
  {#if response}
    <h4>Submitted observations: {response.symbol} · {response.expiration} · {response.provider}/{response.environment}</h4>
    <p>Fetched {response.fetched_at} (retrieval time only, never quote time). {response.truncated ? 'Provider result truncated to a bounded chain; not exhaustive.' : `${response.quotes.length} contracts returned (maximum 2000).`} Unknown is not zero. Side timestamps are independent; quotes may be stale or delayed. No freshness guarantee.</p>
    {#each response.warnings as warning}<p class="notice">{warning}</p>{/each}
    <fieldset disabled={readOnly}>
      <legend>Filter and sort observations · unknown values sort last</legend>
      <div class="grid">
        <label><span>Kind</span><select bind:value={filters.kind}><option value="all">Calls and puts</option><option value="call">Calls</option><option value="put">Puts</option></select></label>
        <label><span>Minimum strike · USD, optional</span><input type="number" min="0" max="1000000" step="any" value={filters.minStrike ?? ''} oninput={e => filters.minStrike = e.currentTarget.value === '' ? null : e.currentTarget.valueAsNumber} aria-invalid={!!filterErrors.minStrike} aria-describedby={`${id}-minStrike-error`} /><small id={`${id}-minStrike-error`}>{filterErrors.minStrike ?? ''}</small></label>
        <label><span>Maximum strike · USD, optional</span><input type="number" min="0" max="1000000" step="any" value={filters.maxStrike ?? ''} oninput={e => filters.maxStrike = e.currentTarget.value === '' ? null : e.currentTarget.valueAsNumber} aria-invalid={!!filterErrors.maxStrike} aria-describedby={`${id}-maxStrike-error`} /><small id={`${id}-maxStrike-error`}>{filterErrors.maxStrike ?? ''}</small></label>
        <label><span>Sort column</span><select bind:value={filters.sort}><option value="strike">Strike</option><option value="bid">Bid</option><option value="ask">Ask</option><option value="spread">Spread width</option><option value="volume">Volume</option><option value="open_interest">Open interest</option></select></label>
        <label><span>Sort direction</span><select value={filters.descending ? 'descending' : 'ascending'} onchange={e => filters.descending = e.currentTarget.value === 'descending'}><option value="ascending">Ascending</option><option value="descending">Descending</option></select></label>
      </div>
    </fieldset>
    {#if rows}
      <p>{rows.total} matching contracts · page {rows.page + 1}/{rows.pages} · at most 50 rows per page. Selecting Buy/Sell prepares research inputs only.</p>
      <div class="actions"><button type="button" class="ot-workbench-ghost" disabled={readOnly || rows.page === 0} onclick={() => filters.page = rows.page - 1}>Previous page</button><button type="button" class="ot-workbench-ghost" disabled={readOnly || rows.page + 1 >= rows.pages} onclick={() => filters.page = rows.page + 1}>Next page</button></div>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard scrolling for the bounded native chain table) -->
      <div class="table-scroll" role="region" aria-label="Provider chain observations table" tabindex="0">
        <table>
          <caption>{response.symbol} · {response.expiration} · {response.environment}. Bid/ask/spread are USD per unit; IV is an annual fraction. Negative spread means crossed quotes. Missing side time disables that premium choice.</caption>
          <thead><tr><th scope="col">Contract / kind</th><th scope="col">Strike · USD</th><th scope="col">Bid / time</th><th scope="col">Ask / time</th><th scope="col">Spread · USD</th><th scope="col">IV · fraction</th><th scope="col">Multiplier · units</th><th scope="col">Volume · contracts</th><th scope="col">Open interest · contracts</th><th scope="col">Model classification / source</th><th scope="col">Prepare import</th></tr></thead>
          <tbody>{#each rows.quotes as quote, i}<tr>
            <th scope="row">{quote.contract_symbol}<br />{quote.kind}</th><td>{value(quote.strike)}</td>
            <td>{value(quote.bid)}<small>{quote.bid_as_of ?? 'Quote time unknown'}</small></td><td>{value(quote.ask)}<small>{quote.ask_as_of ?? 'Quote time unknown'}</small></td>
            <td>{value(chainSpread(quote))}{#if (chainSpread(quote) ?? 0) < 0}<small>Crossed · midpoint unavailable</small>{/if}</td><td>{value(quote.implied_volatility)}</td><td>{value(quote.multiplier)}</td><td>{value(quote.volume)}</td><td>{value(quote.open_interest)}</td>
            <td>{quote.source.observed_exercise_style ?? 'unknown'} / {quote.source.observed_settlement ?? 'unknown'}<small>{quote.source.provider}/{quote.source.environment}</small><small>Fetched {quote.source.fetched_at}</small></td>
            <td><div class="actions"><button type="button" class="ot-workbench-ghost" disabled={readOnly || stale || !!pending || draft.strategy.legs.length >= 16} onclick={() => select(quote, 'buy')} aria-label={`Prepare buy ${quote.contract_symbol}, row ${i + 1}`}>Buy</button><button type="button" class="ot-workbench-ghost" disabled={readOnly || stale || !!pending || draft.strategy.legs.length >= 16} onclick={() => select(quote, 'sell')} aria-label={`Prepare sell ${quote.contract_symbol}, row ${i + 1}`}>Sell</button></div></td>
          </tr>{/each}</tbody>
        </table>
      </div>
      {#if rows.total === 0}<p>No matching contracts. This is an empty success, not a zero quote. Adjust filters or fetch another explicit query.</p>{/if}
      {#if draft.strategy.legs.length >= 16}<p class="notice">Draft leg limit reached (16 including disabled rows). Remove a leg explicitly before preparing import.</p>{/if}
    {/if}
  {/if}
  {#if selected}
    <form onsubmit={importContract} novalidate>
      <h4>Confirm hypothetical import: {selected.contract_symbol} · {selected.underlying} · {selected.source.environment}</h4>
      <p>Observed {selected.source.observed_exercise_style ?? 'unknown'} exercise / {selected.source.observed_settlement ?? 'unknown'} settlement. Import models only European cash settlement. No American exercise, early assignment, physical delivery, corporate-action adjustment or trade fill is modeled.</p>
      <p>Bid {value(selected.bid)} at {selected.bid_as_of ?? 'unknown time'}; ask {value(selected.ask)} at {selected.ask_as_of ?? 'unknown time'}; fetched {selected.source.fetched_at}. Quote side times are retained only in source provenance; no legacy bid/ask/quote_as_of or existing premiums are overwritten.</p>
      <fieldset disabled={readOnly || !!pending || stale}>
        <legend>Explicit entry and model assumptions</legend>
        <div class="grid">
          <label><span>Side · signed contracts</span><select bind:value={settings.side}><option value="buy">Buy (+)</option><option value="sell">Sell (−)</option></select>{@render error('side')}</label>
          <label><span>Size · 1–10000 contracts</span><input type="number" min="1" max="10000" step="1" bind:value={settings.size} aria-invalid={attempted && !!importErrors.size} aria-describedby={attempted && importErrors.size ? errorId('size') : undefined} />{@render error('size')}</label>
          <label><span>Entry premium choice · USD/unit</span><select bind:value={settings.premiumChoice} onchange={() => settings.acknowledgeQuote = false} aria-invalid={attempted && !!importErrors.premiumChoice} aria-describedby={attempted && importErrors.premiumChoice ? errorId('premiumChoice') : undefined}><option value="">Choose explicitly</option><option value="bid" disabled={chainPremium(selected, 'bid', 0) === null}>Observed bid · {value(selected.bid)}</option><option value="ask" disabled={chainPremium(selected, 'ask', 0) === null}>Observed ask · {value(selected.ask)}</option><option value="mid" disabled={chainPremium(selected, 'mid', 0) === null}>Observed midpoint · {value(chainPremium(selected, 'mid', 0))}</option><option value="custom">Custom hypothetical premium</option></select>{@render error('premiumChoice')}</label>
          {#if settings.premiumChoice === 'custom'}<label><span>Custom entry premium · 0–1m USD/unit</span><input type="number" min="0" max="1000000" step="any" value={Number.isFinite(settings.customPremium) ? settings.customPremium : ''} oninput={e => settings.customPremium = e.currentTarget.valueAsNumber} /></label>{/if}
          <label><span>Multiplier · units/contract, 1–1000 ({selected.multiplier === null ? 'unknown: supply explicitly' : 'provider-reported'})</span><input type="number" min="1" max="1000" step="1" value={Number.isFinite(settings.multiplier) ? settings.multiplier : ''} disabled={selected.multiplier !== null} oninput={e => settings.multiplier = e.currentTarget.valueAsNumber} aria-invalid={attempted && !!importErrors.multiplier} aria-describedby={attempted && importErrors.multiplier ? errorId('multiplier') : undefined} />{@render error('multiplier')}</label>
          <label><span>Valuation date · explicit UTC, expiry {selected.expiration}</span><input type="date" min="0001-01-01" max="9999-12-31" bind:value={settings.valuationDate} disabled={!!draft.strategy.valuation_date} aria-invalid={attempted && !!importErrors.valuationDate} aria-describedby={attempted && importErrors.valuationDate ? errorId('valuationDate') : undefined} />{@render error('valuationDate')}{@render error('expiration')}</label>
          <label><span>Annual IV assumption · fraction (0–5)</span><select bind:value={settings.ivChoice} aria-invalid={attempted && !!importErrors.ivChoice} aria-describedby={attempted && importErrors.ivChoice ? errorId('ivChoice') : undefined}><option value="">Choose explicitly</option><option value="draft">Inherit draft base IV · {exactValue(draft.volatility)}</option><option value="quote" disabled={selected.implied_volatility === null}>Observed IV · {value(selected.implied_volatility)}</option><option value="custom">Custom hypothetical IV</option></select>{@render error('ivChoice')}</label>
          {#if settings.ivChoice === 'custom'}<label><span>Custom annual IV fraction · 0–5</span><input type="number" min="0" max="5" step="any" value={Number.isFinite(settings.customIv) ? settings.customIv : ''} oninput={e => settings.customIv = e.currentTarget.valueAsNumber} /></label>{/if}
        </div>
        {#if !draft.strategy.underlying}<label class="check"><input type="checkbox" bind:checked={settings.setUnderlying} /><span>Set the blank draft underlying to {selected.underlying}.</span></label>{/if}{@render error('underlying')}
        {#if settings.premiumChoice && settings.premiumChoice !== 'custom'}<label class="check"><input type="checkbox" bind:checked={settings.acknowledgeQuote} /><span>I explicitly use this displayed quote observation as a hypothetical entry. It may be stale/delayed; no freshness or fill is guaranteed.</span></label>{@render error('acknowledgeQuote')}{/if}
        {#if needsChainModelAcknowledgment(selected)}<label class="check"><input type="checkbox" bind:checked={settings.acknowledgeModel} /><span>I acknowledge this American/physical or unknown provider contract is imported only as a European cash-settled hypothetical model, not an assignment/physical-delivery valuation.</span></label>{@render error('acknowledgeModel')}{/if}
        {#if attempted && Object.keys(importErrors).length}<div class="notice" role="alert"><strong>Correct before importing:</strong><ul>{#each Object.entries(importErrors) as [field, message]}<li>{field}: {message}</li>{/each}</ul></div>{/if}
        <div class="actions"><button type="submit" class="ot-workbench-primary">Confirm {settings.side === 'buy' ? 'Buy (+)' : 'Sell (−)'} {settings.size || '?'} · add to draft (not an order)</button><button type="button" class="ot-workbench-ghost" onclick={() => { selected = null; notice = 'Import cancelled. Draft unchanged.'; }}>Cancel import</button></div>
      </fieldset>
    </form>
  {/if}
</section>

<style>
  .chain { container-type: inline-size; display: grid; gap: 8px; min-width: 0; font: 12px var(--font-family-lato); color: oklch(var(--foreground)); }
  h3, h4, p { margin: 0; } h3, h4 { font-size: 12px; } p, li, small { overflow-wrap: anywhere; line-height: 1.5; } p, small { color: oklch(var(--muted-foreground)); } small { font-size: 12px; }
  form, fieldset { min-width: 0; display: grid; gap: 8px; } fieldset { margin: 0; padding: 8px; border: 1px solid oklch(var(--border)); border-radius: 4px; } legend { padding: 0 4px; font-weight: 700; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr)); gap: 8px; min-width: 0; }
  label { display: grid; gap: 4px; min-width: 0; line-height: 1.5; } .check { display: flex; align-items: start; gap: 8px; } .check input { width: auto; flex: 0 0 auto; min-height: auto; margin-top: 3px; }
  input, select { box-sizing: border-box; min-width: 0; width: 100%; min-height: 32px; padding: 5px 7px; border: 1px solid oklch(var(--input)); border-radius: 4px; background: oklch(var(--background)); color: oklch(var(--foreground)); font: inherit; }
  input[type="number"], td { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; } button { height: auto; min-height: 28px; white-space: normal; overflow-wrap: anywhere; justify-self: start; }
  .notice { padding: 8px; border: 1px solid oklch(var(--border)); color: oklch(var(--foreground)); } .error { color: oklch(var(--foreground)); } [aria-invalid="true"] { border-color: oklch(var(--destructive)); }
  .table-scroll { max-width: 100%; max-height: 360px; overflow: auto; border: 1px solid oklch(var(--border)); }
  table { border-collapse: collapse; width: 100%; } caption { padding: 6px; text-align: left; } th, td { text-align: right; padding: 6px; border-bottom: 1px solid oklch(var(--border)); vertical-align: top; white-space: nowrap; } thead th { position: sticky; top: 0; background: oklch(var(--card)); } tbody th { text-align: left; font-weight: 400; } td small { display: block; white-space: normal; max-width: 260px; }
  button:focus-visible, input:focus-visible, select:focus-visible, .table-scroll:focus-visible { outline: 2px solid oklch(var(--ring)); outline-offset: 2px; }
  @media (pointer: coarse) { button, input, select { min-height: var(--control-touch-height); } .check input { min-height: auto; } }
  @media (forced-colors: active) { fieldset, input, select, .notice, .table-scroll { border-color: CanvasText; } button:focus-visible, input:focus-visible, select:focus-visible, .table-scroll:focus-visible { outline-color: Highlight; } }
</style>

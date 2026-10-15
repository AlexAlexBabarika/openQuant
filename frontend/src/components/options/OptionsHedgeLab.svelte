<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import OptionsLifecycle from './OptionsLifecycle.svelte';
  import type { HedgeRequest, HedgeResponse, OptionsResearchToolProps } from '$lib/features/options/optionsResearchTypes';
  import { simulateHedge } from '$lib/features/options/optionsResearchApi';
  import { hedgeControls, hedgeRequest, validHedge, type HedgeControls } from '$lib/features/options/optionsHedge';
  import { emptyResearchState, inputKey, observationIndex, pathChart, pathControls, ResearchJob, researchValue as value, type PathControls, type ResearchState } from '$lib/features/options/optionsLifecycle';

  let { draft, onEdit, documentKey, readOnly = false }: OptionsResearchToolProps = $props();
  const uid = $props.id();
  let path = $state<PathControls>(untrack(() => pathControls(draft)));
  let settings = $state<HedgeControls>(hedgeControls());
  let runState = $state.raw<ResearchState<HedgeResponse>>(emptyResearchState(untrack(() => documentKey)));
  const job = new ResearchJob<HedgeRequest, HedgeResponse>(untrack(() => documentKey), () => documentKey, next => { runState = next; });
  const prepared = $derived(hedgeRequest(draft, path, settings));
  const key = $derived(inputKey(draft, [path, settings]));
  const visible = $derived(runState.documentKey === documentKey ? runState : null);
  const result = $derived(visible?.result ?? null);
  const stale = $derived(!!result && key !== visible?.submittedKey);
  let index = $state(0);
  let playing = $state(false);
  const active = $derived(result?.ledger[Math.min(index, result.ledger.length - 1)]);
  const chart = $derived(pathChart(result?.ledger.map(row => ({ day: row.day, values: [row.unhedged_pnl, row.hedged_pnl] })) ?? []));
  $effect.pre(() => { const document = documentKey; untrack(() => { job.reset(document); path = pathControls(draft); settings = hedgeControls(); index = 0; playing = false; }); });
  $effect(() => {
    if (!playing || !result) return;
    const timer = setInterval(() => { if (index >= result.ledger.length - 1) playing = false; else index++; }, 500);
    return () => clearInterval(timer);
  });
  onDestroy(() => job.reset('unmounted'));
  async function submit() {
    if (readOnly || !prepared.request || visible?.pending) return;
    playing = false; index = 0;
    await job.submit(structuredClone($state.snapshot(prepared.request)), key, simulateHedge, validHedge);
  }
  function move(key: string) {
    const next = observationIndex(index, result?.ledger.length ?? 0, key);
    if (next !== null) { playing = false; index = next; }
  }
</script>

<section class="hedge-lab" aria-label="Options delta hedging path simulator">
  <header><h3>Delta-hedging path lab</h3><span>Hypothetical · no brokerage execution</span></header>
  <p class="note">Compare the same submitted strategy/path unhedged versus one explicit hedge policy. P&amp;L is not total account equity or a historical options backtest. Whole-strategy delta includes existing stock; the hedge ledger adds separate shares, not duplicate strategy stock.</p>
  <OptionsLifecycle {draft} {onEdit} {documentKey} {readOnly} inputsOnly bind:controls={path} />
  <fieldset disabled={readOnly}>
    <legend>Rebalancing and execution-cost assumptions</legend>
    <div class="fields">
      <label>Hedge policy<select bind:value={settings.mode}><option value="none">None · no hedge</option><option value="daily">Daily · observation-constrained</option><option value="interval">Calendar-day interval</option><option value="delta_threshold">Residual delta threshold</option></select></label>
      {#each ([['interval', 'Interval · calendar days (>0–3650)', 0, 3650], ['threshold', 'Residual delta threshold · equivalent shares (>0–1m)', 0, 1000000], ['maxShares', 'Maximum absolute hedge · shares (>0–10m)', 0, 10000000], ['perShare', 'Cost · USD per share (0–1000)', 0, 1000], ['fixed', 'Fixed cost · USD per nonzero trade (0–10k)', 0, 10000], ['slippage', 'Slippage · basis points (0–1000)', 0, 1000]] as const) as [field, label, min, max]}
        {#if (field !== 'interval' || settings.mode === 'interval') && (field !== 'threshold' || settings.mode === 'delta_threshold')}
          <label>{label}<input type="number" {min} {max} step="any" value={settings[field]} aria-invalid={!!prepared.errors[field]} aria-describedby={`${uid}-${field}-error`} oninput={e => { settings[field] = e.currentTarget.value; }} />{#if prepared.errors[field]}<small id={`${uid}-${field}-error`} class="error">{prepared.errors[field]}</small>{/if}</label>
        {/if}
      {/each}
    </div>
  </fieldset>
  <p class="note">Initial rebalance is allowed (except none). At final path observation all hedge shares are liquidated, with costs; no final rebalance follows. Costs apply to entry, each nonzero trade and liquidation. Daily/interval policies act only at original observations when a boundary has elapsed; sparse paths are not continuous daily hedges. Interpolated expiry points do not invent hedge trades. Undefined delta or a share-cap violation skips trading and is reported, never treated as zero/clipped silently.</p>
  <p class="note">Trades use current observed delta only, with no lookahead or hidden reinvestment. No interest on cash, financing/borrowing debits, dividend cash flows, market impact, or assignment. Slippage is only the explicit basis-point assumption above; zero excludes it. Dividend yield may affect canonical option marks, not dividend cash income.</p>
  {#if Object.keys(prepared.errors).length}<details><summary>Input errors · {Object.keys(prepared.errors).length}</summary><ul>{#each Object.entries(prepared.errors) as [field, message]}<li><strong>{field}</strong>: {message}</li>{/each}</ul></details>{/if}
  <div class="actions">
    <button type="button" class="ot-workbench-primary" disabled={readOnly || !prepared.request || !!visible?.pending} onclick={submit}>{visible?.pending ? (result ? 'Refreshing hedge path…' : 'Simulating hedge path…') : 'Simulate hedge path'}</button>
    <button type="button" class="ot-workbench-ghost" disabled={!visible?.pending} onclick={() => { playing = false; job.cancel(); }}>Cancel request</button>
  </div>
  <div class="feedback" aria-live="polite" aria-atomic="true">
    {#if visible?.pending}<p>{result ? 'Refreshing; previous submitted evidence is retained below.' : 'Simulating the submitted path; no result yet.'}</p>{/if}
    {#if visible?.error}<p role="alert" class="error">{visible.error}</p>{/if}
    {#if visible?.notice}<p>{visible.notice}</p>{/if}
    {#if stale}<p class="notice">STALE INPUTS · Draft, path or hedge settings changed. Simulate explicitly to refresh; old ledger values are unchanged.</p>{/if}
  </div>
  {#if !result && !visible?.pending}<p class="note">No hedge evidence. Submit explicitly. Known returned observations may then be played or scrubbed; playback never generates or reprices a path.</p>{/if}
  {#if result}
    <h4>{visible?.pending ? 'REFRESHING' : stale ? 'STALE INPUTS' : 'SUBMITTED EVIDENCE'} · {result.request.analysis.strategy.name}</h4>
    <p class="note">Submitted policy: {result.request.policy?.mode ?? 'daily'} · source: {result.request.path.source === 'synthetic' ? `seeded synthetic · seed ${result.request.path.seed ?? 1} · ${result.request.path.generator ?? 'gbm_seeded_v1'}` : 'user-supplied assumptions · not verified history'}. {result.provenance.model} v{result.provenance.version} · {result.provenance.day_basis}. These results are session-local, not saved account research.</p>
    <p class="readout">Final unhedged P&amp;L: {value(result.unhedged_final_pnl)} USD · final hedged P&amp;L: {value(result.hedged_final_pnl)} USD. Fixed strategy entry cost: {value(result.lifecycle.net_entry_cost)} USD.</p>
    {#each result.warnings as warning}<p class="notice">{warning}</p>{/each}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard access to bounded chart scrolling.) -->
      <div class="chart-scroll" tabindex="0" role="region" aria-label="Hedge P and L chart; scroll horizontally. Use observation controls below to navigate.">
      <svg viewBox="0 0 660 220" role="img" aria-labelledby={`${uid}-chart-title ${uid}-chart-desc`}>
        <title id={`${uid}-chart-title`}>Submitted unhedged versus hedged P and L · USD over elapsed calendar days</title>
        <desc id={`${uid}-chart-desc`}>Solid: unhedged P and L. Dashed: hedged P and L after costs. Numeric table and observation controls follow. Lines connect only returned observations.</desc>
        <line x1="50" x2="630" y1={chart.y(0)} y2={chart.y(0)} class="axis" />
        {#each chart.paths as series, i}<path d={series} class={`series series-${i}`} />{/each}
        {#if active}<line x1={chart.x(active.day)} x2={chart.x(active.day)} y1="25" y2="185" class="cursor" />{/if}
        <text x="50" y="15">{value(chart.max)} USD</text><text x="50" y="200">{value(chart.min)} USD</text><text x="50" y="216">Day {value(result.ledger[0].day)}</text><text x="630" y="216" text-anchor="end">Day {value(result.ledger[result.ledger.length - 1]?.day)}</text>
      </svg>
    </div>
    <p class="note">Solid: unhedged P&amp;L · dashed: hedged P&amp;L net of costs. Same backend path and fixed strategy entry assumptions. No frontend pricing or hidden random redraws.</p>
    <div class="actions">
      <button type="button" class="ot-workbench-ghost" onclick={() => { if (index >= result.ledger.length - 1) index = 0; playing = !playing; }}>{playing ? 'Pause observations' : 'Play observations'}</button>
      <button type="button" class="ot-workbench-ghost" disabled={index <= 0} onclick={() => move('ArrowLeft')}>Previous</button>
      <button type="button" class="ot-workbench-ghost" disabled={index >= result.ledger.length - 1} onclick={() => move('ArrowRight')}>Next</button>
    </div>
    <label>Chart observation · arrows / Home / End<input type="range" min="0" max={result.ledger.length - 1} step="1" value={index} aria-valuetext={active ? `Day ${active.day}, spot ${active.spot} USD, unhedged P and L ${active.unhedged_pnl} USD, hedged P and L ${active.hedged_pnl} USD` : 'No observation'} oninput={e => { playing = false; index = e.currentTarget.valueAsNumber; }} /></label>
    {#if active}<p class="readout" aria-live="polite">Observation {index + 1}/{result.ledger.length} · day {value(active.day)} · spot {value(active.spot)} USD · unhedged {value(active.unhedged_pnl)} USD · hedged {value(active.hedged_pnl)} USD · delta {value(active.strategy_delta)} equivalent shares · hedge {value(active.hedge_shares)} shares · cash {value(active.hedge_cash)} USD · marked hedge value {value(active.hedge_value)} USD · action {active.action}.</p>{/if}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard access to bounded two-dimensional data scrolling.) -->
      <div class="table-scroll" tabindex="0" role="region" aria-label="Hedge P and L attribution">
      <table><caption>Canonical reconciliation · strategy P&amp;L + hedge trading P&amp;L − costs = total P&amp;L. Financing and dividend cash flows are excluded (zero), not observed income.</caption><thead><tr><th>Component</th><th>Signed USD (costs shown positive)</th></tr></thead><tbody>
        <tr><th>Strategy P&amp;L</th><td>{value(result.attribution.strategy_pnl)}</td></tr><tr><th>Hedge trading P&amp;L</th><td>{value(result.attribution.hedge_trading_pnl)}</td></tr><tr><th>Subtract transaction costs</th><td>{value(result.attribution.transaction_costs)}</td></tr><tr><th>Total P&amp;L</th><td>{value(result.attribution.total_pnl)}</td></tr><tr><th>Financing · excluded</th><td>{value(result.attribution.financing)}</td></tr><tr><th>Dividend cash flows · excluded</th><td>{value(result.attribution.dividends)}</td></tr>
      </tbody></table>
    </div>
    <details open><summary>Hedge trades and exposure ledger · chronological</summary>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard access to bounded two-dimensional data scrolling.) -->
      <div class="table-scroll" tabindex="0" role="region" aria-label="Hedge trades and cash ledger"><table><caption>Every returned observation, including holds/skips. Shares are signed, cash flows/P&amp;L are USD; strategy delta is equivalent shares. Null delta is unavailable, never zero. Select day to scrub.</caption><thead><tr><th>Day</th><th>Spot · USD</th><th>Action</th><th>Strategy delta</th><th>Trade shares</th><th>Trade cash flow</th><th>Cost · USD</th><th>Hedge shares</th><th>Hedge cash</th><th>Hedge value</th><th>Unhedged P&amp;L</th><th>Hedged P&amp;L</th></tr></thead><tbody>{#each result.ledger as row, i}<tr aria-current={i === index ? 'true' : undefined}><th><button type="button" class="ot-workbench-ghost" onclick={() => { playing = false; index = i; }}>Day {value(row.day)}</button></th><td>{value(row.spot)}</td><td>{row.action}</td><td>{value(row.strategy_delta)}</td><td>{value(row.traded_shares)}</td><td>{value(row.trade_cash_flow)}</td><td>{value(row.transaction_cost)}</td><td>{value(row.hedge_shares)}</td><td>{value(row.hedge_cash)}</td><td>{value(row.hedge_value)}</td><td>{value(row.unhedged_pnl)}</td><td>{value(row.hedged_pnl)}</td></tr>{/each}</tbody></table></div>
    </details>
    <details><summary>Underlying strategy lifecycle · marks versus cash settlements</summary>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard access to bounded two-dimensional data scrolling.) -->
      <div class="table-scroll" tabindex="0" role="region" aria-label="Unhedged lifecycle cash and marks"><table><caption>Remaining theoretical/share value is not realized payoff. P&amp;L = settlement cash + remaining value − fixed entry cost.</caption><thead><tr><th>Day</th><th>Spot · USD</th><th>Settlement cash · USD</th><th>Remaining mark · USD</th><th>P&amp;L · USD</th></tr></thead><tbody>{#each result.lifecycle.ledger as row}<tr><th>{value(row.day)}</th><td>{value(row.spot)}</td><td>{value(row.cumulative_settlement_cash)}</td><td>{value(row.remaining_value)}</td><td>{value(row.total_pnl)}</td></tr>{/each}</tbody></table></div>
    </details>
    <details><summary>Returned submitted request · policy, costs, path and provenance</summary><!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard access to bounded submitted-request scrolling.) -->
      <pre tabindex="0" aria-label="Submitted hedge request">{JSON.stringify(result.request, null, 2)}</pre></details>
  {/if}
</section>

<style>
  .hedge-lab { min-width: 0; display: grid; gap: 8px; color: oklch(var(--foreground)); font: 12px var(--font-family-lato); }
  header, .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; } header { justify-content: space-between; } h3, h4, p { margin: 0; } h3 { font-size: 14px; } h4 { font-size: 12px; }
  .note, small { color: oklch(var(--muted-foreground)); line-height: 1.6; overflow-wrap: anywhere; } .error { color: oklch(var(--foreground)); border-left: 3px solid oklch(var(--destructive)); padding-left: 6px; } .notice, .readout { border: 1px dashed oklch(var(--border)); padding: 8px; border-radius: 4px; overflow-wrap: anywhere; line-height: 1.6; }
  fieldset { min-width: 0; padding: 8px; border: 1px solid oklch(var(--border)); border-radius: 4px; } legend, summary { font-weight: 700; } summary { cursor: pointer; padding: 4px 0; }
  .fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr)); gap: 8px; } label { min-width: 0; display: flex; flex-direction: column; gap: 4px; margin: 4px 0; }
  input, select { width: 100%; min-width: 0; min-height: 28px; color: oklch(var(--foreground)); background: oklch(var(--card)); border: 1px solid oklch(var(--input)); border-radius: 4px; padding: 4px 6px; font: inherit; } input[type='range'] { padding: 0; accent-color: oklch(var(--ring)); } button { white-space: normal; height: auto; min-height: 28px; }
  .readout, pre, table { font-family: var(--font-mono); font-variant-numeric: tabular-nums; } pre { max-height: 240px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
  .table-scroll, .chart-scroll { max-width: 100%; overflow: auto; border: 1px solid oklch(var(--border)); } .table-scroll { max-height: min(320px, 55vh); } svg { display: block; min-width: 520px; width: 100%; max-height: 260px; } svg text { fill: currentColor; font: 10px var(--font-mono); }
  .axis { stroke: currentColor; opacity: .35; } .series { stroke: currentColor; fill: none; stroke-width: 2; } .series-1 { stroke-dasharray: 7 4; } .cursor { stroke: currentColor; stroke-dasharray: 3 3; }
  table { border-collapse: collapse; width: 100%; font-size: 11px; } th, td { text-align: right; white-space: nowrap; padding: 6px; border-bottom: 1px solid oklch(var(--border)); } caption { text-align: left; white-space: normal; padding: 8px; font-family: var(--font-family-lato); } thead th { position: sticky; top: 0; background: oklch(var(--card)); } [aria-current='true'] { outline: 1px dashed currentColor; outline-offset: -1px; }
  :is(button, input, select, summary, [tabindex]):focus-visible { outline: 2px solid oklch(var(--ring)); outline-offset: 2px; } [aria-invalid='true'] { border-color: oklch(var(--destructive)); }
  @media (forced-colors: active) { :is(button, input, select, summary, [tabindex]):focus-visible { outline-color: Highlight; } input, select, .notice, .readout, .table-scroll, .chart-scroll { border-color: CanvasText; } }
  @media (pointer: coarse) { button, input, select { min-height: var(--control-touch-height); } }
</style>

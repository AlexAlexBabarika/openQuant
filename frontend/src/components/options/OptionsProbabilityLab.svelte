<script lang="ts">
  import { formatPercent, formatUsd } from '$lib/features/options/optionsFormat';
  import { onDestroy, untrack } from 'svelte';
  import type { OptionsResearchToolProps } from '$lib/features/options/optionsResearchTypes';
  import { analyzeDistribution } from '$lib/features/options/optionsResearchApi';
  import { axisValue, exactValue } from '$lib/features/options/optionsChart';
  import {
    ProbabilityRunner, emptyProbabilityState, probabilityBars, probabilityBinLabel, tallestProbability,
    probabilityErrors, probabilityKey, probabilityPercent, probabilityRequest,
    probabilitySettings, terminalProbabilityPlot,
  } from '$lib/features/options/optionsProbability';

  let { draft, documentKey, readOnly = false }: Omit<OptionsResearchToolProps, 'onEdit'> & {
    onEdit?: OptionsResearchToolProps['onEdit'];
  } = $props();
  const id = $props.id();
  let settings = $state(probabilitySettings());
  let settingsDocument = $state(untrack(() => documentKey));
  let chartWidth = $state(300);
  let flight = $state.raw(emptyProbabilityState());
  const runner = new ProbabilityRunner(analyzeDistribution, next => { flight = next; });
  const errors = $derived(probabilityErrors(draft, settings));
  const inputKey = $derived(`${readOnly}:${probabilityKey(draft, settings)}`);
  const visible = $derived(flight.documentKey === documentKey ? flight : emptyProbabilityState());
  const result = $derived(visible.result);
  const stale = $derived(result !== null && visible.resultKey !== inputKey);
  const width = $derived(Math.max(180, chartWidth));
  const bars = $derived(result ? probabilityBars(result.bins, width) : []);
  const terminal = $derived(result ? terminalProbabilityPlot(result, width) : null);

  $effect(() => {
    const key = documentKey;
    if (key !== untrack(() => settingsDocument)) {
      settingsDocument = key;
      settings = probabilitySettings();
    }
  });
  $effect(() => { runner.context(documentKey, inputKey); });
  onDestroy(() => runner.dispose());

  function compute(event: SubmitEvent) {
    event.preventDefault();
    if (visible.pending) return;
    const request = probabilityRequest($state.snapshot(draft), $state.snapshot(settings));
    if (request) void runner.run(documentKey, inputKey, request);
  }
</script>

<section class="probability-lab" aria-labelledby={`${id}-title`}>
  <header><h3 id={`${id}-title`}>Probability &amp; tail-risk lab</h3><span class="note">Session-local research</span></header>
  <p class="note">Model-implied outcomes, not calibrated real-world forecasts, investment advice or guarantees.</p>
  {#if readOnly}<p class="notice">Read-only strategy: this lab never edits the draft or Python source. Local probability assumptions may be changed and computed explicitly.</p>{/if}
  <form onsubmit={compute} aria-label="Probability model assumptions">
    <div class="controls">
      <label for={`${id}-measure`}>Probability measure
        <select name="probability-measure" id={`${id}-measure`} bind:value={settings.measure} aria-describedby={`${id}-measure-help`}>
          <option value="risk_neutral">Risk-neutral · rate minus yield</option>
          <option value="user_drift">User drift · hypothetical assumption</option>
        </select>
      </label>
      {#if settings.measure === 'user_drift'}
        <label for={`${id}-drift`}>Annual spot drift · fraction, −1 to 1
          <input id={`${id}-drift`} type="number" name="probability-drift" autocomplete="off" min="-1" max="1" step="any" required bind:value={settings.annualDrift} aria-invalid={!!errors.annualDrift} aria-describedby={`${id}-drift-error`} />
          <span id={`${id}-drift-error`} class:notice={!!errors.annualDrift}>{errors.annualDrift ?? '0 means no expected annual spot growth, not zero uncertainty.'}</span>
        </label>
      {/if}
      <label for={`${id}-confidence`}>Tail confidence · fraction, 0.5 &lt; c &lt; 1
        <input id={`${id}-confidence`} type="number" name="probability-confidence" autocomplete="off" min="0.5" max="1" step="any" required bind:value={settings.confidence} aria-invalid={!!errors.confidence} aria-describedby={`${id}-confidence-error`} />
        <span id={`${id}-confidence-error`} class:notice={!!errors.confidence}>{errors.confidence ?? 'Tail loss at c; lower P&L tail has mass 1 − c.'}</span>
      </label>
    </div>
    <p id={`${id}-measure-help`} class="note">Risk-neutral uses the submitted rate minus continuous yield, not an observed real-world return. User drift replaces that annual spot drift only. The terminal distribution uses declared base volatility, not a leg-IV average; pricing-model IV overrides remain distinct and never rewrite entry premiums.</p>
    <details>
      <summary>Bounded numerical resolution</summary>
      <div class="controls">
        <label for={`${id}-bins`}>Histogram bins · integer, 10–100
          <input id={`${id}-bins`} type="number" name="probability-bins" autocomplete="off" min="10" max="100" step="1" required bind:value={settings.bins} aria-invalid={!!errors.bins} aria-describedby={`${id}-bins-error`} />
          <span id={`${id}-bins-error`} class:notice={!!errors.bins}>{errors.bins ?? 'A deterministic atom returns one bin regardless of this count.'}</span>
        </label>
        <label for={`${id}-points`}>Integration points · integer, 256–16384
          <input id={`${id}-points`} type="number" name="probability-integration-points" autocomplete="off" min="256" max="16384" step="1" required bind:value={settings.integrationPoints} aria-invalid={!!errors.integrationPoints} aria-describedby={`${id}-points-error`} />
          <span id={`${id}-points-error`} class:notice={!!errors.integrationPoints}>{errors.integrationPoints ?? 'Bounded normal midpoint quadrature, not historical sampling.'}</span>
        </label>
        <label for={`${id}-tail`}>Truncated tail probability · fraction, 1e−9–0.01
          <input id={`${id}-tail`} type="number" name="probability-tail" autocomplete="off" min="0.000000001" max="0.01" step="any" required bind:value={settings.tailProbability} aria-invalid={!!errors.tailProbability} aria-describedby={`${id}-tail-error`} />
          <span id={`${id}-tail-error`} class:notice={!!errors.tailProbability}>{errors.tailProbability ?? 'Omitted tails are disclosed and retained mass is renormalized.'}</span>
        </label>
      </div>
    </details>
    {#if errors.analysis}<p class="notice">{errors.analysis}</p>{/if}
    {#if errors.horizon}<p class="notice">{errors.horizon}</p>{/if}
    {#if errors.measure}<p class="notice">{errors.measure}</p>{/if}
    <div class="actions">
      <button type="submit" class="ot-workbench-primary" disabled={visible.pending || Object.keys(errors).length > 0}>{visible.pending ? 'Computing…' : 'Compute distribution'}</button>
      {#if visible.pending}<button type="button" class="ot-workbench-ghost" onclick={() => runner.cancel()}>Cancel request</button>{/if}
    </div>
  </form>
  <div class="feedback" aria-live="polite" aria-atomic="true">
    {#if visible.pending}<p>{result ? 'Computing submitted inputs; previous completed evidence remains below.' : 'Computing submitted inputs; no completed evidence yet.'} Client cancellation cannot guarantee server process cancellation.</p>{/if}
    {#if visible.cancelled}<p class="notice">Request cancelled or inputs replaced. Late responses are ignored. Compute explicitly to retry.</p>{/if}
    {#if visible.error}<p role="alert" class="notice">{visible.error}</p>{/if}
    {#if stale}<p class="notice">Stale evidence: draft or probability assumptions changed. All values below still describe the previous submitted snapshot. Compute explicitly to refresh.</p>{/if}
    {#if !result && !visible.pending && !visible.error}<p class="note">No completed distribution. Changing inputs never submits research automatically.</p>{/if}
  </div>

  {#if result}
    <section class="results" aria-labelledby={`${id}-result-title`} aria-busy={visible.pending}>
      <h4 id={`${id}-result-title`}>Submitted distribution · {result.request.analysis.strategy.name}{stale ? ' · stale' : ''}</h4>
      <p class="note">{result.request.measure === 'risk_neutral' ? 'Risk-neutral model' : 'Hypothetical user-drift model'} · {exactValue(result.horizon_days)} calendar days (ACT/365) · USD total strategy P&amp;L · {result.provenance.exercise_style}, {result.provenance.settlement}-settled.</p>
      {#if result.deterministic}<p class="notice">Deterministic point mass: zero volatility and/or zero time removes model randomness. One exact outcome is not a calibrated forecast or a claim that a real position has zero risk.</p>{/if}
      <dl class="metrics">
        <div><dt>Strictly positive P&amp;L · P(P&amp;L &gt; 0)</dt><dd title={exactValue(result.probability_positive_pnl)}>{probabilityPercent(result.probability_positive_pnl)}</dd></div>
        <div><dt>Expected P&amp;L · USD</dt><dd title={exactValue(result.expected_pnl)}>{formatUsd(result.expected_pnl, { signed: true })}</dd></div>
        <div><dt>Value at risk · {probabilityPercent(result.confidence)} · USD loss</dt><dd title={exactValue(result.value_at_risk)}>{formatUsd(result.value_at_risk)}</dd></div>
        <div><dt>Expected shortfall · {probabilityPercent(result.confidence)} · USD loss</dt><dd title={exactValue(result.expected_shortfall)}>{formatUsd(result.expected_shortfall)}</dd></div>
      </dl>
      <p class="note">Loss convention: VaR = max(0, −P&amp;L quantile at 1 − confidence); expected shortfall = max(0, −mean P&amp;L in that lower tail), with fractional point-mass allocation at its boundary. Profitable lower tails floor these loss metrics at zero, not a negative loss. Zero does not establish risk-free returns. Confidence is a tail definition, not a forecast accuracy guarantee.</p>

      {#if terminal}
        <figure>
          <figcaption>Terminal spot probability mass &amp; exact payoff · separate aligned axes</figcaption>
          <div class="plot-container" bind:clientWidth={chartWidth}>
            <svg viewBox={`-4 -8 ${width + 8} 380`} role="img" aria-labelledby={`${id}-terminal-title ${id}-terminal-desc`}>
              <title id={`${id}-terminal-title`}>Terminal price mass and canonical exact payoff</title>
              <desc id={`${id}-terminal-desc`}>Both panels share returned terminal spot in USD on the X axis. Top panel bar height is probability mass scaled to the tallest bar, {formatPercent(terminal.maxProbability)}, not density. Bottom panel is signed total strategy payoff in USD, drawn only from exact canonical backend vertices; no extrapolation. Deterministic atoms use a stem and a single payoff point. Exact table follows.</desc>
              <text x="0" y="12">Probability mass · tallest bar {formatPercent(terminal.maxProbability)}</text>
              <line x1="0" y1="134" x2={width} y2="134" class="axis" />
              {#each terminal.bins as bar}
                {#if bar.bin.lower_spot === bar.bin.upper_spot}
                  <line x1={bar.x} y1={bar.y} x2={bar.x} y2="134" class="atom" /><circle cx={bar.x} cy={bar.y} r="4" class="mass" />
                {:else}<rect x={bar.x} y={bar.y} width={bar.width} height={bar.height} class="mass" />{/if}
              {/each}
              <text x="0" y="154">{axisValue(terminal.lower)}</text><text x={width} y="154" text-anchor="end">{axisValue(terminal.upper)}</text>
              <text x="0" y="172">Terminal spot · USD/unit</text>
              <text x="0" y="198">Exact payoff · USD total</text>
              <line x1="0" y1={terminal.zeroY} x2={width} y2={terminal.zeroY} class="zero" />
              <path d={terminal.payoffPath} class="payoff" />
              {#each terminal.points as point}<circle cx={point.x} cy={point.y} r={terminal.atom ? 4 : 2} class="vertex" />{/each}
              <text x="0" y="216">{axisValue(terminal.maxPnl)} USD</text>
              <text x="0" y="347">{axisValue(terminal.minPnl)} USD</text>
              <text x="0" y="366">{axisValue(terminal.lower)}</text><text x={width} y="366" text-anchor="end">{axisValue(terminal.upper)}</text>
            </svg>
          </div>
          <p class="note">Top: mass per returned terminal-price bin, not density per USD; unequal widths do not imply equal density. Bottom: dashed exact common-expiry P&amp;L vertices, not a probability or a pricing-IV curve. No extrapolation outside returned endpoints. Displayed probabilities are normalized over retained tails, not evidence that omitted-tail losses are bounded.</p>
        </figure>
        <details>
          <summary>Exact terminal-price mass and payoff data</summary>
          <!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard access to the bounded scrolling data region) -->
          <div class="table-scroll" role="region" tabindex="0" aria-label="Exact terminal price bins, scroll horizontally and vertically">
            <table><caption>Terminal price probability · USD per unit, normalized mass not density</caption><thead><tr><th scope="col">Lower spot · USD</th><th scope="col">Upper spot · USD</th><th scope="col">Representative spot · USD</th><th scope="col">Mass · fraction</th><th scope="col">Type</th></tr></thead><tbody>
              {#each result.terminal_price_bins as bin}<tr><td>{exactValue(bin.lower_spot)}</td><td>{exactValue(bin.upper_spot)}</td><td>{exactValue(bin.representative_spot)}</td><td>{exactValue(bin.probability)}</td><td>{bin.lower_spot === bin.upper_spot ? 'Point mass' : 'Price interval'}</td></tr>{/each}
            </tbody></table>
          </div>
          <!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard access to the bounded scrolling data region) -->
          <div class="table-scroll" role="region" tabindex="0" aria-label="Exact canonical terminal payoff vertices, scroll horizontally and vertically">
            <table><caption>Exact terminal payoff vertices · no sampled-grid fallback</caption><thead><tr><th scope="col">Terminal spot · USD/unit</th><th scope="col">Total P&amp;L · USD</th></tr></thead><tbody>
              {#each result.terminal_payoff_curve as point}<tr><td>{exactValue(point.spot)}</td><td>{exactValue(point.pnl, true)}</td></tr>{/each}
            </tbody></table>
          </div>
        </details>
      {/if}

      <figure>
        <figcaption>Returned total P&amp;L probability mass · not probability density</figcaption>
        <svg viewBox={`-4 -10 ${width + 8} 208`} role="img" aria-labelledby={`${id}-pnl-plot-title ${id}-pnl-plot-desc`}>
          <title id={`${id}-pnl-plot-title`}>P&amp;L probability histogram</title>
          <desc id={`${id}-pnl-plot-desc`}>X axis is total P&amp;L in USD; Y height is returned probability mass for each bin, scaled to the tallest bar, not density per USD. Point masses use a vertical stem. Exact values follow in a keyboard-scrollable table.</desc>
          <line x1="0" y1="160" x2={width} y2="160" class="axis" />
          {#each bars as bar}
            {#if bar.atom}
              <line x1={bar.x} y1={bar.y} x2={bar.x} y2="160" class="atom" />
              <circle cx={bar.x} cy={bar.y} r="4" class="mass" />
            {:else}
              <rect x={bar.x} y={bar.y} width={bar.width} height={bar.height} class="mass" />
            {/if}
          {/each}
          <text x="0" y="184">{axisValue(result.bins[0].lower_pnl)} USD</text>
          <text x={width} y="184" text-anchor="end">{axisValue(result.bins[result.bins.length - 1].upper_pnl)} USD</text>
          <text x="0" y="-1">Mass height · tallest bar {formatPercent(tallestProbability(result.bins))}</text>
        </svg>
        <p class="note">Bin heights are probability mass, even for unequal USD widths. Atoms have zero width and nonzero mass; they have no finite probability density. Axis labels are abbreviated; exact returned fractions and USD bounds are in the table.</p>
      </figure>
      <details>
        <summary>Exact P&amp;L bins and quantiles</summary>
        <!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard access to the bounded scrolling data region) -->
        <div class="table-scroll" role="region" tabindex="0" aria-label="Exact P&L probability bins, scroll horizontally and vertically">
          <table><caption>Returned P&amp;L bins · total USD bounds and dimensionless probability mass</caption><thead><tr><th scope="col">P&amp;L range / atom</th><th scope="col">Mass · fraction</th></tr></thead><tbody>
            {#each result.bins as bin}<tr><th scope="row">{probabilityBinLabel(bin)}</th><td>{exactValue(bin.probability)}</td></tr>{/each}
          </tbody></table>
        </div>
        <!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard access to the bounded scrolling data region) -->
        <div class="table-scroll" role="region" tabindex="0" aria-label="Exact model-implied P&L quantiles, scroll horizontally">
          <table><caption>Quantiles · lower-tail probability and signed total P&amp;L in USD</caption><thead><tr><th scope="col">Quantile · fraction</th><th scope="col">P&amp;L · USD</th></tr></thead><tbody>
            {#each result.quantiles as quantile}<tr><th scope="row">{exactValue(quantile.probability)}</th><td>{exactValue(quantile.pnl, true)}</td></tr>{/each}
          </tbody></table>
        </div>
      </details>

      <details>
        <summary>Submitted assumptions, provenance and numerical error</summary>
        <dl class="metrics">
          <div><dt>Source / pricing model</dt><dd>{result.provenance.input_source} / {result.provenance.model} v{result.provenance.version}</dd></div>
          <div><dt>Submitted spot · USD per unit</dt><dd>{exactValue(result.request.analysis.spot)}</dd></div>
          <div><dt>Distribution volatility · annual fraction</dt><dd>{exactValue(result.request.analysis.volatility)} ({probabilityPercent(result.request.analysis.volatility)})</dd></div>
          <div><dt>Resolved annual drift · fraction</dt><dd>{exactValue(result.resolved_annual_drift, true)}</dd></div>
          <div><dt>Rate / continuous yield · annual fractions</dt><dd>{exactValue(result.request.analysis.rate, true)} / {exactValue(result.request.analysis.dividend_yield, true)}</dd></div>
          <div><dt>Entry fee · USD per absolute option contract</dt><dd>{exactValue(result.request.analysis.strategy.entry_fee_per_contract)}</dd></div>
          <div><dt>Underlying / valuation date / common expiry anchor</dt><dd>{result.request.analysis.strategy.underlying ?? 'Unspecified'} / {result.request.analysis.strategy.valuation_date ?? 'Unspecified'} / {result.request.analysis.strategy.expiry_date ?? 'Day-count or per-leg expiry'}</dd></div>
          <div><dt>Method / actual integration points</dt><dd>{result.integration_method} / {exactValue(result.integration_points)}</dd></div>
          <div><dt>Terminal log sigma · dimensionless</dt><dd>{exactValue(result.terminal_log_sigma)}</dd></div>
          <div><dt>Truncated probability · fraction</dt><dd>{exactValue(result.truncated_probability)}</dd></div>
          <div><dt>Retained normalization mass · fraction</dt><dd>{exactValue(result.normalization_mass)}</dd></div>
          <div><dt>Numerical error estimate · as returned</dt><dd>{exactValue(result.numerical_error_estimate)}{result.numerical_error_estimate == null ? ' · unknown, not zero' : ''}</dd></div>
        </dl>
        <p class="note">Fixed signed quantities, explicit premiums and entry fees determine terminal P&amp;L. No premium is inferred from a quote or IV. No exit costs, financing, dividend cash flows, slippage or assignment are modeled. Numerical quadrature/truncation estimates are not statistical sampling confidence or guaranteed error bounds. These results are not saved or cloud-synced.</p>
        <!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard access to the bounded scrolling data region) -->
        <div class="table-scroll" role="region" tabindex="0" aria-label="Submitted strategy legs and source metadata, scroll horizontally">
          <table><caption>Submitted legs · disabled legs excluded from outcomes</caption><thead><tr><th scope="col">Leg / state</th><th scope="col">Signed quantity</th><th scope="col">Multiplier · units/contract</th><th scope="col">Entry · USD/unit</th><th scope="col">Pricing IV · annual fraction</th><th scope="col">Expiry override</th><th scope="col">Source</th></tr></thead><tbody>
            {#each result.request.analysis.strategy.legs as leg, index}<tr><th scope="row">{index + 1} {leg.kind} · {leg.enabled ? 'enabled' : 'disabled'}</th><td>{exactValue(leg.quantity, true)} {leg.kind === 'underlying' ? 'shares' : 'contracts'}</td><td>{exactValue(leg.multiplier)}</td><td>{exactValue(leg.entry_premium)}</td><td>{leg.kind === 'underlying' ? 'Not applicable' : exactValue(leg.implied_volatility ?? result.request.analysis.volatility)}</td><td>{leg.expiry_date ?? (leg.days_to_expiry != null ? `${exactValue(leg.days_to_expiry)} days` : 'Inherits default')}</td><td>{leg.source ? `${leg.source.provider} / ${leg.source.environment} / ${leg.source.contract_symbol} · ${leg.source.observed_exercise_style ?? 'unknown'} / ${leg.source.observed_settlement ?? 'unknown'}` : 'Manual / unspecified'}</td></tr>{/each}
          </tbody></table>
        </div>
      </details>
      {#if result.warnings.length}<aside aria-label="Returned distribution warnings"><h4>Model / numerical warnings</h4><ul>{#each result.warnings as warning}<li>{warning}</li>{/each}</ul></aside>{/if}
    </section>
  {/if}
</section>

<style>
  .probability-lab { min-width: 0; display: grid; gap: 8px; font-size: 12px; color: oklch(var(--foreground)); }
  header, .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  header { justify-content: space-between; }
  h3, h4, p, figure, dl { margin: 0; }
  h3 { font-size: 13px; } h4 { font-size: 12px; }
  form, .results, details, .feedback { display: grid; gap: 8px; min-width: 0; }
  .controls, .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 230px), 1fr)); gap: 8px; min-width: 0; }
  label { display: grid; align-content: start; gap: 4px; min-width: 0; }
  input, select { width: 100%; min-width: 0; min-height: 28px; border: 1px solid oklch(var(--border)); border-radius: 4px; background: oklch(var(--background)); color: inherit; padding: 4px 6px; font: inherit; }
  .actions button { min-height: 28px; height: auto; white-space: normal; }
  .note, label span { font-size: 11px; color: oklch(var(--muted-foreground)); line-height: 1.5; }
  .notice { border-left: 2px solid oklch(var(--foreground)); padding-left: 8px; line-height: 1.5; }
  .metrics > div { min-width: 0; padding: 6px; border: 1px solid oklch(var(--border)); border-radius: 4px; }
  dt { font-size: 11px; color: oklch(var(--muted-foreground)); } dd { margin: 4px 0 0; overflow-wrap: anywhere; }
  dd, td { font-variant-numeric: tabular-nums; }
  figure { min-width: 0; padding: 8px; border: 1px solid oklch(var(--border)); border-radius: 4px; }
  figcaption { margin-bottom: 8px; } svg { display: block; width: 100%; min-height: 120px; overflow: visible; }
  svg text { fill: currentColor; font-variant-numeric: tabular-nums; font-size: 11px; }
  .axis { stroke: currentColor; } .mass { fill: oklch(var(--chart-2)); stroke: oklch(var(--foreground)); stroke-width: 0.6; }
  .atom { stroke: oklch(var(--chart-2)); stroke-width: 3; }
  .payoff { fill: none; stroke: oklch(var(--foreground)); stroke-width: 2; stroke-dasharray: 6 3; }
  .vertex { fill: oklch(var(--foreground)); } .zero { stroke: currentColor; stroke-dasharray: 2 4; stroke-width: 0.6; }
  .plot-container { min-width: 0; }
  summary { cursor: pointer; min-height: 28px; padding: 4px 0; }
  .table-scroll { overflow: auto; max-height: 300px; max-width: 100%; min-width: 0; border: 1px solid oklch(var(--border)); border-radius: 4px; }
  table { border-collapse: collapse; min-width: 100%; font-size: 11px; } caption { text-align: left; padding: 8px; }
  th, td { padding: 6px 8px; border-bottom: 1px solid oklch(var(--border)); text-align: right; white-space: nowrap; }
  th:first-child { text-align: left; } thead { background: oklch(var(--card)); }
  :is(input, select, button, summary, .table-scroll):focus-visible { outline: 2px solid oklch(var(--foreground)); outline-offset: 2px; }
  [aria-invalid="true"] { border-style: dashed; }
  @media (max-width: 480px) { .controls, .metrics { grid-template-columns: minmax(0, 1fr); } }
  @media (forced-colors: active) {
    :is(input, select, button, summary, .table-scroll):focus-visible { outline-color: Highlight; }
    .mass { fill: Highlight; stroke: CanvasText; } .atom, .axis, .payoff { stroke: CanvasText; } .vertex { fill: CanvasText; }
    .notice { border-color: CanvasText; }
  }
</style>

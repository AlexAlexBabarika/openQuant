<script lang="ts">
  import type { GreekKey, OptionsAnalysis } from '$lib/features/options/optionsTypes';
  import {
    GREEK_KEYS, axisValue, domainTicks, exactValue, finiteValue, greekPlotError,
    greekSeries, keyboardIndex, nearestIndex, optionsSeries, plotError, priceDomain,
    priceMarkers, sampledYDomain, scaleValue, seriesPoints, svgPath, validateDomain,
    zoomDomain,
  } from '$lib/features/options/optionsChart';
  import type { Domain } from '$lib/features/options/optionsChart';

  let { result = null, spot }: { result?: OptionsAnalysis | null; spot?: number } = $props();
  const id = $props.id();
  let containerWidth = $state(360);
  let view = $state<Domain | null>(null);
  let minimum = $state('');
  let maximum = $state('');
  let domainError = $state('');
  let selected = $state<number | null>(null);
  let greek = $state<GreekKey>('delta');
  const width = $derived(Math.max(240, containerWidth));
  const left = 64, right = 18;
  const plotWidth = $derived(width - left - right);
  const full = $derived(result ? priceDomain(result.spot_grid) : null);
  const domain = $derived(view ?? full);
  const error = $derived(result ? plotError(result) : null);
  const curves = $derived(result ? optionsSeries(result) : []);
  const points = $derived(result ? curves.map(s => seriesPoints(result.spot_grid, s.values)) : []);
  const pnlY = $derived(domain ? sampledYDomain(points, domain) : { min: -1, max: 1 });
  const greekCurves = $derived(result ? greekSeries(result, greek) : []);
  const greekPoints = $derived(result ? greekCurves.map(s => seriesPoints(result.spot_grid, s.values)) : []);
  const greekY = $derived(domain ? sampledYDomain(greekPoints, domain) : { min: -1, max: 1 });
  const greekError = $derived(result ? greekPlotError(result, greek) : null);
  const markers = $derived(result ? priceMarkers(result) : []);
  const activeIndex = $derived(result && domain && selected != null &&
    result.spot_grid[selected] >= domain.min && result.spot_grid[selected] <= domain.max ? selected : null);
  const activeSpot = $derived(result && activeIndex != null ? result.spot_grid[activeIndex] : null);
  const drift = $derived(result && finiteValue(spot) && spot !== result.request.spot);
  const unit = $derived(result?.greek_units[greek] ?? '');

  $effect(() => {
    const grid = result?.spot_grid;
    view = null;
    selected = null;
    domainError = '';
    const bounds = grid ? priceDomain(grid) : null;
    minimum = bounds ? String(bounds.min) : '';
    maximum = bounds ? String(bounds.max) : '';
  });

  function setDomain(next: Domain) {
    view = next;
    minimum = String(next.min);
    maximum = String(next.max);
    selected = null;
    domainError = '';
  }

  function applyDomain(event: SubmitEvent) {
    event.preventDefault();
    if (!full) return;
    const next = minimum.trim() && maximum.trim() ? validateDomain(Number(minimum), Number(maximum), full) : null;
    if (!next) {
      domainError = `Use finite USD prices with ${exactValue(full.min)} ≤ minimum < maximum ≤ ${exactValue(full.max)}.`;
      return;
    }
    setDomain(next);
  }

  function keydown(event: KeyboardEvent) {
    if (!result || !domain) return;
    const key = event.key === 'ArrowUp' ? 'ArrowRight' : event.key === 'ArrowDown' ? 'ArrowLeft' : event.key;
    const next = keyboardIndex(result.spot_grid, domain, activeIndex, key);
    if (next !== undefined) { event.preventDefault(); selected = next; }
  }

  function inspect(event: PointerEvent) {
    if (!result || !domain) return;
    const bounds = event.currentTarget instanceof SVGSVGElement ? event.currentTarget.getBoundingClientRect() : null;
    if (!bounds || !bounds.width) return;
    const pixel = ((event.clientX - bounds.left) / bounds.width) * width - left;
    if (pixel < 0 || pixel > plotWidth) { selected = null; return; }
    const price = scaleValue(pixel, { min: 0, max: plotWidth }, domain.min, domain.max);
    selected = nearestIndex(result.spot_grid, price, domain);
  }

  function x(price: number) { return domain ? left + scaleValue(price, domain, 0, plotWidth) : left; }
  function inView(price: number) { return finiteValue(price) && domain && price >= domain.min && price <= domain.max; }
  function sliderSpot() {
    return domain ? Math.max(domain.min, Math.min(domain.max, activeSpot ?? result?.request.spot ?? domain.min)) : 0;
  }
</script>

<section class="options-charts" aria-label="Options research charts">
  {#if !result}
    <div class="empty"><strong>Price-domain research</strong><p>Analyze manual inputs to see expiration, today and scenario P&amp;L, plus theoretical Greek exposures.</p></div>
  {:else if error}
    <div class="empty" role="alert"><strong>Chart data unavailable</strong><p>{error} Edit the inputs and analyze again.</p></div>
  {:else if domain && full}
    <header>
      <div><span class="eyebrow">MANUAL · EUROPEAN · CASH SETTLED</span><h3>{result.request.strategy.name}</h3></div>
      <div class="context">Submitted spot <b>{exactValue(result.request.spot)} USD</b><br />{exactValue(result.request.strategy.days_to_expiry)} calendar days · ACT/365</div>
    </header>
    {#if drift}<p class="notice">Draft spot changed. Charts still show the returned analysis at {exactValue(result.request.spot)} USD; analyze again to refresh.</p>{/if}

    <form class="domain-controls" onsubmit={applyDomain} aria-label="Numeric price view">
      <label for={`${id}-minimum`}>From (USD)<input id={`${id}-minimum`} type="text" inputmode="decimal" bind:value={minimum} aria-invalid={!!domainError} aria-describedby={`${id}-domain-note`} /></label>
      <label for={`${id}-maximum`}>To (USD)<input id={`${id}-maximum`} type="text" inputmode="decimal" bind:value={maximum} aria-invalid={!!domainError} aria-describedby={`${id}-domain-note`} /></label>
      <div class="actions">
        <button type="submit">Apply view</button>
        <button type="button" onclick={() => setDomain(zoomDomain(domain, full, 0.5, activeSpot ?? undefined))} aria-label="Zoom in price domain">Zoom +</button>
        <button type="button" onclick={() => setDomain(zoomDomain(domain, full, 2))} aria-label="Zoom out price domain">Zoom −</button>
        <button type="button" onclick={() => setDomain(full)}>Reset</button>
      </div>
    </form>
    <p id={`${id}-domain-note`} class:notice={!!domainError} class="note" role={domainError ? 'alert' : undefined}>{domainError || `View ${exactValue(domain.min)}–${exactValue(domain.max)} USD. Zoom changes display only, not the analysis.`}</p>

    <div class="pane-title"><h4>P&amp;L by underlying price</h4><span>USD · signed strategy total</span></div>
    <div class="legend" aria-label="P&L series legend">
      {#each curves as curve (curve.id)}
        <span class="legend-item"><svg class={`swatch ${curve.tone}`} viewBox="0 0 28 10" aria-hidden="true"><path d="M0,5 L28,5" stroke-dasharray={curve.dash} /></svg>{curve.label}</span>
      {/each}
    </div>
    <div class="graph" bind:clientWidth={containerWidth}>
      <div class="chart-control" role="slider" tabindex="0" aria-label="Inspect P&L at supplied price samples" aria-valuemin={domain.min} aria-valuemax={domain.max} aria-valuenow={sliderSpot()} aria-valuetext={activeSpot == null ? 'No sample selected' : `${exactValue(activeSpot)} USD; values in readout below`} aria-describedby={`${id}-instructions`} onkeydown={keydown}>
        <svg viewBox={`0 0 ${width} 254`} role="img" aria-label={`Expiration, today and scenario P&L for ${result.request.strategy.name}; underlying price in USD on x-axis, total P&L in USD on y-axis`} onpointermove={inspect} onpointerdown={inspect}>
          <title>Options P&amp;L over numeric underlying price</title>
          <desc>Lines connect returned samples only. Dashed vertical lines mark strikes, dotted lines mark expiration breakevens, solid line marks submitted spot. Exact values are below.</desc>
          <defs><clipPath id={`${id}-pnl-clip`}><rect x={left} y="24" width={plotWidth} height="184" /></clipPath></defs>
          {#each domainTicks(pnlY, 5) as tick}
            {@const py = scaleValue(tick, pnlY, 208, 24)}
            <line class="grid" x1={left} x2={width-right} y1={py} y2={py} />
            <text class="axis" x={left-7} y={py+3} text-anchor="end">{axisValue(tick)}</text>
          {/each}
          <text class="axis" x={left} y="13">P&amp;L (USD)</text>
          <g clip-path={`url(#${id}-pnl-clip)`}>
            {#each result.summary.zero_intervals as interval}
              {#if interval.start <= domain.max && (interval.end == null || interval.end >= domain.min)}
                <rect class="zero-interval" x={x(Math.max(domain.min, interval.start))} y={scaleValue(0, pnlY, 208, 24)-3} width={Math.max(0, x(Math.min(domain.max, interval.end ?? domain.max))-x(Math.max(domain.min, interval.start)))} height="6"><title>Expiration zero P&amp;L from {exactValue(interval.start)} to {interval.end == null ? 'infinity' : exactValue(interval.end)} USD</title></rect>
              {/if}
            {/each}
            <line class="zero-line" x1={left} x2={width-right} y1={scaleValue(0, pnlY, 208, 24)} y2={scaleValue(0, pnlY, 208, 24)} />
            {#each markers.filter(m => inView(m.spot)) as marker}
              <line class={`marker ${marker.kind}`} x1={x(marker.spot)} x2={x(marker.spot)} y1="24" y2="208"><title>{marker.label}</title></line>
            {/each}
            {#each curves as curve, i (curve.id)}
              <path class={`curve ${curve.tone}`} d={svgPath(points[i], domain, pnlY, plotWidth, 24, 208)} transform={`translate(${left},0)`} stroke-dasharray={curve.dash} />
            {/each}
            {#if activeSpot != null && activeIndex != null}
              <line class="crosshair" x1={x(activeSpot)} x2={x(activeSpot)} y1="24" y2="208" />
              {#each curves as curve (curve.id)}
                {#if finiteValue(curve.values[activeIndex])}<circle class={`point ${curve.tone}`} cx={x(activeSpot)} cy={scaleValue(curve.values[activeIndex] as number, pnlY, 208, 24)} r="3.5" />{/if}
              {/each}
            {/if}
          </g>
          {#each domainTicks(domain) as tick, i}
            <text class="axis" x={x(tick)} y="226" text-anchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}>{axisValue(tick)}</text>
          {/each}
          <text class="axis" x={left+plotWidth/2} y="244" text-anchor="middle">Underlying price (USD)</text>
        </svg>
      </div>
    </div>
    <p class="marker-key">Solid vertical: submitted spot · dashed: strike · dotted: expiration breakeven · horizontal: zero P&amp;L</p>
    <p id={`${id}-instructions`} class="note">Hover or touch to inspect supplied samples. Focus either chart: arrows, Home/End to select; Escape to clear. Axes use up to 4 significant digits or scientific notation; readouts and tables are unrounded. Lines identify series, not gain/loss.</p>
    {#if !result.spot_grid.some(s => inView(s))}<p class="notice">No supplied samples inside this zoomed view. Lines may show clipped connections between neighboring samples; zoom out or reset to inspect exact values.</p>{/if}
    {#if curves.some(c => c.values.some(v => !finiteValue(v)))}<p class="notice">Some returned P&amp;L values are unavailable. Paths break at missing/nonfinite values; see exact-value data.</p>{/if}
    <div class="readout" aria-live="polite" aria-atomic="true">
      {#if activeIndex != null && activeSpot != null}
        <strong>Sample spot {exactValue(activeSpot)} USD</strong>
        <dl>{#each curves as curve (curve.id)}<div><dt>{curve.label} P&amp;L</dt><dd>{exactValue(curve.values[activeIndex], true)} USD</dd></div>{/each}
          <div><dt>Today {greek}</dt><dd>{exactValue(greekCurves[0]?.values[activeIndex], true)} · {unit}</dd></div>
        </dl>
      {:else}<span>Select a price sample to inspect exact returned values. No sampled view is a maximum profit/loss estimate.</span>{/if}
    </div>

    <div class="pane-title greek-heading"><div><h4>Greek exposure by price</h4><p class="note">Today only · signed, quantity × multiplier weighted</p></div>
      <label for={`${id}-greek`}>Greek<select id={`${id}-greek`} bind:value={greek}>{#each GREEK_KEYS as key}<option value={key}>{key}</option>{/each}</select></label>
    </div>
    <p class="unit">{greek} · {unit}</p>
    {#if greekError}<p class="notice" role="status">{greekError}</p>{/if}
    <div class="chart-control" role="slider" tabindex="0" aria-label={`Inspect today ${greek} at supplied price samples`} aria-valuemin={domain.min} aria-valuemax={domain.max} aria-valuenow={sliderSpot()} aria-valuetext={activeSpot == null ? 'No sample selected' : `${exactValue(activeSpot)} USD; ${exactValue(greekCurves[0]?.values[activeIndex ?? -1], true)} ${unit}`} aria-describedby={`${id}-instructions`} onkeydown={keydown}>
      <svg viewBox={`0 0 ${width} 194`} role="img" aria-label={`Today ${greek}, ${unit}, over underlying price in USD; aligned with P&L pane`} onpointermove={inspect} onpointerdown={inspect}>
        <title>Today {greek} by underlying price</title><desc>Only backend greeks_grid values are plotted. Null Greeks form gaps, never zeros. Scenario aggregate values are listed separately at the submitted spot.</desc>
        <defs><clipPath id={`${id}-greek-clip`}><rect x={left} y="20" width={plotWidth} height="128" /></clipPath></defs>
        {#if !greekError}
          {#each domainTicks(greekY) as tick}
            {@const py = scaleValue(tick, greekY, 148, 20)}
            <line class="grid" x1={left} x2={width-right} y1={py} y2={py} />
            <text class="axis" x={left-7} y={py+3} text-anchor="end">{axisValue(tick)}</text>
          {/each}
          <g clip-path={`url(#${id}-greek-clip)`}>
            <line class="zero-line" x1={left} x2={width-right} y1={scaleValue(0, greekY, 148, 20)} y2={scaleValue(0, greekY, 148, 20)} />
            {#each markers.filter(m => inView(m.spot)) as marker}<line class={`marker ${marker.kind}`} x1={x(marker.spot)} x2={x(marker.spot)} y1="20" y2="148" />{/each}
            <path class="curve today" d={svgPath(greekPoints[0], domain, greekY, plotWidth, 20, 148)} transform={`translate(${left},0)`} stroke-dasharray="7 4" />
            {#if activeSpot != null && activeIndex != null}
              <line class="crosshair" x1={x(activeSpot)} x2={x(activeSpot)} y1="20" y2="148" />
              {#if finiteValue(greekCurves[0].values[activeIndex])}<circle class="point today" cx={x(activeSpot)} cy={scaleValue(greekCurves[0].values[activeIndex] as number, greekY, 148, 20)} r="3.5" />{/if}
            {/if}
          </g>
        {:else}<text class="axis" x={left+plotWidth/2} y="86" text-anchor="middle">{greek}: unavailable</text>{/if}
        {#each domainTicks(domain) as tick, i}<text class="axis" x={x(tick)} y="166" text-anchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}>{axisValue(tick)}</text>{/each}
        <text class="axis" x={left+plotWidth/2} y="186" text-anchor="middle">Underlying price (USD)</text>
      </svg>
    </div>
    <div class="aggregate"><strong>{greek} at submitted spot {exactValue(result.request.spot)} USD</strong><dl>
      <div><dt>Today</dt><dd>{exactValue(result.greeks[greek], true)} · {unit}</dd></div>
      {#each result.scenarios as scenario}<div><dt>{scenario.name}</dt><dd>{exactValue(scenario.greeks[greek], true)} · {unit}</dd></div>{/each}
    </dl><p class="note">Scenario Greeks are point exposures, not curves. Unavailable means undefined or not reported, never zero.</p></div>

    <details class="evidence"><summary>Expiry geometry · exact backend values</summary>
      <dl><div><dt>Maximum profit (USD)</dt><dd>{result.summary.profit_unbounded ? 'Unbounded' : exactValue(result.summary.max_profit)}</dd></div>
        <div><dt>Maximum loss (USD)</dt><dd>{result.summary.loss_unbounded ? 'Unbounded' : exactValue(result.summary.max_loss)}</dd></div>
        <div><dt>Expiration breakevens (USD)</dt><dd>{result.summary.breakevens.length ? result.summary.breakevens.map(v => exactValue(v)).join(', ') : 'None'}</dd></div>
        <div><dt>Zero P&amp;L intervals (USD)</dt><dd>{result.summary.zero_intervals.length ? result.summary.zero_intervals.map(z => `[${exactValue(z.start)}, ${z.end == null ? '∞' : exactValue(z.end)}]`).join(', ') : 'None'}</dd></div>
        <div><dt>Enabled option strikes (USD)</dt><dd>{markers.filter(m => m.kind === 'strike').map(m => exactValue(m.spot)).join(', ') || 'None'}</dd></div>
      </dl><p class="note">Expiry limits and roots cover all nonnegative prices, including outside this view. Sampled chart bounds are not risk limits. Lines are straight connections of supplied samples, not additional model evaluations.</p>
    </details>
    <details class="evidence"><summary>Exact-value data · all returned price samples</summary>
      <p class="note">Unrounded signed values. Missing/nonfinite values are unavailable; they are omitted from plots. The table is independent of display zoom.</p>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard access to horizontal table scrolling) -->
      <div class="table-scroll" role="region" aria-label="Exact options price data" tabindex="0">
        <table><caption>P&amp;L and today {greek}; {unit}</caption><thead><tr><th scope="col">Spot (USD)</th>{#each curves as curve (curve.id)}<th scope="col">{curve.label} P&amp;L (USD)</th>{/each}<th scope="col">Today {greek}</th></tr></thead>
          <tbody>{#each result.spot_grid as price, i}<tr><th scope="row">{exactValue(price)}</th>{#each curves as curve (curve.id)}<td>{exactValue(curve.values[i], true)}</td>{/each}<td>{exactValue(greekCurves[0]?.values[i], true)}</td></tr>{/each}</tbody>
        </table>
      </div>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard access to horizontal table scrolling) -->
      <div class="table-scroll" role="region" aria-label="All exact aggregate Greeks" tabindex="0">
        <table><caption>Aggregate Greeks at submitted spot {exactValue(result.request.spot)} USD</caption><thead><tr><th scope="col">Greek / unit</th><th scope="col">Today</th>{#each result.scenarios as scenario}<th scope="col">{scenario.name}</th>{/each}</tr></thead><tbody>
          {#each GREEK_KEYS as key}<tr><th scope="row">{key}<span class="table-unit">{result.greek_units[key]}</span></th><td>{exactValue(result.greeks[key], true)}</td>{#each result.scenarios as scenario}<td>{exactValue(scenario.greeks[key], true)}</td>{/each}</tr>{/each}
        </tbody></table>
      </div>
    </details>
    <details class="evidence"><summary>Model assumptions &amp; scenario context</summary><p class="note">Manual inputs · Black–Scholes–Merton v{result.model.version} · European cash settlement · ACT/365. No provider snapshot or historical options execution.</p>
      <dl>{#each result.scenarios as scenario}<div><dt>{scenario.name}</dt><dd>{exactValue(scenario.elapsed_days)} days elapsed · {exactValue(scenario.remaining_days)} remaining · IV {exactValue(scenario.volatility)} annual fraction</dd></div>{/each}</dl>
      <ul>{#each result.warnings as warning}<li>{warning}</li>{/each}</ul>
    </details>
  {/if}
</section>

<style>
  .options-charts { min-width: 0; color: oklch(var(--foreground)); font-family: var(--font-family-lato); font-size: 12px; }
  header, .pane-title { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
  header { padding: 10px 0; border-bottom: 1px solid oklch(var(--border)); }
  h3, h4, p { margin: 0; }
  h3 { margin-top: 4px; font-size: 15px; overflow-wrap: anywhere; }
  h4 { font-size: 12px; }
  .eyebrow, .context, .note, .marker-key, .unit, .pane-title > span { color: oklch(var(--muted-foreground)); }
  .eyebrow { font: 10px var(--font-mono); }
  .context { font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
  .context b { color: oklch(var(--foreground)); font-family: var(--font-mono); }
  .domain-controls { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px; margin: 12px 0 6px; }
  label { display: flex; flex-direction: column; gap: 4px; font-size: 11px; }
  .domain-controls label { flex: 1 1 90px; min-width: 0; max-width: 140px; }
  input, select, button { min-height: 28px; border: 1px solid oklch(var(--input)); border-radius: 4px; background: oklch(var(--card)); color: oklch(var(--foreground)); font: inherit; }
  input { width: 100%; min-width: 0; padding: 3px 6px; font-family: var(--font-mono); }
  select { padding: 3px 8px; }
  button { padding: 3px 8px; cursor: pointer; white-space: nowrap; }
  button:hover { background: oklch(var(--accent)); }
  .actions { display: flex; flex-wrap: wrap; gap: 6px; }
  button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible, .chart-control:focus-visible, .table-scroll:focus-visible { outline: 2px solid oklch(var(--ring)); outline-offset: 2px; }
  .note, .marker-key { font-size: 11px; line-height: 1.55; margin: 6px 0; overflow-wrap: anywhere; }
  .notice { padding: 8px; margin: 8px 0; border: 1px dashed oklch(var(--input)); border-radius: 4px; color: oklch(var(--foreground)); background: oklch(var(--background)); line-height: 1.5; overflow-wrap: anywhere; }
  .pane-title { margin-top: 14px; }
  .legend { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 8px 0; }
  .legend-item { display: inline-flex; align-items: center; gap: 5px; min-width: 0; overflow-wrap: anywhere; }
  .swatch { width: 28px; height: 10px; flex: 0 0 28px; }
  .swatch path { stroke: currentColor; stroke-width: 2; fill: none; }
  .graph { min-width: 0; width: 100%; }
  .chart-control { width: 100%; border-radius: 4px; background: oklch(var(--card)); }
  .chart-control > svg { display: block; width: 100%; touch-action: pan-y; }
  .grid { stroke: var(--chart-grid); stroke-width: 1; }
  .axis { fill: oklch(var(--muted-foreground)); font: 10px var(--font-mono); font-variant-numeric: tabular-nums; }
  .curve { fill: none; stroke: currentColor; stroke-width: 2; vector-effect: non-scaling-stroke; }
  .expiry { color: oklch(var(--chart-2)); }
  .today { color: oklch(var(--ring)); }
  .scenario1 { color: oklch(var(--risk)); }
  .scenario2 { color: oklch(var(--down-color)); }
  .scenario3 { color: oklch(var(--chart-3)); }
  .point { fill: oklch(var(--card)); stroke: currentColor; stroke-width: 2; }
  .marker { stroke: oklch(var(--muted-foreground)); stroke-width: 1; }
  .strike { stroke-dasharray: 8 5; }
  .breakeven { stroke: oklch(var(--chart-2)); stroke-dasharray: 2 4; }
  .spot { stroke-width: 1.5; }
  .zero-line { stroke: oklch(var(--foreground)); stroke-width: 1; }
  .zero-interval { fill: oklch(var(--chart-2)); opacity: 0.3; }
  .crosshair { stroke: oklch(var(--foreground)); stroke-dasharray: 3 3; }
  .readout, .aggregate { padding: 10px; border: 1px solid oklch(var(--border)); border-radius: 4px; background: oklch(var(--background)); line-height: 1.5; overflow-wrap: anywhere; }
  .readout { min-height: 60px; }
  .aggregate { margin: 6px 0 10px; }
  .unit { margin: 5px 0; font-size: 11px; overflow-wrap: anywhere; }
  dl { margin: 8px 0 0; }
  dl > div { display: grid; grid-template-columns: minmax(85px, 1fr) minmax(0, 2fr); gap: 8px; margin: 5px 0; }
  dt { color: oklch(var(--muted-foreground)); overflow-wrap: anywhere; }
  dd { margin: 0; font-family: var(--font-mono); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  .evidence { padding: 8px 0; border-top: 1px solid oklch(var(--border)); }
  summary { cursor: pointer; font-size: 12px; font-weight: 700; line-height: 1.6; }
  .table-scroll { overflow: auto; max-height: 340px; margin-top: 8px; border: 1px solid oklch(var(--border)); }
  table { border-collapse: collapse; width: 100%; font: 11px var(--font-mono); font-variant-numeric: tabular-nums; }
  caption { text-align: left; padding: 8px; font-family: var(--font-family-lato); background: oklch(var(--background)); }
  th, td { padding: 7px 8px; border-bottom: 1px solid oklch(var(--border)); text-align: right; white-space: nowrap; }
  thead th { position: sticky; top: 0; background: oklch(var(--card)); z-index: 1; }
  th:first-child { text-align: left; }
  .table-unit { display: block; max-width: 210px; white-space: normal; font: 11px var(--font-family-lato); color: oklch(var(--muted-foreground)); }
  ul { padding-left: 18px; line-height: 1.6; }
  .empty { padding: 16px; border: 1px dashed oklch(var(--border)); border-radius: 4px; line-height: 1.6; }
  .empty p { color: oklch(var(--muted-foreground)); margin-top: 6px; }
  @media (max-width: 420px) { header { align-items: flex-start; } .actions { flex-basis: 100%; } .pane-title > span { flex-basis: 100%; } }
  @media (forced-colors: active) {
    .curve, .point, .marker, .zero-line, .crosshair, .swatch path { stroke: CanvasText; }
    .grid { stroke: GrayText; }
    .axis { fill: CanvasText; }
    .zero-interval { fill: Highlight; }
    button, input, select { border-color: ButtonText; }
    button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible, .chart-control:focus-visible, .table-scroll:focus-visible { outline-color: Highlight; }
  }
</style>

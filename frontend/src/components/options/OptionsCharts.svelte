<script lang="ts">
  import { untrack } from 'svelte';
  import type { GreekKey, OptionsAnalysis, OptionsDraft } from '$lib/features/options/optionsTypes';
  import { requestChanged } from '$lib/features/options/optionsScenario';
  import { optionsErrors } from '$lib/features/options/optionsValidation';
  import {
    STRIKE_STEPS, MAX_STRIKE, validStrike, snapStrike, strikeAtClientX,
    moveStrikeDrag, finishStrikeDrag, applyStrikeEdit, isolatedLegRequest,
    canonicalOverlay, requestChartAnalysis, ChartRequestGate, chartContextKey,
  } from '$lib/features/options/optionsChartEditing';
  import type { StrikeDrag } from '$lib/features/options/optionsChartEditing';
  import {
    GREEK_KEYS, axisValue, domainTicks, exactValue, finiteValue, greekPlotError,
    greekSeries, keyboardIndex, nearestIndex, optionsSeries, plotError, priceDomain,
    priceMarkers, sampledYDomain, scaleValue, seriesPoints, svgPath, validateDomain,
    zoomDomain, expiryTraceError, inspectionGrid, seriesValue, legBreakdownError,
  } from '$lib/features/options/optionsChart';
  import type { Domain } from '$lib/features/options/optionsChart';

  let { result = null, spot, draft, onEdit, readOnly = false, documentKey }: {
    result?: OptionsAnalysis | null;
    spot?: number;
    draft?: OptionsDraft;
    onEdit?: (update: (draft: OptionsDraft) => void) => void;
    readOnly?: boolean;
    documentKey?: string;
  } = $props();
  const id = $props.id();
  let containerWidth = $state(360);
  let view = $state<Domain | null>(null);
  let minimum = $state('');
  let maximum = $state('');
  let domainError = $state('');
  let selected = $state<number | null>(null);
  let greek = $state<GreekKey>('delta');
  let pnlSvg = $state<SVGSVGElement>();
  let selectedLeg = $state<number | null>(null);
  let strikeText = $state('');
  let strikeError = $state('');
  let step = $state<number>(1);
  let drag = $state<StrikeDrag | null>(null);
  let capture: HTMLButtonElement | null = null;
  let suppressMarkerClick = false;
  let dragStartX = 0;
  const previewGate = new ChartRequestGate(), legGate = new ChartRequestGate();
  interface Evidence { analysis: OptionsAnalysis; context: string; baseline: OptionsAnalysis; legIndex?: number }
  let proposal = $state.raw<Evidence | null>(null);
  let contribution = $state.raw<Evidence | null>(null);
  let previewPending = $state(false), legPending = $state(false);
  let previewMessage = $state(''), legMessage = $state('');
  let previewFailed = $state(false), legFailed = $state(false);
  let previewFields = $state<Record<string, string>>({});
  const context = $derived(chartContextKey(documentKey, draft, result, readOnly, !!onEdit));
  const editable = $derived(!!documentKey && !!draft && !!onEdit && !readOnly);
  const terminalAvailable = $derived(result?.horizon?.kind !== 'mixed_expiry' && result?.horizon?.exact_terminal_available !== false);
  const proposed = $derived(proposal?.context === context && proposal.baseline === result ? proposal.analysis : null);
  const legAnalysis = $derived(contribution?.context === context && contribution.baseline === result && contribution.legIndex === selectedLeg ? contribution.analysis : null);
  const proposedCurves = $derived(proposed ? canonicalOverlay(proposed, proposed.request) : []);
  const legCurves = $derived(legAnalysis && result ? canonicalOverlay(legAnalysis, legAnalysis.request, !terminalAvailable) : []);
  const overlayCurves = $derived([...proposedCurves, ...legCurves]);
  const overlayPoints = $derived(overlayCurves.map(s => seriesPoints(s.spots, s.values)));
  const legRows = $derived(result?.request.strategy.legs.map((leg, index) => ({ leg, index })) ?? []);
  const draftLeg = $derived(selectedLeg == null ? null : draft?.strategy.legs[selectedLeg]);
  const submittedLeg = $derived(selectedLeg == null ? null : result?.request.strategy.legs[selectedLeg]);
  const matchingLayout = $derived(!!draft && !!result && draft.strategy.legs.length === result.request.strategy.legs.length && draft.strategy.legs.every((leg, i) => leg.kind === result!.request.strategy.legs[i].kind));
  const canEditLeg = $derived(editable && matchingLayout && !!draftLeg?.enabled && draftLeg.kind !== 'underlying' && validStrike(draftLeg.strike));
  const ghost = $derived(drag?.proposed ?? (canEditLeg && draftLeg?.strike !== submittedLeg?.strike ? draftLeg?.strike : null));
  const width = $derived(Math.max(240, containerWidth));
  const left = 64, right = 18;
  const plotWidth = $derived(width - left - right);
  const full = $derived(result ? priceDomain(result.spot_grid) : null);
  const domain = $derived(view ?? full);
  const error = $derived(result ? plotError(result) : null);
  const curves = $derived(result ? optionsSeries(result).filter(s => s.id !== 'expiry' || terminalAvailable) : []);
  const points = $derived(curves.map(s => seriesPoints(s.spots, s.values)));
  const inspectGrid = $derived(result ? [...new Set([...inspectionGrid(result), ...overlayCurves.flatMap(s => s.spots)])].sort((a, b) => a - b) : []);
  const expiryError = $derived(result ? (terminalAvailable ? expiryTraceError(result) : 'Exact terminal geometry unavailable for this horizon: no common-expiry payoff, extrema, breakevens or zero intervals. Use lifecycle analysis for expiry transitions.') : null);
  const legError = $derived(result ? legBreakdownError(result) : null);
  const pnlY = $derived(domain ? sampledYDomain([...points, ...overlayPoints], domain) : { min: -1, max: 1 });
  const greekCurves = $derived(result ? greekSeries(result, greek) : []);
  const greekPoints = $derived(result ? greekCurves.map(s => seriesPoints(result.spot_grid, s.values)) : []);
  const greekY = $derived(domain ? sampledYDomain(greekPoints, domain) : { min: -1, max: 1 });
  const greekError = $derived(result ? greekPlotError(result, greek) : null);
  const markers = $derived(result ? priceMarkers(result) : []);
  const activeIndex = $derived(result && domain && selected != null &&
    inspectGrid[selected] >= domain.min && inspectGrid[selected] <= domain.max ? selected : null);
  const activeSpot = $derived(activeIndex != null ? inspectGrid[activeIndex] : null);
  const greekIndex = $derived(activeSpot != null ? result?.spot_grid.indexOf(activeSpot) ?? -1 : -1);
  const drift = $derived(result && finiteValue(spot) && spot !== result.request.spot);
  const stale = $derived(result && draft && requestChanged(draft, result.request));
  const unit = $derived(result?.greek_units[greek] ?? '');

  $effect(() => {
    context; result;
    untrack(resetEditing);
    return () => untrack(resetEditing);
  });

  $effect(() => {
    selectedLeg;
    strikeText = validStrike(draftLeg?.strike) ? String(draftLeg.strike) : '';
    strikeError = '';
  });

  function cancelDrag(cancelled = true) {
    const pointerId = drag?.pointerId;
    if (cancelled && pointerId != null) suppressMarkerClick = true;
    drag = null;
    const target = capture;
    capture = null;
    if (pointerId != null && target?.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
  }

  function resetEditing() {
    cancelDrag();
    previewGate.cancel(); legGate.cancel();
    proposal = null; contribution = null;
    selected = null;
    previewPending = false; legPending = false;
    previewMessage = ''; legMessage = '';
    previewFailed = false; legFailed = false;
    previewFields = {};
  }

  function commitStrike(index: number, strike: number, original: number) {
    const leg = draft?.strategy.legs[index];
    if (!editable || !onEdit || !matchingLayout || !leg?.enabled || leg.kind === 'underlying' ||
      leg.strike !== original || !validStrike(strike) || strike === original) return;
    onEdit(d => { applyStrikeEdit(d, index, strike, original); });
  }

  function numericStrike(event: SubmitEvent) {
    event.preventDefault();
    if (!canEditLeg || selectedLeg == null || !validStrike(draftLeg?.strike)) return;
    const strike = strikeText.trim() ? Number(strikeText) : NaN;
    if (!validStrike(strike)) { strikeError = `Strike must be greater than 0 and at most ${MAX_STRIKE} USD. No edit was applied.`; return; }
    strikeError = '';
    commitStrike(selectedLeg, strike, draftLeg.strike);
  }

  function incrementStrike(index: number, direction: number) {
    const leg = draft?.strategy.legs[index];
    if (!leg || !validStrike(leg.strike)) return;
    const next = snapStrike(leg.strike + direction * step, step);
    if (next != null) commitStrike(index, next, leg.strike);
  }

  function handleKey(event: KeyboardEvent, index: number) {
    if (event.key === 'Escape') { cancelDrag(); event.stopPropagation(); return; }
    if (!editable || !matchingLayout || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.repeat) return;
    selectLeg(index);
    incrementStrike(index, ['ArrowLeft', 'ArrowDown'].includes(event.key) ? -1 : 1);
  }

  function dragStrike(event: PointerEvent) {
    return domain && pnlSvg ? strikeAtClientX(event.clientX, pnlSvg.getBoundingClientRect(), width, left, plotWidth, domain, step) : null;
  }

  function startDrag(event: PointerEvent, index: number) {
    suppressMarkerClick = false;
    selectLeg(index);
    const leg = draft?.strategy.legs[index];
    if (!editable || !matchingLayout || !leg?.enabled || !validStrike(leg.strike) || !event.isPrimary || event.button !== 0 || !(event.currentTarget instanceof HTMLButtonElement)) return;
    event.preventDefault();
    cancelDrag(false);
    capture = event.currentTarget;
    capture.focus();
    dragStartX = event.clientX;
    drag = { pointerId: event.pointerId, legIndex: index, original: leg.strike, proposed: leg.strike, context };
    try { capture.setPointerCapture(event.pointerId); } catch { cancelDrag(); }
  }

  function moveDrag(event: PointerEvent) {
    if (drag) {
      if (!suppressMarkerClick && Math.abs(event.clientX - dragStartX) < 3) return;
      drag = moveStrikeDrag(drag, event.pointerId, dragStrike(event));
      if (drag.proposed !== drag.original) suppressMarkerClick = true;
    }
  }

  function endDrag(event: PointerEvent) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (suppressMarkerClick) moveDrag(event);
    const completed = finishStrikeDrag(drag, event.pointerId, context);
    cancelDrag(false);
    if (completed) commitStrike(completed.legIndex, completed.proposed, completed.original);
  }

  function handleStrike(index: number): number {
    if (drag?.legIndex === index) return drag.proposed;
    const strike = editable && matchingLayout ? draft?.strategy.legs[index]?.strike : null;
    return validStrike(strike) ? strike : result!.request.strategy.legs[index].strike!;
  }

  function selectLeg(index: number) {
    if (selectedLeg !== index) {
      legGate.cancel(); legPending = false; legFailed = false;
      legMessage = ''; contribution = null; selected = null;
    }
    selectedLeg = index;
  }

  function markerClick(event: MouseEvent, index: number) {
    if (event.detail > 0 && suppressMarkerClick) { suppressMarkerClick = false; return; }
    void loadLeg(index);
  }

  function cancelPreview(discard = false) {
    previewGate.cancel(); previewPending = false; previewFailed = false;
    if (discard) { proposal = null; selected = null; }
    previewMessage = discard ? 'Proposed overlay discarded. Submitted evidence is unchanged.' : 'Proposal request cancelled. Any previous proposed overlay is unchanged.';
  }

  function cancelLeg() {
    legGate.cancel(); legPending = false; legFailed = false;
    legMessage = 'Leg contribution request cancelled. Submitted strategy evidence is unchanged.';
  }

  async function loadLeg(index: number) {
    selectedLeg = index;
    legGate.cancel(); legPending = false; legFailed = false; contribution = null; selected = null;
    if (!documentKey || !result) { legMessage = 'Leg curve requests require an active research document.'; return; }
    const base = result, key = context;
    const request = isolatedLegRequest($state.snapshot(base), index);
    if (!request) { legMessage = 'This leg is disabled; its canonical contribution is zero.'; return; }
    const flight = legGate.begin(key, base);
    legPending = true; legMessage = ''; legFailed = false;
    const current = () => flight.current(context, result) && selectedLeg === index;
    const timer = setTimeout(() => { if (current()) { legGate.cancel(); legPending = false; legFailed = true; legMessage = 'Leg curve timed out. Retry explicitly.'; } }, 15000);
    try {
      const analysis = await requestChartAnalysis(request, flight.signal);
      if (!current()) return;
      canonicalOverlay(analysis, request);
      contribution = { analysis, context: key, baseline: base, legIndex: index };
      selected = null;
      legMessage = `Canonical submitted leg ${index + 1} contribution loaded; other legs are disabled for this request.`;
    } catch {
      if (current()) { legFailed = true; legMessage = 'Leg contribution request failed. Retry explicitly; submitted strategy evidence is unchanged.'; }
    } finally { clearTimeout(timer); if (current()) legPending = false; }
  }

  async function previewProposal() {
    if (!editable || !draft || !result || previewPending || drag) return;
    const base = result, key = context;
    const request = structuredClone($state.snapshot(draft));
    previewFields = optionsErrors(request);
    previewFailed = Object.keys(previewFields).length > 0;
    if (previewFailed) { previewMessage = 'Fix the proposal inputs below before previewing. No request was sent.'; return; }
    const flight = previewGate.begin(key, base);
    previewPending = true; previewFailed = false; previewMessage = '';
    const current = () => flight.current(context, result);
    const timer = setTimeout(() => { if (current()) { previewGate.cancel(); previewPending = false; previewFailed = true; previewMessage = 'Proposal preview timed out. Retry explicitly.'; } }, 15000);
    try {
      const analysis = await requestChartAnalysis(request, flight.signal);
      if (!current()) return;
      canonicalOverlay(analysis, request);
      proposal = { analysis, context: key, baseline: base };
      selected = null;
      previewMessage = 'Proposed backend result only. The submitted strategy and its evidence have not been replaced.';
    } catch {
      if (current()) { previewFailed = true; previewMessage = 'Canonical preview failed. Check the draft inputs and retry; submitted evidence is unchanged.'; }
    } finally { clearTimeout(timer); if (current()) previewPending = false; }
  }

  $effect(() => {
    const grid = result?.spot_grid;
    result?.expiry_curve;
    view = null;
    selected = null;
    domainError = '';
    const bounds = grid ? priceDomain(grid) : null;
    minimum = bounds ? String(bounds.min) : '';
    maximum = bounds ? String(bounds.max) : '';
  });

  function setDomain(next: Domain) {
    cancelDrag();
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
    const next = keyboardIndex(inspectGrid, domain, activeIndex, key);
    if (next !== undefined) { event.preventDefault(); selected = next; }
  }

  function inspect(event: PointerEvent) {
    if (!result || !domain) return;
    const bounds = event.currentTarget instanceof SVGSVGElement ? event.currentTarget.getBoundingClientRect() : null;
    if (!bounds || !bounds.width) return;
    const pixel = ((event.clientX - bounds.left) / bounds.width) * width - left;
    if (pixel < 0 || pixel > plotWidth) { selected = null; return; }
    const price = scaleValue(pixel, { min: 0, max: plotWidth }, domain.min, domain.max);
    selected = nearestIndex(inspectGrid, price, domain);
  }

  function x(price: number) { return domain ? left + scaleValue(price, domain, 0, plotWidth) : left; }
  function inView(price: number) { return finiteValue(price) && domain && price >= domain.min && price <= domain.max; }
  function sliderSpot() {
    return domain ? Math.max(domain.min, Math.min(domain.max, activeSpot ?? result?.request.spot ?? domain.min)) : 0;
  }
</script>

<svelte:window onblur={() => cancelDrag()} onkeydown={(event) => { if (drag && event.key === 'Escape') { event.preventDefault(); cancelDrag(); } }} />

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
    {#if drift && !stale}<p class="notice">Draft spot changed. Charts still show the returned analysis at {exactValue(result.request.spot)} USD; analyze again to refresh.</p>{/if}
    {#if stale}<p class="notice" role="status">Inputs changed. All charts and per-leg readouts remain previous submitted evidence; Analyze explicitly to refresh.</p>{/if}

    <section class="strike-editor" aria-label="Strike proposals and submitted leg contribution">
      <div class="pane-title"><h4>Strike proposals</h4><span>Submitted evidence stays fixed</span></div>
      {#if !editable}<p class="note">Read-only chart. Python source is never changed by chart controls. Visual editing requires an editable draft, parent edit callback and an active document key.</p>{:else}
        <p class="note">Drag a numbered strike handle, or select a leg and use numeric controls. Release applies one draft edit; Escape, lost capture and pointer cancellation discard it. Pricing requires Preview.</p>
      {/if}
      <div class="leg-selectors" aria-label="Select submitted leg">
        {#each legRows as row (row.index)}
          <button type="button" class:chosen={selectedLeg === row.index} aria-pressed={selectedLeg === row.index} onclick={() => loadLeg(row.index)}>
            L{row.index + 1}: {row.leg.kind} · {exactValue(row.leg.quantity, true)} {row.leg.kind === 'underlying' ? 'shares' : 'contracts'}{row.leg.kind !== 'underlying' ? ` · K ${exactValue(row.leg.strike)} USD` : ''}{row.leg.enabled ? '' : ' · disabled'}
          </button>
        {/each}
      </div>
      <p class="note">Select/Enter/Space explicitly requests the submitted leg's canonical contribution (other legs disabled), not the draft. Arrows edit draft strike when enabled. L = submitted strike; D = unpriced draft strike.</p>
      {#if selectedLeg != null && submittedLeg}
        <p class="note">Selected submitted L{selectedLeg + 1}: {submittedLeg.kind}, premium {exactValue(submittedLeg.entry_premium)} USD/unit, multiplier {exactValue(submittedLeg.multiplier)}{submittedLeg.source ? ` · source ${submittedLeg.source.provider}/${submittedLeg.source.environment} · ${submittedLeg.source.contract_symbol}` : ' · manual inputs'}.</p>
        {#if result.legs?.find(l => l.leg_index === selectedLeg)}
          {@const leg = result.legs.find(l => l.leg_index === selectedLeg)!}
          <p class="note">Canonical submitted-spot contribution: today P&amp;L {exactValue(leg.pnl_today, true)} USD · delta {exactValue(leg.greeks.delta, true)} equivalent shares.</p>
        {/if}
      {/if}
      {#if editable}
        {#if !matchingLayout}<p class="notice">Draft leg layout changed. Analyze explicitly before editing chart strikes; submitted leg selection still inspects the original evidence.</p>{/if}
        <form class="domain-controls" onsubmit={numericStrike} aria-label="Edit selected draft strike">
          <label for={`${id}-strike`}>Draft L{selectedLeg == null ? '—' : selectedLeg + 1} strike (USD)
            <input id={`${id}-strike`} type="text" inputmode="decimal" bind:value={strikeText} disabled={!canEditLeg || !!drag} aria-invalid={!!strikeError} aria-describedby={`${id}-strike-note`} />
          </label>
          <label for={`${id}-snap`}>Drag/arrow step (USD)
            <select id={`${id}-snap`} bind:value={step} disabled={!!drag}>{#each STRIKE_STEPS as s}<option value={s}>{s}</option>{/each}</select>
          </label>
          <div class="actions">
            <button type="button" disabled={!canEditLeg || !!drag} onclick={() => selectedLeg != null && incrementStrike(selectedLeg, -1)}>Strike −</button>
            <button type="button" disabled={!canEditLeg || !!drag} onclick={() => selectedLeg != null && incrementStrike(selectedLeg, 1)}>Strike +</button>
            <button type="submit" disabled={!canEditLeg || !!drag}>Apply strike</button>
          </div>
        </form>
        <p id={`${id}-strike-note`} class="note" class:notice={!!strikeError} role={strikeError ? 'alert' : undefined}>{strikeError || `Numeric edits retain entered precision; drag/arrows snap to the chosen step within 0 < strike ≤ ${MAX_STRIKE} USD. Select an enabled option leg to edit.`}</p>
        <p class="notice">Strike edits never change entry premiums, IVs, quotes, timestamps or source metadata. Premiums and quotes retain prior assumptions; the contract symbol may not match the proposed strike. Review explicitly. The draft ghost is unpriced, not payoff evidence.</p>
        <div class="actions">
          <button type="button" onclick={previewProposal} disabled={previewPending || !!drag}>Preview proposal</button>
          {#if previewPending}<button type="button" onclick={() => cancelPreview()}>Cancel preview</button>{/if}
          {#if proposed}<button type="button" onclick={() => cancelPreview(true)}>Discard proposed overlay</button>{/if}
        </div>
      {/if}
      {#if previewPending}<p class="note" role="status">Canonical proposal preview pending. Any previous proposed overlay remains separate from submitted evidence.</p>{/if}
      {#if previewMessage}<p class="notice" role={previewFailed ? 'alert' : 'status'}>{previewMessage}</p>{/if}
      {#if Object.keys(previewFields).length}<ul class="field-errors">{#each Object.entries(previewFields) as [field, message]}<li><b>{field}</b>: {message}</li>{/each}</ul>{/if}
      {#if legPending}<p class="note" role="status">Canonical leg contribution pending.</p><button type="button" onclick={cancelLeg}>Cancel leg request</button>{/if}
      {#if legMessage}<p class="note" role={legFailed ? 'alert' : 'status'}>{legMessage}</p>{/if}
      {#if proposed}<p class="notice">PROPOSED backend analysis · submitted proposal spot {exactValue(proposed.request.spot)} USD · {proposed.request.strategy.name}. Dot-dash overlays are hypothetical proposed evidence, not an update to the submitted strategy.{proposed.horizon?.exact_terminal_available === false ? ' Mixed expiry: no exact terminal payoff overlay, roots or extrema are available.' : ''}</p>{/if}
      {#if legAnalysis}<p class="note">SELECTED SUBMITTED L{(selectedLeg ?? 0) + 1} · long-dashed, thicker overlay · fixed original premiums and fees.{result.horizon?.kind === 'mixed_expiry' || result.horizon?.exact_terminal_available === false ? ' Today only for mixed expiry; no isolated own-expiry line is compared to the multi-expiry strategy.' : ''}</p>{/if}
      {#if ghost != null}<p class="note" role="status">Unpriced draft L{(selectedLeg ?? 0) + 1} strike: {exactValue(ghost)} USD{inView(ghost) ? '' : ' (outside current view)'}. {drag ? 'Release to apply, Escape to cancel.' : 'Preview explicitly for canonical pricing.'}</p>{/if}
    </section>

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
    {#if expiryError}<p class="notice" role="status">{expiryError}</p>{/if}
    <div class="legend" aria-label="P&L series legend">
      {#each curves as curve (curve.id)}
        <span class="legend-item"><svg class={`swatch ${curve.tone}`} viewBox="0 0 28 10" aria-hidden="true"><path d="M0,5 L28,5" stroke-dasharray={curve.dash} /></svg>{curve.label}</span>
      {/each}
      {#each proposedCurves as curve (curve.id)}<span class="legend-item"><svg class={`swatch ${curve.tone}`} viewBox="0 0 28 10" aria-hidden="true"><path d="M0,5 L28,5" stroke-dasharray="3 2 1 2" /></svg>PROPOSED · {curve.label}</span>{/each}
      {#each legCurves as curve (curve.id)}<span class="legend-item"><svg class={`swatch ${curve.tone}`} viewBox="0 0 28 10" aria-hidden="true"><path d="M0,5 L28,5" stroke-dasharray="14 5" /></svg>SUBMITTED L{(selectedLeg ?? 0) + 1} · {curve.label}</span>{/each}
    </div>
    <div class="graph" bind:clientWidth={containerWidth}>
      <div class="chart-control" role="slider" tabindex="0" aria-label="Inspect P&L at supplied price samples" aria-valuemin={domain.min} aria-valuemax={domain.max} aria-valuenow={sliderSpot()} aria-valuetext={activeSpot == null ? 'No sample selected' : `${exactValue(activeSpot)} USD; values in readout below`} aria-describedby={`${id}-instructions`} onkeydown={keydown}>
        <svg bind:this={pnlSvg} viewBox={`0 0 ${width} 254`} role="img" aria-label={`Expiration, today and scenario P&L for ${result.request.strategy.name}; underlying price in USD on x-axis, total P&L in USD on y-axis`} onpointermove={inspect} onpointerdown={inspect}>
          <title>Options P&amp;L over numeric underlying price</title>
          <desc>Expiration connects canonical piecewise-linear vertices, including every in-domain strike and isolated breakeven. Today and scenarios connect backend grid samples only. Dashed vertical lines mark strikes, dotted lines mark expiration breakevens, solid line marks submitted spot. Exact values are below.</desc>
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
            {#each overlayCurves as curve, i (`${i}-${curve.id}`)}
              <path class={`curve ${curve.tone}`} class:contribution={i >= proposedCurves.length} d={svgPath(overlayPoints[i], domain, pnlY, plotWidth, 24, 208)} transform={`translate(${left},0)`} stroke-dasharray={i < proposedCurves.length ? '3 2 1 2' : '14 5'} />
            {/each}
            {#if ghost != null && inView(ghost)}<line class="draft-ghost" x1={x(ghost)} x2={x(ghost)} y1="24" y2="208"><title>Unpriced draft strike {exactValue(ghost)} USD; not payoff evidence</title></line>{/if}
            {#if selectedLeg != null && validStrike(submittedLeg?.strike) && inView(submittedLeg.strike)}<line class="selected-strike" x1={x(submittedLeg.strike)} x2={x(submittedLeg.strike)} y1="24" y2="208" />{/if}
            {#if activeSpot != null && activeIndex != null}
              <line class="crosshair" x1={x(activeSpot)} x2={x(activeSpot)} y1="24" y2="208" />
              {#each curves as curve (curve.id)}
                {#if finiteValue(seriesValue(curve, activeSpot))}<circle class={`point ${curve.tone}`} cx={x(activeSpot)} cy={scaleValue(seriesValue(curve, activeSpot) as number, pnlY, 208, 24)} r="3.5" />{/if}
              {/each}
            {/if}
          </g>
          {#each domainTicks(domain) as tick, i}
            <text class="axis" x={x(tick)} y="226" text-anchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}>{axisValue(tick)}</text>
          {/each}
          <text class="axis" x={left+plotWidth/2} y="244" text-anchor="middle">Underlying price (USD)</text>
        </svg>
      </div>
      <div class="strike-handles" aria-label="Submitted option strike handles">
        {#each legRows.filter(row => row.leg.kind !== 'underlying' && row.leg.enabled && validStrike(row.leg.strike) && inView(handleStrike(row.index))) as row (row.index)}
          <button type="button" class="strike-handle" class:chosen={selectedLeg === row.index} class:draggable={editable && matchingLayout} style:left={`${x(handleStrike(row.index)) / width * 100}%`} style:top={`${(34 + row.index % 6 * 28) / 254 * 100}%`}
            aria-label={`L${row.index + 1} submitted ${row.leg.kind} strike ${row.leg.strike} USD. ${handleStrike(row.index) !== row.leg.strike ? `Unpriced draft strike ${handleStrike(row.index)} USD. ` : ''}Select contribution with Enter/Space; ${editable && matchingLayout ? 'drag or arrows to edit draft strike' : 'read-only strike'}.`}
            aria-pressed={selectedLeg === row.index}
            onkeydown={(event) => handleKey(event, row.index)}
            onpointerdown={(event) => startDrag(event, row.index)} onpointermove={moveDrag} onpointerup={endDrag}
            onpointercancel={() => cancelDrag()} onlostpointercapture={() => cancelDrag()}
            onclick={(event) => markerClick(event, row.index)}>{handleStrike(row.index) !== row.leg.strike ? 'D' : 'L'}{row.index + 1}</button>
        {/each}
      </div>
    </div>
    <p class="marker-key">Solid vertical: submitted spot · dashed: strike · dotted: expiration breakeven · horizontal: zero P&amp;L</p>
    <p id={`${id}-instructions`} class="note">Hover or touch to inspect supplied samples or exact expiry vertices. Focus either chart: arrows, Home/End to select; Escape to clear. Values not returned at a selected price are unavailable, never interpolated. Axes use up to 4 significant digits or scientific notation; readouts and tables are unrounded. Lines identify series, not gain/loss.</p>
    {#if !inspectGrid.some(s => inView(s))}<p class="notice">No supplied samples or vertices inside this zoomed view. Lines may show clipped connections between neighboring points; zoom out or reset to inspect exact values.</p>{/if}
    {#if curves.some(c => c.values.some(v => !finiteValue(v)))}<p class="notice">Some returned P&amp;L values are unavailable. Paths break at missing/nonfinite values; see exact-value data.</p>{/if}
    <div class="readout" aria-live="polite" aria-atomic="true">
      {#if activeIndex != null && activeSpot != null}
        <strong>Returned spot {exactValue(activeSpot)} USD</strong>
        <dl>{#each curves as curve (curve.id)}<div><dt>{curve.label} P&amp;L</dt><dd>{exactValue(seriesValue(curve, activeSpot), true)} USD</dd></div>{/each}
          {#each proposedCurves as curve (curve.id)}<div><dt>PROPOSED {curve.label} P&amp;L</dt><dd>{exactValue(seriesValue(curve, activeSpot), true)} USD</dd></div>{/each}
          {#each legCurves as curve (curve.id)}<div><dt>SUBMITTED L{(selectedLeg ?? 0) + 1} {curve.label} P&amp;L</dt><dd>{exactValue(seriesValue(curve, activeSpot), true)} USD</dd></div>{/each}
          <div><dt>Today {greek}</dt><dd>{exactValue(greekCurves[0]?.values[greekIndex], true)} · {unit}</dd></div>
        </dl>
      {:else}<span>Select a price sample to inspect exact returned values. No sampled view is a maximum profit/loss estimate.</span>{/if}
    </div>

    <div class="pane-title greek-heading"><div><h4>Greek exposure by price</h4><p class="note">Today only · signed, quantity × multiplier weighted</p></div>
      <label for={`${id}-greek`}>Greek<select id={`${id}-greek`} bind:value={greek}>{#each GREEK_KEYS as key}<option value={key}>{key}</option>{/each}</select></label>
    </div>
    <p class="unit">{greek} · {unit}</p>
    {#if greekError}<p class="notice" role="status">{greekError}</p>{/if}
    <div class="chart-control" role="slider" tabindex="0" aria-label={`Inspect today ${greek} at supplied price samples`} aria-valuemin={domain.min} aria-valuemax={domain.max} aria-valuenow={sliderSpot()} aria-valuetext={activeSpot == null ? 'No sample selected' : `${exactValue(activeSpot)} USD; ${exactValue(greekCurves[0]?.values[greekIndex], true)} ${unit}`} aria-describedby={`${id}-instructions`} onkeydown={keydown}>
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
              {#if finiteValue(greekCurves[0].values[greekIndex])}<circle class="point today" cx={x(activeSpot)} cy={scaleValue(greekCurves[0].values[greekIndex] as number, greekY, 148, 20)} r="3.5" />{/if}
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
      {#if !terminalAvailable}<p class="note">{expiryError}</p>{:else}
      <dl><div><dt>Maximum profit (USD)</dt><dd>{result.summary.profit_unbounded ? 'Unbounded' : exactValue(result.summary.max_profit)}</dd></div>
        <div><dt>Maximum loss (USD)</dt><dd>{result.summary.loss_unbounded ? 'Unbounded' : exactValue(result.summary.max_loss)}</dd></div>
        <div><dt>Expiration breakevens (USD)</dt><dd>{result.summary.breakevens.length ? result.summary.breakevens.map(v => exactValue(v)).join(', ') : 'None'}</dd></div>
        <div><dt>Zero P&amp;L intervals (USD)</dt><dd>{result.summary.zero_intervals.length ? result.summary.zero_intervals.map(z => `[${exactValue(z.start)}, ${z.end == null ? '∞' : exactValue(z.end)}]`).join(', ') : 'None'}</dd></div>
        <div><dt>Enabled option strikes (USD)</dt><dd>{markers.filter(m => m.kind === 'strike').map(m => exactValue(m.spot)).join(', ') || 'None'}</dd></div>
      </dl><p class="note">Expiry limits and roots cover all nonnegative prices, including outside this view. Sampled chart bounds are not risk limits. The exact expiry trace joins canonical vertices, preserving strike kinks. Other lines connect returned grid samples, not additional model evaluations.</p>
      {/if}
    </details>
    <details class="evidence"><summary>Exact-value data · all returned price samples</summary>
      <p class="note">Unrounded signed values. Missing/nonfinite values are unavailable; they are omitted from plots. The table is independent of display zoom.</p>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard access to horizontal table scrolling) -->
      <div class="table-scroll" role="region" aria-label="Exact options price data" tabindex="0">
        <table><caption>P&amp;L and today {greek}; {unit}</caption><thead><tr><th scope="col">Spot (USD)</th>{#each curves as curve (curve.id)}<th scope="col">{curve.label} P&amp;L (USD)</th>{/each}<th scope="col">Today {greek}</th></tr></thead>
          <tbody>{#each inspectGrid as price}<tr><th scope="row">{exactValue(price)}</th>{#each curves as curve (curve.id)}<td>{exactValue(seriesValue(curve, price), true)}</td>{/each}<td>{exactValue(greekCurves[0]?.values[result.spot_grid.indexOf(price)], true)}</td></tr>{/each}</tbody>
        </table>
      </div>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard access to horizontal table scrolling) -->
      <div class="table-scroll" role="region" aria-label="All exact aggregate Greeks" tabindex="0">
        <table><caption>Aggregate Greeks at submitted spot {exactValue(result.request.spot)} USD</caption><thead><tr><th scope="col">Greek / unit</th><th scope="col">Today</th>{#each result.scenarios as scenario}<th scope="col">{scenario.name}</th>{/each}</tr></thead><tbody>
          {#each GREEK_KEYS as key}<tr><th scope="row">{key}<span class="table-unit">{result.greek_units[key]}</span></th><td>{exactValue(result.greeks[key], true)}</td>{#each result.scenarios as scenario}<td>{exactValue(scenario.greeks[key], true)}</td>{/each}</tr>{/each}
        </tbody></table>
      </div>
    </details>
    <details class="evidence"><summary>Per-leg P&amp;L &amp; Greeks · submitted spot</summary>
      <p class="note">Signed total USD contributions, not per-contract values. Positive costs are debits; negative costs are credits. Fees are nonnegative USD entry charges. Disabled legs contribute zero; active undefined Greeks are unavailable, never zero. Values are unrounded.</p>
      {#if legError}<p class="notice">{legError}</p>{:else}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard access to horizontal table scrolling) -->
        <div class="table-scroll" role="region" aria-label="Exact per-leg monetary contributions" tabindex="0">
          <table><caption>Today at submitted spot {exactValue(result.request.spot)} USD · original leg order</caption>
            <thead><tr><th scope="col">Leg / submitted position</th><th scope="col">Resolved IV (annual fraction)</th><th scope="col">Gross entry (USD)</th><th scope="col">Entry fees (USD)</th><th scope="col">Net entry (USD)</th><th scope="col">Theoretical value (USD)</th><th scope="col">Today P&amp;L (USD)</th></tr></thead>
            <tbody>{#each result.legs ?? [] as row}{@const leg = result.request.strategy.legs[row.leg_index]}<tr>
              <th scope="row">Leg {row.leg_index + 1} · {leg.kind} · {exactValue(leg.quantity, true)} {leg.kind === 'underlying' ? 'shares' : 'contracts'}{leg.strike != null ? ` · strike ${exactValue(leg.strike)} USD` : ''}<span class="table-unit">{row.enabled ? 'Enabled' : 'Disabled · zero contribution'}</span></th>
              <td>{leg.kind === 'underlying' ? 'Not applicable · shares' : exactValue(row.resolved_implied_volatility)}</td><td>{exactValue(row.gross_entry_cost, true)}</td><td>{exactValue(row.entry_fees, true)}</td><td>{exactValue(row.net_entry_cost, true)}</td><td>{exactValue(row.theoretical_value_today, true)}</td><td>{exactValue(row.pnl_today, true)}</td>
            </tr>{/each}</tbody>
          </table>
        </div>
        <!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard access to horizontal table scrolling) -->
        <div class="table-scroll" role="region" aria-label="Exact per-leg Greek contributions" tabindex="0">
          <table><caption>Signed leg Greek exposures at submitted spot · quantity × multiplier weighted</caption><thead><tr><th scope="col">Leg / status</th>{#each GREEK_KEYS as key}<th scope="col">{key}<span class="table-unit">{result.greek_units[key]}</span></th>{/each}</tr></thead>
            <tbody>{#each result.legs ?? [] as row}<tr><th scope="row">Leg {row.leg_index + 1} · {row.enabled ? 'enabled' : 'disabled'}</th>{#each GREEK_KEYS as key}<td>{exactValue(row.greeks?.[key], true)}</td>{/each}</tr>{/each}</tbody>
          </table>
        </div>
      {/if}
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
  .graph { position: relative; min-width: 0; width: 100%; }
  .strike-editor { min-width: 0; padding-bottom: 8px; border-bottom: 1px solid oklch(var(--border)); }
  .leg-selectors { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
  .leg-selectors button { white-space: normal; text-align: left; overflow-wrap: anywhere; max-width: 100%; }
  .strike-handles { position: absolute; inset: 0; pointer-events: none; }
  .strike-handle { position: absolute; transform: translate(-50%, -50%); min-width: 28px; padding: 2px 4px; font-family: var(--font-mono); pointer-events: auto; z-index: 1; }
  .strike-handle.draggable { cursor: ew-resize; touch-action: none; }
  .strike-handle.chosen { z-index: 3; }
  .chosen { border: 2px solid oklch(var(--foreground)); text-decoration: underline; text-underline-offset: 3px; }
  .curve.contribution { stroke-width: 3.5; }
  .draft-ghost { stroke: oklch(var(--foreground)); stroke-width: 2; stroke-dasharray: 1 5; }
  .selected-strike { stroke: oklch(var(--foreground)); stroke-width: 2; stroke-dasharray: 12 3; }
  button:disabled, input:disabled, select:disabled { cursor: not-allowed; opacity: 0.6; }
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
  @media (pointer: coarse) { button, input, select { min-height: var(--control-touch-height); } }
  @media (forced-colors: active) {
    .curve, .point, .marker, .zero-line, .crosshair, .swatch path, .draft-ghost, .selected-strike { stroke: CanvasText; }
    .grid { stroke: GrayText; }
    .axis { fill: CanvasText; }
    .zero-interval { fill: Highlight; }
    button, input, select { border-color: ButtonText; }
    .chosen { border-color: Highlight; }
    button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible, .chart-control:focus-visible, .table-scroll:focus-visible { outline-color: Highlight; }
  }
</style>

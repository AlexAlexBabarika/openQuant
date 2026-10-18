<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import type { GreekKey, OptionsAnalysis, OptionsDraft } from '$lib/features/options/optionsTypes';
  import { requestChanged } from '$lib/features/options/optionsScenario';
  import { expiryPayoffPoints } from '$lib/features/options/optionsPayoff';
  import {
    STRIKE_STEPS, MAX_STRIKE, validStrike, snapStrike, strikeAtClientX,
    moveStrikeDrag, finishStrikeDrag, applyStrikeEdit, isolatedLegRequest,
    canonicalOverlay, requestChartAnalysis, chartContextKey,
  } from '$lib/features/options/optionsChartEditing';
  import type { StrikeDrag } from '$lib/features/options/optionsChartEditing';
  import { RequestFlight } from '$lib/features/options/optionsRequest';
  import {
    GREEK_KEYS, axisValue, niceTicks, fillPath, exactValue, finiteValue, greekPlotError,
    greekSeries, keyboardIndex, nearestIndex, optionsSeries, plotError, priceDomain,
    priceMarkers, sampledYDomain, scaleValue, seriesPoints, svgPath, validateDomain,
    zoomDomain, exactTerminalAvailable, expiryTraceError, inspectionGrid, seriesValue, legBreakdownError, outsideView, keepView,
  } from '$lib/features/options/optionsChart';
  import type { Domain } from '$lib/features/options/optionsChart';
  import { formatGreek, formatNumber, formatPrice, formatUsd } from '$lib/features/options/optionsFormat';

  let { result = null, spot, draft, onEdit, readOnly = false, documentKey, onFit, pending = false, compact = false }: {
    result?: OptionsAnalysis | null;
    spot?: number;
    draft?: OptionsDraft;
    onEdit?: (update: (draft: OptionsDraft) => void) => void;
    readOnly?: boolean;
    documentKey?: string;
    /** Refit the requested price grid; the chart can only show prices the grid covers. */
    onFit?: () => void;
    /** A newer analysis is on its way; submitted curves show faintly until it lands. */
    pending?: boolean;
    /** Narrow panels fold strike, view and Greek controls into one disclosure below the payoff. */
    compact?: boolean;
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
  const HINT_KEY = 'openquant.options.chartHint.v1';
  let hintDismissed = $state(readHint());
  function readHint(): boolean {
    try { return localStorage.getItem(HINT_KEY) === '1'; } catch { return false; }
  }
  function dismissHint() {
    hintDismissed = true;
    try { localStorage.setItem(HINT_KEY, '1'); } catch { /* the hint simply shows again next time */ }
  }
  const legGate = new RequestFlight();
  interface Evidence { analysis: OptionsAnalysis; context: string; baseline: OptionsAnalysis; legIndex?: number }
  let contribution = $state.raw<Evidence | null>(null);
  let legPending = $state(false);
  let legMessage = $state('');
  let legFailed = $state(false);
  const context = $derived(chartContextKey(documentKey, draft, result, readOnly, !!onEdit));
  const editable = $derived(!!documentKey && !!draft && !!onEdit && !readOnly);
  const terminalAvailable = $derived(!result || exactTerminalAvailable(result));
  const legAnalysis = $derived(contribution?.context === context && contribution.baseline === result && contribution.legIndex === selectedLeg ? contribution.analysis : null);
  const legCurves = $derived(legAnalysis && result ? canonicalOverlay(legAnalysis, legAnalysis.request, !terminalAvailable) : []);
  const overlayCurves = $derived(legCurves);
  const overlayPoints = $derived(overlayCurves.map(s => seriesPoints(s.spots, s.values)));
  const legRows = $derived(result?.request.strategy.legs.map((leg, index) => ({ leg, index })) ?? []);
  const draftLeg = $derived(selectedLeg == null ? null : draft?.strategy.legs[selectedLeg]);
  const submittedLeg = $derived(selectedLeg == null ? null : result?.request.strategy.legs[selectedLeg]);
  const matchingLayout = $derived(!!draft && !!result && draft.strategy.legs.length === result.request.strategy.legs.length && draft.strategy.legs.every((leg, i) => leg.kind === result!.request.strategy.legs[i].kind));
  const canEditLeg = $derived(editable && matchingLayout && !!draftLeg?.enabled && draftLeg.kind !== 'underlying' && validStrike(draftLeg.strike));
  const ghost = $derived(drag?.proposed ?? (canEditLeg && draftLeg?.strike !== submittedLeg?.strike ? draftLeg?.strike : null));
  const width = $derived(Math.max(240, containerWidth));
  const left = 64, right = 18, height = 300, railY = 275;
  const plotWidth = $derived(width - left - right);
  const full = $derived(result ? priceDomain(result.spot_grid) : null);
  const domain = $derived(view ?? full);
  const error = $derived(result ? plotError(result) : null);
  const curves = $derived(result ? optionsSeries(result).filter(s => s.id !== 'expiry' || terminalAvailable) : []);
  const points = $derived(curves.map(s => seriesPoints(s.spots, s.values)));
  const inspectGrid = $derived(result ? [...new Set([...inspectionGrid(result), ...overlayCurves.flatMap(s => s.spots)])].sort((a, b) => a - b) : []);
  const expiryError = $derived(result ? (terminalAvailable ? expiryTraceError(result) : 'Exact terminal geometry unavailable for this horizon: no common-expiry payoff, extrema, breakevens or zero intervals. Use lifecycle analysis for expiry transitions.') : null);
  const legError = $derived(result ? legBreakdownError(result) : null);
  const stale = $derived(result && draft && requestChanged(draft, result.request));
  // While dragging, or until a changed draft is analyzed, its expiry payoff is drawn live: it is exact
  // arithmetic. Today and scenario curves need the model, so the submitted ones show faintly meanwhile.
  const liveDraft = $derived(draft && result && (drag || stale) ? (drag ? withStrike(draft, drag) : draft) : null);
  const livePoints = $derived(liveDraft && domain && terminalAvailable ? expiryPayoffPoints(liveDraft, domain) : null);
  const ghosted = $derived(!!drag || !!stale || pending);
  const pnlY = $derived(domain ? sampledYDomain([...points, ...overlayPoints, ...(livePoints ? [livePoints] : [])], domain) : { min: -1, max: 1 });
  const zeroY = $derived(scaleValue(0, pnlY, 208, 24));
  const pnlTicks = $derived(niceTicks(pnlY, 5));
  const pnlStep = $derived(pnlTicks.length > 1 ? pnlTicks[1] - pnlTicks[0] : 1);
  const xTicks = $derived(domain ? niceTicks(domain, Math.max(3, Math.floor(plotWidth / 110))) : []);
  // Profit and loss shading follows the exact expiry line: the live one while editing.
  const fill = $derived(!domain || !terminalAvailable ? '' : fillPath(livePoints ?? points[curves.findIndex(c => c.id === 'expiry')] ?? [], domain, pnlY, plotWidth, 24, 208));
  const handles = $derived.by(() => {
    const rows: { index: number; x: number; row: number; label: string; side: 'buy' | 'sell'; edited: boolean }[] = [];
    for (const { leg, index } of legRows) {
      const strike = leg.kind === 'underlying' || !leg.enabled || !validStrike(leg.strike) ? null : handleStrike(index);
      if (strike == null || !inView(strike)) continue;
      const current = editable && matchingLayout ? draft?.strategy.legs[index] ?? leg : leg;
      const side = current.quantity < 0 ? 'sell' : 'buy';
      const px = x(strike);
      const row = rows.some(r => r.row === 0 && Math.abs(r.x - px) < 72) ? 1 : 0;
      rows.push({ index, x: px, row, side, edited: strike !== leg.strike, label: `L${index + 1} ${side === 'buy' ? '+' : '−'}${leg.kind === 'call' ? 'C' : 'P'} ${formatPrice(strike)}` });
    }
    return rows;
  });
  const greekCurves = $derived(result ? greekSeries(result, greek) : []);
  const greekPoints = $derived(result ? greekCurves.map(s => seriesPoints(result.spot_grid, s.values)) : []);
  const greekY = $derived(domain ? sampledYDomain(greekPoints, domain) : { min: -1, max: 1 });
  const greekError = $derived(result ? greekPlotError(result, greek) : null);
  const markers = $derived(result ? priceMarkers(result) : []);
  const offscreen = $derived(result && domain ? outsideView(result, domain) : null);
  const offscreenFull = $derived(result && full ? outsideView(result, full) : null);
  const activeIndex = $derived(result && domain && selected != null &&
    inspectGrid[selected] >= domain.min && inspectGrid[selected] <= domain.max ? selected : null);
  const activeSpot = $derived(activeIndex != null ? inspectGrid[activeIndex] : null);
  const greekIndex = $derived(activeSpot != null ? result?.spot_grid.indexOf(activeSpot) ?? -1 : -1);
  const drift = $derived(result && finiteValue(spot) && spot !== result.request.spot);
  const unit = $derived(result?.greek_units[greek] ?? '');

  // A new result or reprice can land mid-gesture: keep the drag (its release re-checks the live
  // draft in commitStrike) and reset everything else once no drag is active.
  $effect(() => {
    context; result;
    untrack(() => { if (drag) drag = { ...drag, context }; else resetEditing(); });
  });
  onDestroy(resetEditing);

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
    legGate.cancel();
    contribution = null;
    selected = null;
    legPending = false;
    legMessage = '';
    legFailed = false;
  }

  function withStrike(base: OptionsDraft, edit: StrikeDrag): OptionsDraft {
    return { ...base, strategy: { ...base.strategy, legs: base.strategy.legs.map((leg, i) => i === edit.legIndex ? { ...leg, strike: edit.proposed } : leg) } };
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
    const flight = legGate.start(() => context, () => { legPending = false; legFailed = true; legMessage = 'Leg curve timed out. Retry explicitly.'; });
    legPending = true; legMessage = ''; legFailed = false;
    const current = () => flight.current() && result === base && selectedLeg === index;
    try {
      const analysis = await requestChartAnalysis(request, flight.signal);
      if (!current()) return;
      canonicalOverlay(analysis, request);
      contribution = { analysis, context: key, baseline: base, legIndex: index };
      selected = null;
      legMessage = `Canonical submitted leg ${index + 1} contribution loaded; other legs are disabled for this request.`;
    } catch {
      if (current()) { legFailed = true; legMessage = 'Leg contribution request failed. Retry explicitly; submitted strategy evidence is unchanged.'; }
    } finally { flight.finish(); if (current()) legPending = false; }
  }

  $effect(() => {
    const grid = result?.spot_grid;
    result?.expiry_curve;
    const bounds = grid ? priceDomain(grid) : null;
    untrack(() => {
      view = keepView(view, bounds);
      selected = null;
      domainError = '';
      const shown = view ?? bounds;
      minimum = shown ? String(shown.min) : '';
      maximum = shown ? String(shown.max) : '';
    });
  });

  function setDomain(next: Domain) {
    cancelDrag();
    view = next;
    minimum = String(next.min);
    maximum = String(next.max);
    selected = null;
    domainError = '';
  }

  function fit() {
    if (full) setDomain(full);
    if (offscreenFull?.spot || offscreenFull?.strikes.length) onFit?.();
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
    <div class="empty"><strong>Payoff</strong><p>The chart appears when the analysis returns.</p></div>
  {:else if error}
    <div class="empty" role="alert"><strong>Chart data unavailable</strong><p>{error} Edit the inputs and analyze again.</p></div>
  {:else if domain && full}
    <header>
      <div><span class="eyebrow">THEORETICAL · EUROPEAN · CASH SETTLED</span><h3>{result.request.strategy.name}</h3></div>
      <div class="context">Submitted spot <b title={exactValue(result.request.spot)}>{formatPrice(result.request.spot)} USD</b><br />{terminalAvailable ? `${formatNumber(result.horizon?.first_expiry_days ?? result.request.strategy.days_to_expiry)} calendar days` : `Mixed expiry · ${exactValue(result.horizon?.first_expiry_days)}–${exactValue(result.horizon?.last_expiry_days)} days`} · ACT/365<span class="update-note" role="status">{stale ? 'Inputs changed · faded lines show the last analysis' : ''}</span></div>
    </header>
    {#if drift && !stale}<p class="notice">Draft spot changed. Charts still show the returned analysis at {formatPrice(result.request.spot)} USD; analyze again to refresh.</p>{/if}

    {#if offscreen?.spot || offscreen?.strikes.length}
      <p class="notice offscreen" role="status">
        <span>Outside this view: {[offscreen.spot ? `spot ${formatPrice(result.request.spot)} USD` : '', offscreen.strikes.length ? `strike${offscreen.strikes.length > 1 ? 's' : ''} ${offscreen.strikes.map(k => formatPrice(k)).join(', ')}` : ''].filter(Boolean).join(' and ')}.</span>
        <button type="button" onclick={fit}>Fit</button>
      </p>
    {/if}

    <div class="pane-title"><h4>P&amp;L by underlying price</h4><span>USD · signed strategy total</span></div>
    {#if expiryError}<p class="notice" role="status">{expiryError}</p>{/if}
    <div class="legend" aria-label="P&L series legend">
      {#each curves as curve (curve.id)}
        <span class="legend-item"><svg class={`swatch ${curve.tone}`} viewBox="0 0 28 10" aria-hidden="true"><path d="M0,5 L28,5" stroke-dasharray={curve.dash} /></svg>{curve.label}</span>
      {/each}
      {#each legCurves as curve (curve.id)}<span class="legend-item"><svg class={`swatch ${curve.tone}`} viewBox="0 0 28 10" aria-hidden="true"><path d="M0,5 L28,5" stroke-dasharray="14 5" /></svg>SUBMITTED L{(selectedLeg ?? 0) + 1} · {curve.label}</span>{/each}
      {#if fill}<span class="legend-item"><svg class="swatch" viewBox="0 0 28 10" aria-hidden="true"><rect class="fill-up" width="13" height="10" /><rect class="fill-down" x="15" width="13" height="10" /></svg>Profit / loss at expiry</span>{/if}
    </div>
    <div class="graph" class:dragging={!!drag} bind:clientWidth={containerWidth}>
      <div class="chart-control" role="slider" tabindex="0" aria-label="Inspect P&L at supplied price samples" aria-valuemin={domain.min} aria-valuemax={domain.max} aria-valuenow={sliderSpot()} aria-valuetext={activeSpot == null ? 'No sample selected' : `${formatPrice(activeSpot)} USD; values in readout below`} aria-describedby={`${id}-instructions`} onkeydown={keydown}>
        <svg bind:this={pnlSvg} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${terminalAvailable ? 'Expiration' : 'First-expiry model marks'}, today and scenario P&L for ${result.request.strategy.name}; underlying price in USD on x-axis, total P&L in USD on y-axis`} onpointermove={inspect} onpointerdown={inspect}>
          <title>Options P&amp;L over numeric underlying price</title>
          <desc>{terminalAvailable ? 'Expiration connects canonical piecewise-linear vertices, including every in-domain strike and isolated breakeven.' : 'First-expiry values are backend grid samples with later legs model-marked, not exact terminal payoff or risk limits.'} Today and scenarios connect backend grid samples only. Shading marks expiration profit and loss, dashed vertical lines mark strikes, labelled dots mark expiration breakevens and "Now" marks submitted spot. Returned values are below.</desc>
          <defs>
            <clipPath id={`${id}-pnl-clip`}><rect x={left} y="24" width={plotWidth} height="184" /></clipPath>
            <clipPath id={`${id}-up`}><rect x="0" y="24" width={plotWidth} height={Math.max(0, zeroY - 24)} /></clipPath>
            <clipPath id={`${id}-down`}><rect x="0" y={zeroY} width={plotWidth} height={Math.max(0, 208 - zeroY)} /></clipPath>
          </defs>
          {#each pnlTicks as tick}
            {@const py = scaleValue(tick, pnlY, 208, 24)}
            <line class="grid" x1={left} x2={width-right} y1={py} y2={py} />
            <text class="axis" x={left-7} y={py+3} text-anchor="end">{formatUsd(tick, { whole: Math.abs(pnlStep) >= 1 })}</text>
          {/each}
          <text class="axis" x={left} y="13">P&amp;L (USD)</text>
          <g clip-path={`url(#${id}-pnl-clip)`}>
            {#if fill}
              <path class="fill-up" clip-path={`url(#${id}-up)`} d={fill} transform={`translate(${left},0)`} />
              <path class="fill-down" clip-path={`url(#${id}-down)`} d={fill} transform={`translate(${left},0)`} />
            {/if}
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
              <path class={`curve ${curve.tone}${ghosted ? ' ghosted' : ''}`} d={svgPath(points[i], domain, pnlY, plotWidth, 24, 208)} transform={`translate(${left},0)`} stroke-dasharray={curve.dash} />
            {/each}
            {#if livePoints}<path class="curve expiry live" d={svgPath(livePoints, domain, pnlY, plotWidth, 24, 208)} transform={`translate(${left},0)`}><title>Expiration payoff of the edited strategy</title></path>{/if}
            {#each overlayCurves as curve, i (`${i}-${curve.id}`)}
              <path class={`curve ${curve.tone} contribution`} d={svgPath(overlayPoints[i], domain, pnlY, plotWidth, 24, 208)} transform={`translate(${left},0)`} stroke-dasharray="14 5" />
            {/each}
            {#if ghost != null && inView(ghost)}<line class="draft-ghost" x1={x(ghost)} x2={x(ghost)} y1="24" y2="208"><title>Edited strike {formatPrice(ghost)} USD</title></line>{/if}
            {#if selectedLeg != null && validStrike(submittedLeg?.strike) && inView(submittedLeg.strike)}<line class="selected-strike" x1={x(submittedLeg.strike)} x2={x(submittedLeg.strike)} y1="24" y2="208" />{/if}
            {#if activeSpot != null && activeIndex != null}
              <line class="crosshair" x1={x(activeSpot)} x2={x(activeSpot)} y1="24" y2="208" />
              {#each curves as curve (curve.id)}
                {#if finiteValue(seriesValue(curve, activeSpot))}<circle class={`point ${curve.tone}`} cx={x(activeSpot)} cy={scaleValue(seriesValue(curve, activeSpot) as number, pnlY, 208, 24)} r="3.5" />{/if}
              {/each}
            {/if}
          </g>
          {#each markers.filter(m => inView(m.spot) && m.kind !== 'strike') as marker}
            {#if marker.kind === 'breakeven'}
              <circle class="be" cx={x(marker.spot)} cy={zeroY} r="4"><title>{marker.label}</title></circle>
              <text class="be-label" x={x(marker.spot) + (marker.spot < result.request.spot ? -7 : 7)} y={zeroY - 8} text-anchor={marker.spot < result.request.spot ? 'end' : 'start'}>{formatPrice(marker.spot)}</text>
            {:else}
              <text class="spot-label" x={x(marker.spot) + 5} y="34">Now {formatPrice(marker.spot)}</text>
            {/if}
          {/each}
          {#each xTicks as tick}
            <text class="axis" x={x(tick)} y="226" text-anchor="middle">{formatPrice(tick)}</text>
          {/each}
          <text class="axis" x={left+plotWidth/2} y="244" text-anchor="middle">Underlying price (USD)</text>
          {#if handles.length}<rect class="rail" x={left} y="254" width={plotWidth} height="42" rx="4" />{/if}
        </svg>
      </div>
      <div class="strike-handles" aria-label="Submitted option strike handles">
        {#each handles as handle (handle.index)}
          {@const leg = result.request.strategy.legs[handle.index]}
          <button type="button" class={`strike-handle ${handle.side}`} class:edited={handle.edited} class:chosen={selectedLeg === handle.index} class:draggable={editable && matchingLayout}
            style:left={`${handle.x / width * 100}%`} style:top={`${(railY + (handles.some(h => h.row) ? (handle.row ? 11 : -11) : 0)) / height * 100}%`}
            aria-label={`L${handle.index + 1} submitted ${leg.kind} strike ${leg.strike} USD. ${handle.edited ? `Edited strike ${handleStrike(handle.index)} USD. ` : ''}Select contribution with Enter/Space; ${editable && matchingLayout ? 'drag or arrows to edit draft strike' : 'read-only strike'}.`}
            aria-pressed={selectedLeg === handle.index}
            onkeydown={(event) => handleKey(event, handle.index)}
            onpointerdown={(event) => startDrag(event, handle.index)} onpointermove={moveDrag} onpointerup={endDrag}
            onpointercancel={() => cancelDrag()} onlostpointercapture={() => cancelDrag()}
            onclick={(event) => markerClick(event, handle.index)}>{handle.label}</button>
        {/each}
      </div>
    </div>
    <p id={`${id}-instructions`} class="note">Hover the chart, or focus it and use the arrow keys, to read values; Escape clears.</p>
    {#if !inspectGrid.some(s => inView(s))}<p class="notice">No supplied samples or vertices inside this zoomed view. Lines may show clipped connections between neighboring points; zoom out or reset to inspect exact values.</p>{/if}
    {#if curves.some(c => c.values.some(v => !finiteValue(v)))}<p class="notice">Some returned P&amp;L values are unavailable. Paths break at missing/nonfinite values; see exact-value data.</p>{/if}
    <div class="readout" aria-live="polite" aria-atomic="true">
      {#if activeIndex != null && activeSpot != null}
        <strong title={exactValue(activeSpot)}>Spot {formatPrice(activeSpot)} USD</strong>
        <dl>{#each curves as curve (curve.id)}<div><dt>{curve.label} P&amp;L</dt><dd title={exactValue(seriesValue(curve, activeSpot))}>{formatUsd(seriesValue(curve, activeSpot), { signed: true })}</dd></div>{/each}
          {#each legCurves as curve (curve.id)}<div><dt>SUBMITTED L{(selectedLeg ?? 0) + 1} {curve.label} P&amp;L</dt><dd title={exactValue(seriesValue(curve, activeSpot))}>{formatUsd(seriesValue(curve, activeSpot), { signed: true })}</dd></div>{/each}
          <div><dt>Today {greek}</dt><dd title={exactValue(greekCurves[0]?.values[greekIndex])}>{formatGreek(greekCurves[0]?.values[greekIndex], { signed: true })} · {unit}</dd></div>
        </dl>
      {:else}<span>No price selected.</span>{/if}
    </div>

    {#snippet secondary()}
    <section class="strike-editor" aria-label="Strike proposals and submitted leg contribution">
      <div class="pane-title"><h4>Strikes and legs</h4></div>
      {#if !editable}<p class="note">Read-only chart: its controls never change Python source.</p>{:else}
        {#if !hintDismissed}<p class="first-run">Drag a strike tag along the rail, or select a leg and use the arrow keys or the strike field. The expiry line follows as you drag, and the analysis updates when you let go; Escape cancels. <button type="button" onclick={dismissHint}>Got it</button></p>{/if}
      {/if}
      <div class="leg-selectors" aria-label="Select submitted leg">
        {#each legRows as row (row.index)}
          <button type="button" class:chosen={selectedLeg === row.index} aria-pressed={selectedLeg === row.index} onclick={() => loadLeg(row.index)}>
            L{row.index + 1}: {row.leg.kind} · {exactValue(row.leg.quantity, true)} {row.leg.kind === 'underlying' ? 'shares' : 'contracts'}{row.leg.kind !== 'underlying' ? ` · K ${formatPrice(row.leg.strike)} USD` : ''}{row.leg.enabled ? '' : ' · disabled'}
          </button>
        {/each}
      </div>
      <p class="note">Select a leg to compare its own curve.</p>
      {#if selectedLeg != null && submittedLeg}
        <p class="note">Selected submitted L{selectedLeg + 1}: {submittedLeg.kind}, premium {formatUsd(submittedLeg.entry_premium)}/unit, multiplier {exactValue(submittedLeg.multiplier)}{submittedLeg.source ? ` · source ${submittedLeg.source.provider}/${submittedLeg.source.environment} · ${submittedLeg.source.contract_symbol}` : ' · manual inputs'}.</p>
        {#if result.legs?.find(l => l.leg_index === selectedLeg)}
          {@const leg = result.legs.find(l => l.leg_index === selectedLeg)!}
          <p class="note">Canonical submitted-spot contribution: today P&amp;L {formatUsd(leg.pnl_today, { signed: true })} · delta {formatGreek(leg.greeks.delta, { signed: true })} equivalent shares.</p>
        {/if}
      {/if}
      {#if editable}
        {#if !matchingLayout}<p class="notice">Draft leg layout changed. Analyze explicitly before editing chart strikes; submitted leg selection still inspects the original evidence.</p>{/if}
        <form class="domain-controls" onsubmit={numericStrike} aria-label="Edit selected draft strike">
          <label for={`${id}-strike`}>Draft L{selectedLeg == null ? '—' : selectedLeg + 1} strike (USD)
            <input id={`${id}-strike`} type="text" name="chart-strike" autocomplete="off" inputmode="decimal" bind:value={strikeText} disabled={!canEditLeg || !!drag} aria-invalid={!!strikeError} aria-describedby={`${id}-strike-note`} />
          </label>
          <label for={`${id}-snap`}>Drag/arrow step (USD)
            <select name="chart-snap-step" id={`${id}-snap`} bind:value={step} disabled={!!drag}>{#each STRIKE_STEPS as s}<option value={s}>{s}</option>{/each}</select>
          </label>
          <div class="actions">
            <button type="button" disabled={!canEditLeg || !!drag} onclick={() => selectedLeg != null && incrementStrike(selectedLeg, -1)}>Strike −</button>
            <button type="button" disabled={!canEditLeg || !!drag} onclick={() => selectedLeg != null && incrementStrike(selectedLeg, 1)}>Strike +</button>
            <button type="submit" disabled={!canEditLeg || !!drag}>Apply strike</button>
          </div>
        </form>
        <p id={`${id}-strike-note`} class="note" class:notice={!!strikeError} role={strikeError ? 'alert' : undefined}>{strikeError}</p>
        {#if draftLeg?.source || submittedLeg?.source}<p class="note">A different strike is a different contract: its provider observation and quotes are cleared.</p>{/if}
      {/if}
      {#if legPending}<p class="note" role="status">Canonical leg contribution pending.</p><button type="button" onclick={cancelLeg}>Cancel leg request</button>{/if}
      {#if legMessage}<p class="note" role={legFailed ? 'alert' : 'status'}>{legMessage}</p>{/if}
      {#if legAnalysis}<p class="note">SELECTED SUBMITTED L{(selectedLeg ?? 0) + 1} · long-dashed, thicker overlay · fixed original premiums and fees.{!terminalAvailable ? ' Today only for mixed expiry; no isolated own-expiry line is compared to the multi-expiry strategy.' : ''}</p>{/if}
      {#if ghost != null}<p class="note" role="status">Edited L{(selectedLeg ?? 0) + 1} strike: {formatPrice(ghost)} USD{inView(ghost) ? '' : ' (outside current view)'}. {drag ? 'Release to apply, Escape to cancel.' : 'The analysis updates with it.'}</p>{/if}
    </section>

    <form class="domain-controls" onsubmit={applyDomain} aria-label="Numeric price view">
      <label for={`${id}-minimum`}>From (USD)<input id={`${id}-minimum`} type="text" name="chart-view-min" autocomplete="off" inputmode="decimal" bind:value={minimum} aria-invalid={!!domainError} aria-describedby={`${id}-domain-note`} /></label>
      <label for={`${id}-maximum`}>To (USD)<input id={`${id}-maximum`} type="text" name="chart-view-max" autocomplete="off" inputmode="decimal" bind:value={maximum} aria-invalid={!!domainError} aria-describedby={`${id}-domain-note`} /></label>
      <div class="actions">
        <button type="submit">Apply view</button>
        <button type="button" onclick={() => setDomain(zoomDomain(domain, full, 0.5, activeSpot ?? undefined))} aria-label="Zoom in price domain">Zoom +</button>
        <button type="button" onclick={() => setDomain(zoomDomain(domain, full, 2))} aria-label="Zoom out price domain">Zoom −</button>
        <button type="button" onclick={() => setDomain(full)}>Reset</button>
      </div>
    </form>
    <p id={`${id}-domain-note`} class:notice={!!domainError} class="note" role={domainError ? 'alert' : undefined}>{domainError || `View ${formatPrice(domain.min)}–${formatPrice(domain.max)} USD. Zoom changes display only, not the analysis.`}</p>

    <div class="pane-title greek-heading"><div><h4>Greek exposure by price</h4><p class="note">Today only · signed, quantity × multiplier weighted</p></div>
      <label for={`${id}-greek`}>Greek<select name="chart-greek" id={`${id}-greek`} bind:value={greek}>{#each GREEK_KEYS as key}<option value={key}>{key}</option>{/each}</select></label>
    </div>
    <p class="unit">{greek} · {unit}</p>
    {#if greekError}<p class="notice" role="status">{greekError}</p>{/if}
    <div class="chart-control" role="slider" tabindex="0" aria-label={`Inspect today ${greek} at supplied price samples`} aria-valuemin={domain.min} aria-valuemax={domain.max} aria-valuenow={sliderSpot()} aria-valuetext={activeSpot == null ? 'No sample selected' : `${formatPrice(activeSpot)} USD; ${formatGreek(greekCurves[0]?.values[greekIndex], { signed: true })} ${unit}`} aria-describedby={`${id}-instructions`} onkeydown={keydown}>
      <svg viewBox={`0 0 ${width} 194`} role="img" aria-label={`Today ${greek}, ${unit}, over underlying price in USD; aligned with P&L pane`} onpointermove={inspect} onpointerdown={inspect}>
        <title>Today {greek} by underlying price</title><desc>Only backend greeks_grid values are plotted. Null Greeks form gaps, never zeros. Scenario aggregate values are listed separately at the submitted spot.</desc>
        <defs><clipPath id={`${id}-greek-clip`}><rect x={left} y="20" width={plotWidth} height="128" /></clipPath></defs>
        {#if !greekError}
          {#each niceTicks(greekY, 3) as tick}
            {@const py = scaleValue(tick, greekY, 148, 20)}
            <line class="grid" x1={left} x2={width-right} y1={py} y2={py} />
            <text class="axis" x={left-7} y={py+3} text-anchor="end">{axisValue(tick, greekY.max - greekY.min)}</text>
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
        {#each xTicks as tick}<text class="axis" x={x(tick)} y="166" text-anchor="middle">{formatPrice(tick)}</text>{/each}
        <text class="axis" x={left+plotWidth/2} y="186" text-anchor="middle">Underlying price (USD)</text>
      </svg>
    </div>
    <div class="aggregate"><strong>{greek} at submitted spot {formatPrice(result.request.spot)} USD</strong><dl>
      <div><dt>Today</dt><dd title={exactValue(result.greeks[greek])}>{formatGreek(result.greeks[greek], { signed: true })} · {unit}</dd></div>
      {#each result.scenarios as scenario}<div><dt>{scenario.name}</dt><dd title={exactValue(scenario.greeks[greek])}>{formatGreek(scenario.greeks[greek], { signed: true })} · {unit}</dd></div>{/each}
    </dl></div>

    {/snippet}
    {#if compact}<details class="evidence"><summary>Strike, view and Greek controls</summary>{@render secondary()}</details>{:else}{@render secondary()}{/if}

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
  .update-note { display: block; height: 1.6em; overflow-wrap: normal; white-space: nowrap; color: oklch(var(--risk)); }
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
  .offscreen { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
  .first-run { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; margin: 8px 0; padding: 8px; border-radius: 4px; background: oklch(var(--accent)); line-height: 1.5; font-size: 12px; }
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
  .strike-handle { position: absolute; transform: translate(-50%, -50%); min-height: 22px; padding: 1px 6px; border-width: 1.5px; font: 700 11px var(--font-family-lato); font-variant-numeric: tabular-nums; pointer-events: auto; z-index: 1; }
  .strike-handle.buy { border-color: oklch(var(--up-color)); background: color-mix(in oklab, oklch(var(--up-color)) 18%, oklch(var(--card))); }
  .strike-handle.sell { border-color: oklch(var(--down-color)); background: color-mix(in oklab, oklch(var(--down-color)) 18%, oklch(var(--card))); }
  .strike-handle.edited { border-style: dashed; background: oklch(var(--card)); }
  .strike-handle.draggable { cursor: ew-resize; touch-action: none; }
  .strike-handle.chosen { z-index: 3; }
  .chosen { border: 2px solid oklch(var(--foreground)); text-decoration: underline; text-underline-offset: 3px; }
  .curve.contribution { stroke-width: 3.5; }
  .curve.ghosted { opacity: 0.35; }
  .curve.live { stroke-width: 2.5; }
  .draft-ghost { stroke: oklch(var(--foreground)); stroke-width: 2; stroke-dasharray: 1 5; }
  .selected-strike { stroke: oklch(var(--foreground)); stroke-width: 2; stroke-dasharray: 12 3; }
  button:disabled, input:disabled, select:disabled { cursor: not-allowed; opacity: 0.6; }
  .chart-control { width: 100%; border-radius: 4px; background: oklch(var(--card)); }
  .chart-control > svg { display: block; width: 100%; touch-action: pan-y; }
  .grid { stroke: var(--chart-grid); stroke-width: 1; }
  .axis { fill: oklch(var(--muted-foreground)); font: 10px var(--font-mono); font-variant-numeric: tabular-nums; }
  .curve { fill: none; stroke: currentColor; stroke-width: 2; vector-effect: non-scaling-stroke; }
  .expiry { color: oklch(var(--foreground)); }
  .fill-up { fill: oklch(var(--up-color) / 0.16); }
  .fill-down { fill: oklch(var(--down-color) / 0.16); }
  .be { fill: oklch(var(--card)); stroke: oklch(var(--foreground)); stroke-width: 1.5; }
  .be-label, .spot-label { fill: oklch(var(--foreground)); font: 700 11px var(--font-family-lato); font-variant-numeric: tabular-nums; }
  .rail { fill: oklch(var(--background)); stroke: oklch(var(--border)); }
  .graph.dragging { user-select: none; -webkit-user-select: none; }
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

<script lang="ts">
  import { untrack } from 'svelte';
  import { getSessionGeneration } from '$lib/core/api';
  import type { OptionsResearchToolProps } from '$lib/features/options/optionsResearchTypes';
  import type { OptionsAnalysis } from '$lib/features/options/optionsTypes';
  import { exactValue } from '$lib/features/options/optionsChart';
  import { compareSkew, editSkewPoint, skewComparisonRequests, skewPoints, skewSeries, transformSkew } from '$lib/features/options/optionsSkew';
  import { GREEK_KEYS, researchDifference } from '$lib/features/options/optionsStress';

  let { draft, onEdit, documentKey, readOnly = false }: OptionsResearchToolProps = $props();
  const id = $props.id();
  const points = $derived(skewPoints(draft));
  const series = $derived(skewSeries(draft));
  const draftKey = $derived(JSON.stringify(draft));
  let parallel = $state('0'), twist = $state('0'), curvature = $state('0');
  let edits = $state<Record<number, string>>({});
  let pointErrors = $state<Record<number, string>>({});
  let editError = $state('');
  let notice = $state('');
  let error = $state('');
  let pending = $state(false);
  let submittedKey = $state('');
  let result = $state<{ flat: OptionsAnalysis; skew: OptionsAnalysis } | null>(null);
  const stale = $derived(!!result && submittedKey !== draftKey);
  let controller: AbortController | null = null;
  let generation = 0;

  function stop() { generation++; controller?.abort(); controller = null; pending = false; }
  function cancel() { stop(); notice = 'Comparison cancelled. Previous submitted evidence is unchanged.'; }
  $effect(() => {
    documentKey;
    untrack(() => { stop(); result = null; submittedKey = ''; error = ''; notice = ''; editError = ''; edits = {}; pointErrors = {}; parallel = '0'; twist = '0'; curvature = '0'; });
    return stop;
  });
  $effect(() => { draftKey; untrack(() => { edits = {}; pointErrors = {}; }); });
  $effect(() => { if (readOnly) untrack(stop); });
  $effect(() => { draftKey; untrack(() => { if (pending) { stop(); notice = 'Comparison cancelled because inputs changed. Compare explicitly to refresh.'; } }); });

  const numeric = (value: string) => value.trim() === '' ? NaN : Number(value);
  const display = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? exactValue(value, true) : 'Unavailable';
  const validPoints = $derived(points.filter(p => Number.isFinite(p.strike) && Number.isFinite(p.iv) && p.iv >= 0 && p.iv <= 5));
  const xRange = $derived(validPoints.length ? [Math.min(...validPoints.map(p => p.strike)), Math.max(...validPoints.map(p => p.strike))] : [0, 1]);
  const maxIV = $derived(Math.max(1, ...points.map(p => Number.isFinite(p.iv) ? p.iv * 100 : 0)));
  const x = (strike: number) => xRange[0] === xRange[1] ? 270 : 45 + (strike - xRange[0]) / (xRange[1] - xRange[0]) * 450;
  const y = (iv: number) => 145 - iv * 100 / maxIV * 115;

  function applyPoint(index: number) {
    if (readOnly) return;
    const value = edits[index] ?? String((points.find(p => p.legIndex === index)?.iv ?? NaN) * 100);
    const iv = value.trim() === '' ? null : numeric(value) / 100;
    try {
      const copy = structuredClone($state.snapshot(draft));
      editSkewPoint(copy, index, iv);
      onEdit(d => editSkewPoint(d, index, iv));
      pointErrors[index] = ''; notice = 'IV edit applied to draft only. Compare explicitly for canonical marks.';
    } catch (e) { pointErrors[index] = e instanceof Error ? e.message : 'IV edit failed.'; }
  }
  function applyTransform(event: SubmitEvent) {
    event.preventDefault(); if (readOnly) return;
    try {
      const next = transformSkew($state.snapshot(draft), { parallelPP: numeric(parallel), twistPP: numeric(twist), curvaturePP: numeric(curvature) });
      onEdit(d => { d.volatility = next.volatility; next.strategy.legs.forEach((leg, index) => { if (leg.enabled && leg.kind !== 'underlying') d.strategy.legs[index].implied_volatility = leg.implied_volatility; }); });
      editError = ''; notice = 'Transform applied atomically to draft IVs. Premiums and source provenance are unchanged.';
    } catch (e) { editError = e instanceof Error ? e.message : 'Transform failed. Nothing applied.'; }
  }
  function reset(index?: number) {
    if (readOnly) return;
    onEdit(d => { d.strategy.legs.forEach((leg, i) => { if (leg.enabled && leg.kind !== 'underlying' && (index == null || i === index)) leg.implied_volatility = null; }); });
    notice = 'Enabled option overrides reset to declared base IV. Disabled legs, premiums and provenance are unchanged.';
  }
  async function compare() {
    if (readOnly || pending) return;
    try { skewComparisonRequests($state.snapshot(draft)); } catch (e) { error = e instanceof Error ? e.message : 'Correct draft inputs before comparing.'; return; }
    stop(); const flight = ++generation, scope = documentKey, session = getSessionGeneration();
    const key = draftKey, snapshot = structuredClone($state.snapshot(draft));
    const abort = new AbortController(); controller = abort; pending = true; error = ''; notice = '';
    const current = () => flight === generation && scope === documentKey && session === getSessionGeneration() && key === draftKey;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; abort.abort(); }, 15000);
    try {
      const response = await compareSkew(snapshot, abort.signal);
      if (current() && !abort.signal.aborted) { result = response; submittedKey = key; }
    } catch {
      if (current()) { error = timedOut ? 'Comparison timed out. Retry explicitly.' : 'Canonical comparison failed. Check draft inputs and retry; no inputs were changed.'; abort.abort(); }
    } finally {
      clearTimeout(timer);
      if (flight === generation) {
        pending = false; controller = null;
        if (session !== getSessionGeneration()) { result = null; submittedKey = ''; error = ''; notice = 'Account scope changed; compare explicitly in the current scope.'; }
      }
    }
  }
</script>

<section class="skew-tool" aria-label="Volatility skew editor">
  <header><h3>Volatility skew</h3><button type="button" class="ot-workbench-primary" disabled={readOnly || pending || !points.length} onclick={compare}>Compare flat IV vs skew</button></header>
  <p class="note">Hypothetical manual IVs, not a fetched market smile. Each expiry/right is a separate point series; no interpolation or pricing runs here. Entry premiums stay fixed.</p>
  {#if readOnly}<p class="notice">Read-only source mode. Switch explicitly to the visual draft to edit or run this tool; Python source is never replaced.</p>{/if}
  {#if !points.length}<p>No enabled option legs. Enable an option in the draft to edit IV.</p>{:else}
    {#each series as group, groupIndex}
    <h4>{group.key} · IV points</h4>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard access to bounded scrolling plot) -->
    <div class="plot" role="region" aria-label={`IV versus strike: ${group.key}, exact values follow`} tabindex="0">
      <svg viewBox="0 0 540 195" role="img" aria-labelledby={`${id}-plot-title-${groupIndex}`}>
        <title id={`${id}-plot-title-${groupIndex}`}>Enabled {group.key} IV assumptions by strike. Leg numbers identify the exact values below.</title>
        <text x="45" y="15">IV % · 0–{exactValue(maxIV)}</text>
        <path d="M45 25V145H500" class="axis" />
          {#each group.points as point}
            {#if Number.isFinite(point.iv) && point.iv >= 0 && point.iv <= 5 && Number.isFinite(point.strike)}
              <circle cx={x(point.strike)} cy={y(point.iv)} r={4 + groupIndex % 3} fill="none"><title>Leg {point.legIndex + 1} · {point.right} · {point.expiry} · strike {point.strike} USD · IV {point.iv * 100}%</title></circle>
              <text x={x(point.strike) + 5} y={y(point.iv) - 6}>L{point.legIndex + 1}</text>
            {/if}
          {/each}
        <text x="45" y="165">{exactValue(xRange[0])}</text><text x="450" y="165">{exactValue(xRange[1])}</text><text x="225" y="188">Strike · USD</text>
      </svg>
    </div>
    {/each}
    {#each series as group}
      <fieldset disabled={readOnly}><legend>{group.key} · separate IV series</legend>
        {#each group.points as point}
          <div class="point-row">
            <label for={`${id}-point-${point.legIndex}`}>Leg {point.legIndex + 1} · {point.right} · K {exactValue(point.strike)} USD · {point.expiry}<span class="note">{point.inherited ? 'Inherited base' : 'Explicit override'}: {exactValue(point.iv * 100)}% IV</span>
              <input id={`${id}-point-${point.legIndex}`} type="number" min="0" max="500" step="any" value={edits[point.legIndex] ?? String(point.iv * 100)} oninput={e => edits[point.legIndex] = e.currentTarget.value} aria-invalid={!!pointErrors[point.legIndex]} aria-describedby={`${id}-point-error-${point.legIndex}`} />
            </label>
            <div class="actions"><button type="button" class="ot-workbench-ghost" onclick={() => applyPoint(point.legIndex)}>Apply IV %</button><button type="button" class="ot-workbench-ghost" onclick={() => reset(point.legIndex)}>Use base IV</button></div>
            <p id={`${id}-point-error-${point.legIndex}`} class="note">{pointErrors[point.legIndex] || '0–500% IV; blank + Apply resets to base.'}</p>
          </div>
        {/each}
      </fieldset>
    {/each}
  {/if}
  <form onsubmit={applyTransform}>
    <fieldset disabled={readOnly || !points.length}><legend>Atomic IV transform · percentage points</legend>
      <p class="note">Declared base {exactValue(draft.volatility * 100)}% IV. Parallel shifts base and active IVs; twist adds pp × x, curvature pp × x². x = (strike − spot) / largest enabled strike distance from spot; x = 0 when all strikes equal spot. Inherited IVs stay inherited unless a wing changes them.</p>
      <div class="fields">
        <label for={`${id}-parallel`}>Parallel shift · pp<input id={`${id}-parallel`} type="number" min="-500" max="500" step="any" value={parallel} oninput={e => parallel = e.currentTarget.value} /></label>
        <label for={`${id}-twist`}>Skew twist · wing pp<input id={`${id}-twist`} type="number" min="-500" max="500" step="any" value={twist} oninput={e => twist = e.currentTarget.value} /></label>
        <label for={`${id}-curvature`}>Smile curvature · wing pp<input id={`${id}-curvature`} type="number" min="-500" max="500" step="any" value={curvature} oninput={e => curvature = e.currentTarget.value} /></label>
      </div>
      <p class="note">Each transform: −500 to +500 pp. Resulting base and all active IVs must remain 0–500%; nothing is clipped.</p>
      {#if editError}<p role="alert">{editError}</p>{/if}
      <div class="actions"><button class="ot-workbench-ghost" type="submit">Apply transform</button><button class="ot-workbench-ghost" type="button" onclick={() => reset()}>Reset active overrides</button></div>
    </fieldset>
  </form>
  <div aria-live="polite" aria-atomic="true">
    {#if pending}<p>{result ? 'Comparing; previous submitted evidence remains below.' : 'Comparing canonical backend marks…'}</p><button type="button" class="ot-workbench-ghost" onclick={cancel}>Cancel comparison</button>{/if}
    {#if stale}<p class="notice">Stale: draft changed since comparison. Re-run explicitly; old results have not been repriced.</p>{/if}
    {#if notice}<p>{notice}</p>{/if}{#if error}<p role="alert">{error}</p>{/if}
    {#if !result && !pending && !error}<p class="note">No comparison submitted. Results are session-local, not saved.</p>{/if}
  </div>
  {#if result}
    <h4>Submitted canonical comparison · {result.skew.request.strategy.name}</h4>
    <p class="note">Spot {exactValue(result.skew.request.spot)} USD · flat base {exactValue(result.flat.request.volatility * 100)}% IV · rate {exactValue(result.skew.request.rate)} · yield {exactValue(result.skew.request.dividend_yield)} annual fractions · BSM European cash-settled USD. Today marks at each leg’s submitted expiry; entry premiums/fees unchanged. Scenarios/surfaces are excluded from this comparison.</p>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (keyboard-scrollable data region) -->
    <div class="results" role="region" tabindex="0" aria-label="Flat versus skew canonical signed totals">
      <table><thead><tr><th>Metric / units</th><th>Flat IV</th><th>Skew IV</th><th>Skew − flat</th></tr></thead><tbody>
        <tr><th>P&amp;L today · USD</th><td>{display(result.flat.summary.pnl_today)}</td><td>{display(result.skew.summary.pnl_today)}</td><td>{display(researchDifference(result.skew.summary.pnl_today, result.flat.summary.pnl_today))}</td></tr>
        <tr><th>Theoretical value · USD</th><td>{display(result.flat.summary.theoretical_value_today)}</td><td>{display(result.skew.summary.theoretical_value_today)}</td><td>{display(researchDifference(result.skew.summary.theoretical_value_today, result.flat.summary.theoretical_value_today))}</td></tr>
        {#each GREEK_KEYS as key}<tr><th>{key} · {result.skew.greek_units[key]}</th><td>{display(result.flat.greeks[key])}</td><td>{display(result.skew.greeks[key])}</td><td>{display(researchDifference(result.skew.greeks[key], result.flat.greeks[key]))}</td></tr>{/each}
      </tbody></table>
    </div>
    <details>
      <summary>Submitted leg IV and expiry context</summary>
      {#each skewPoints(result.skew.request) as point}
        <p class="note">Leg {point.legIndex + 1} · {point.right} · strike {exactValue(point.strike)} USD · {point.expiry} ({exactValue(point.days)} days) · {point.inherited ? 'inherited' : 'explicit'} {exactValue(point.iv * 100)}% IV; flat comparison uses {exactValue(result.flat.request.volatility * 100)}% IV.</p>
      {/each}
    </details>
    {#each [...new Set([...result.flat.warnings, ...result.skew.warnings])] as warning}<p class="note">{warning}</p>{/each}
  {/if}
</section>

<style>
  .skew-tool { display: grid; gap: 8px; min-width: 0; color: oklch(var(--foreground)); font-family: var(--font-family-lato); font-size: 12px; container-type: inline-size; }
  header, .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; justify-content: space-between; }
  h3, h4, p { margin: 0; } h3, h4 { font-size: 12px; } p { overflow-wrap: anywhere; line-height: 1.5; }
  .note { color: oklch(var(--muted-foreground)); } .notice { border-left: 2px solid currentColor; padding-left: 8px; }
  fieldset { min-width: 0; display: grid; gap: 8px; border: 1px solid oklch(var(--border)); border-radius: 4px; padding: 8px; }
  legend { padding: 0 4px; } .fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 145px), 1fr)); gap: 8px; }
  label { display: grid; gap: 4px; min-width: 0; line-height: 1.5; } .point-row { display: grid; gap: 6px; }
  input { min-width: 0; width: 100%; box-sizing: border-box; min-height: 28px; padding: 4px 6px; color: inherit; background: oklch(var(--background)); border: 1px solid oklch(var(--input)); border-radius: 4px; font: inherit; }
  input, td { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
  button { min-height: 28px; height: auto; white-space: normal; overflow-wrap: anywhere; } button:disabled { cursor: not-allowed; }
  :is(input, button, summary, [tabindex]):focus-visible { outline: 2px solid oklch(var(--ring)); outline-offset: 2px; }
  .plot, .results { overflow: auto; max-height: 320px; border: 1px solid oklch(var(--border)); border-radius: 4px; }
  svg { display: block; width: 100%; min-width: 280px; max-height: 240px; } svg text { fill: currentColor; font: 10px var(--font-mono); } circle, .axis { stroke: currentColor; } .axis { fill: none; }
  table { width: 100%; border-collapse: collapse; } td, th { padding: 6px; border-bottom: 1px solid oklch(var(--border)); text-align: right; } th:first-child { text-align: left; } td { white-space: nowrap; }
  @media (forced-colors: active) { fieldset, input, .plot, .results { border-color: CanvasText; } :is(input, button, summary, [tabindex]):focus-visible { outline-color: Highlight; } }
  @media (pointer: coarse) { button, input { min-height: var(--control-touch-height); } }
</style>

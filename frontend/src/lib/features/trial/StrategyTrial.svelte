<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch, readErrorMessage } from '$lib/core/api';
  import type { TrialCatalog, TrialConfig, TrialReport, TrialStrategy } from '$lib/features/trial-report/types';
  import { readTrialShareConfig } from '$lib/features/trial-report/sharing';
  import ReportActions from '$lib/features/trial-report/ReportActions.svelte';
  import EquityEvidence from './EquityEvidence.svelte';
  import RunMetrics from './RunMetrics.svelte';
  import { formatDate, formatMoney, formatPercent, validCost } from './evidence';

  let { workspaceHref = '/?workspace=1' }: { workspaceHref?: string } = $props();

  const knownCases = ['backtest-billionaire', 'overcaffeinated-trader', 'boring-benchmark'];
  const caseNotes: Record<string, string> = {
    'backtest-billionaire': 'A beautiful fit. An awkward next chapter.',
    'overcaffeinated-trader': 'A busy strategy. A very patient fee meter.',
    'boring-benchmark': 'Buy. Hold. Give the clever ideas a fair opponent.',
  };

  let strategies = $state<TrialStrategy[]>([]);
  let selectedId = $state<TrialConfig['strategy_id']>('backtest-billionaire');
  let commission = $state<number | undefined>(1);
  let slippage = $state<number | undefined>(5);
  let catalogLoading = $state(true);
  let catalogError = $state('');
  let running = $state(false);
  let runError = $state('');
  let report = $state.raw<TrialReport | null>(null);
  let statusMessage = $state('Opening the case files…');
  let catalogController: AbortController | null = null;
  let runController: AbortController | null = null;
  let runSequence = 0;
  let initialSharedConfig: TrialConfig | null = null;
  let disposed = false;

  let costsValid = $derived(validCost(commission) && validCost(slippage));
  let inputsChanged = $derived(report !== null && (
    report.config.strategy_id !== selectedId ||
    report.config.commission_bps !== commission ||
    report.config.slippage_bps !== slippage
  ));
  let selectedStrategy = $derived(strategies.find(strategy => strategy.id === selectedId));

  function cancelRun(): void {
    runSequence += 1;
    runController?.abort();
    runController = null;
    running = false;
  }

  function chooseCase(id: TrialConfig['strategy_id']): void {
    if (id === selectedId) return;
    cancelRun();
    selectedId = id;
    runError = '';
    statusMessage = 'Case selected. Cross-examine to measure this setup.';
  }

  async function loadCatalog(): Promise<void> {
    catalogController?.abort();
    const controller = new AbortController();
    catalogController = controller;
    catalogLoading = true;
    catalogError = '';
    try {
      const response = await apiFetch('/trial/catalog', { signal: controller.signal });
      if (!response.ok) throw new Error(await readErrorMessage(response));
      const catalog = await response.json() as TrialCatalog;
      if (controller.signal.aborted || disposed) return;
      if (catalog.schema_version !== 1 || !Array.isArray(catalog.strategies)) {
        throw new Error('The case catalog uses an unsupported format.');
      }
      strategies = catalog.strategies.filter(strategy => knownCases.includes(strategy.id));
      if (!strategies.length) {
        statusMessage = 'No educational cases are available yet.';
        return;
      }
      const shared = initialSharedConfig;
      if (shared && strategies.some(strategy => strategy.id === shared.strategy_id)) {
        selectedId = shared.strategy_id;
        commission = shared.commission_bps;
        slippage = shared.slippage_bps;
      } else {
        selectedId = strategies[0].id;
      }
      await runTrial();
    } catch (error) {
      if (controller.signal.aborted || disposed) return;
      catalogError = error instanceof Error ? error.message : 'The case catalog could not be loaded.';
      statusMessage = 'The case files could not be opened.';
    } finally {
      if (catalogController === controller && !disposed) catalogLoading = false;
    }
  }

  async function runTrial(): Promise<void> {
    if (!validCost(commission) || !validCost(slippage) || !selectedStrategy) {
      runError = 'Choose a case and enter finite costs between 0 and 50 bps.';
      return;
    }
    cancelRun();
    const sequence = runSequence;
    const controller = new AbortController();
    runController = controller;
    const config: TrialConfig = {
      strategy_id: selectedId,
      commission_bps: commission,
      slippage_bps: slippage,
    };
    running = true;
    runError = '';
    statusMessage = `Cross-examining ${selectedStrategy.name}…`;
    try {
      const response = await apiFetch('/trial/run', {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify(config),
      });
      if (!response.ok) throw new Error(await readErrorMessage(response));
      const result = await response.json() as TrialReport;
      if (controller.signal.aborted || disposed || sequence !== runSequence) return;
      if (result.schema_version !== 1 || result.dataset?.synthetic !== true ||
        result.config.strategy_id !== config.strategy_id ||
        result.config.commission_bps !== config.commission_bps ||
        result.config.slippage_bps !== config.slippage_bps) {
        throw new Error('The report did not match this synthetic trial configuration.');
      }
      report = result;
      statusMessage = `Evidence ready for ${result.strategy.name}.`;
    } catch (error) {
      if (controller.signal.aborted || disposed || sequence !== runSequence) return;
      runError = error instanceof Error ? error.message : 'This run could not be completed.';
      statusMessage = 'The examination did not finish. You can retry.';
    } finally {
      if (sequence === runSequence && !disposed) {
        running = false;
        runController = null;
      }
    }
  }

  onMount(() => {
    initialSharedConfig = readTrialShareConfig(window.location.search);
    void loadCatalog();
    return () => {
      disposed = true;
      catalogController?.abort();
      cancelRun();
    };
  });
</script>

<div class="trial-shell">
  <a class="skip-link" href="#trial-evidence">Skip to evidence</a>
  <header class="masthead">
    <a class="wordmark" href="/?trial=1" aria-label="OpenQuant Strategy on Trial"><span class="brand-mark" aria-hidden="true">OQ</span>OpenQuant<span class="wordmark-divider" aria-hidden="true">/</span><span class="edition">Strategy on Trial</span></a>
    <a class="workspace-link" href={workspaceHref}>Open research workspace <span aria-hidden="true">↗</span></a>
  </header>

  <main>
    <section class="intro" aria-labelledby="trial-heading">
      <div class="intro-copy">
        <p class="eyebrow"><span class="signal-dot" aria-hidden="true"></span> The court of inconvenient evidence</p>
        <h1 id="trial-heading">Your backtest looks brilliant.<br /><em>Let's try to break it.</em></h1>
        <p class="lede">Put a strategy on the stand. Add trading costs, check the unseen chapter, and ask whether the simple benchmark had a point.</p>
        <div class="intro-tags"><span>Measured, not promised</span><span>Three cases. No account needed.</span></div>
      </div>
      <aside class="case-file" aria-label="Trial ground rules">
        <span class="file-tab">Open case file / 001</span>
        <div class="file-heading"><span class="eyebrow">Evidence standard</span><span class="synthetic-stamp">SYNTHETIC<br />EDUCATIONAL DATA</span></div>
        <h2>The market here<br />is made up.<br /><em>The math isn't.</em></h2>
        <p>Locally generated OHLCV scenarios. Real engine calculations. No provider keys or real market history.</p>
        <div class="file-footer"><span>Starting account</span><strong>$10,000</strong></div>
      </aside>
    </section>

    <section class="case-section" aria-labelledby="cases-heading">
      <div class="section-heading"><h2 id="cases-heading"><span class="section-number">01</span> Choose your defendant</h2><span class="subheading">Select a case, then cross-examine.</span></div>
      {#if catalogError}
        <div class="notice error" role="alert"><div><strong>Couldn't open the case files.</strong><p>{catalogError}</p></div><button class="secondary-button" onclick={() => loadCatalog()}>Retry catalog</button></div>
      {:else if catalogLoading && !strategies.length}
        <div class="catalog-placeholder" aria-busy="true"><span class="spinner" aria-hidden="true"></span>Loading the educational case catalog…</div>
      {:else if !strategies.length}
        <div class="notice"><div><strong>No cases on the docket.</strong><p>The server has no supported synthetic scenarios available.</p></div><button class="secondary-button" onclick={() => loadCatalog()}>Check again</button></div>
      {:else}
        <div class="cases" role="group" aria-label="Strategy cases">
          {#each strategies as strategy, index (strategy.id)}
            <button class="case-card" class:selected={selectedId === strategy.id} aria-pressed={selectedId === strategy.id} onclick={() => chooseCase(strategy.id)}>
              <span class="card-top"><span>Case {String(index + 1).padStart(2, '0')}</span><span class="selection-mark" aria-hidden="true">{selectedId === strategy.id ? '●' : '○'}</span></span>
              <strong>{strategy.name}</strong>
              <span class="case-note">{caseNotes[strategy.id]}</span>
              <span class="case-description">{strategy.description}</span>
              <span class="card-bottom">{selectedId === strategy.id ? 'Selected for examination' : 'Put this case on the stand'}<span aria-hidden="true">↗</span></span>
            </button>
          {/each}
        </div>
        <form class="controls" onsubmit={event => { event.preventDefault(); void runTrial(); }}>
          <div class="controls-caption"><span class="eyebrow">Introduce some friction</span><p>1 bp = 0.01%. Costs apply per fill.</p></div>
          <div class="cost-field"><label for="trial-commission">Commission <span>bps</span></label><input id="trial-commission" type="number" min="0" max="50" step="any" required bind:value={commission} aria-describedby="trial-cost-help" /></div>
          <div class="cost-field"><label for="trial-slippage">Slippage <span>bps</span></label><input id="trial-slippage" type="number" min="0" max="50" step="any" required bind:value={slippage} aria-describedby="trial-cost-help" /></div>
          <button class="examine-button" type="submit" disabled={!costsValid || running}><span>{running ? 'Examining…' : 'Cross-examine'}</span><span aria-hidden="true">{running ? '…' : '→'}</span></button>
          <p id="trial-cost-help" class="cost-help">0–50 bps each. Changes run only when you cross-examine.{#if !costsValid} <strong>Enter a finite value within this range for both costs.</strong>{/if}</p>
        </form>
      {/if}
      <p class="live-status" role="status" aria-live="polite">{#if running}<span class="spinner" aria-hidden="true"></span>{/if}{statusMessage}{#if running}<button class="cancel-button" onclick={() => { cancelRun(); statusMessage = 'Examination cancelled. Cross-examine when ready.'; }}>Cancel</button>{/if}</p>
    </section>

    <section id="trial-evidence" class="evidence-section" aria-labelledby="evidence-heading" aria-busy={running}>
      <div class="section-heading"><h2 id="evidence-heading"><span class="section-number">02</span> Follow the evidence</h2><span class="subheading">No score. No seal of approval.</span></div>
      {#if runError}
        <div class="notice error" role="alert"><div><strong>The examination didn't finish.</strong><p>{runError}</p>{#if report}<p>Last completed evidence remains below.</p>{/if}</div><button class="secondary-button" disabled={!costsValid || running} onclick={() => runTrial()}>Retry run</button></div>
      {/if}
      {#if report}
        {#if inputsChanged || running}
          <div class="notice pending"><p>{running ? 'A new examination is running. This is the last completed report.' : 'Inputs changed. Cross-examine to measure the new setup.'} Evidence below belongs to <strong>{report.strategy.name}</strong> at {report.config.commission_bps} bps commission + {report.config.slippage_bps} bps slippage.</p></div>
        {/if}
        <div class="report-heading"><div><p class="eyebrow">Engine report / Synthetic scenario</p><h3>{report.strategy.name}</h3><p>{report.strategy.lesson}</p></div><span class="report-label">Evidence, not endorsement</span></div>
        <div class="headline-metrics">
          <article><span>Full-period return · with costs</span><strong>{formatPercent(report.realistic.total_return, true)}</strong><small>Frictionless: {formatPercent(report.baseline.total_return, true)}</small></article>
          <article><span>Maximum drawdown · with costs</span><strong>{formatPercent(report.realistic.max_drawdown)}</strong><small>Largest measured peak-to-trough decline</small></article>
          <article><span>Costs paid · full period</span><strong>{formatMoney(report.realistic.total_cost)}</strong><small>{report.realistic.trade_count.toLocaleString('en-US')} completed round trips recorded by the engine</small></article>
        </div>
        <EquityEvidence {report} />
        <div class="full-metrics"><RunMetrics caption="Full-period results · same synthetic dataset · $10,000 starting cash per account" runs={[
          { label: 'Frictionless strategy', summary: report.baseline },
          { label: 'Strategy + costs', summary: report.realistic },
          { label: 'Buy & hold + costs', summary: report.benchmark },
        ]} /></div>

        <div class="report-grid">
          <section class="evidence-panel" aria-labelledby="holdout-heading">
            <p class="eyebrow">Exhibit B / The unseen chapter</p><h3 id="holdout-heading">How did the holdout go?</h3>
            <p>Training stops before {formatDate(report.dataset.split_date)}. Both holdout accounts start separately with $10,000 on the exact same test segment, at the chosen costs.</p>
            <RunMetrics caption="Separate holdout results · strategy versus buy & hold" runs={[
              { label: 'Strategy + costs', summary: report.holdout.strategy },
              { label: 'Buy & hold + costs', summary: report.holdout.benchmark },
            ]} />
          </section>
          <section class="evidence-panel" aria-labelledby="sensitivity-heading">
            <p class="eyebrow">Exhibit C / A gentle nudge</p><h3 id="sensitivity-heading">Does the parameter matter?</h3>
            {#if report.selected_parameter}
              <p>{report.strategy.id === 'overcaffeinated-trader' ? 'Fixed, not optimized:' : 'Selected on training only:'} <strong class="inline-number">{report.selected_parameter.name} = {report.selected_parameter.value}</strong>. Fixed neighboring values below are measured on holdout at the chosen costs.</p>
            {:else}
              <p>This case has no selected tuning parameter.</p>
            {/if}
            {#if report.sensitivity.length}
              <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard access to horizontal scrolling.) -->
              <div class="table-scroll" tabindex="0" role="region" aria-label="Holdout parameter sensitivity"><table class="sensitivity-table"><caption>Holdout sensitivity · no parameter selection on these results</caption><thead><tr><th scope="col">Parameter</th><th scope="col">Return</th><th scope="col">Drawdown</th></tr></thead><tbody>{#each report.sensitivity as row}<tr><th scope="row">{row.parameter_value}</th><td>{formatPercent(row.total_return, true)}</td><td>{formatPercent(row.max_drawdown)}</td></tr>{/each}</tbody></table></div>
            {:else}
              <div class="not-applicable">No parameter sweep applies to this case. The benchmark still gets its say.</div>
            {/if}
          </section>
        </div>

        <section class="findings-section" aria-labelledby="findings-heading"><div class="section-heading"><h3 id="findings-heading">What the record shows</h3><span class="subheading">Measured findings from this run</span></div>
          {#if report.findings.length}
            <div class="findings">{#each report.findings as finding (finding.id)}<article class="finding" class:warning={finding.severity === 'warning'}><span class="finding-label">{finding.severity === 'warning' ? 'Worth questioning' : 'On the record'}</span><h4>{finding.title}</h4><p>{finding.detail}</p></article>{/each}</div>
          {:else}<p class="not-applicable">The engine supplied no findings for this run. The measured results remain above.</p>{/if}
        </section>

        <section class="provenance" aria-labelledby="provenance-heading"><div><p class="eyebrow">Chain of custody</p><h3 id="provenance-heading">Know what you're looking at.</h3><p class="synthetic-disclosure">Developer-designed synthetic scenarios are educational. They are not independent evidence of market alpha or future investment performance.</p></div><dl><div><dt>Scenario</dt><dd>{report.dataset.label} <span class="version">v{report.dataset.version}</span></dd></div><div><dt>Dates (UTC)</dt><dd>{formatDate(report.dataset.start)} — {formatDate(report.dataset.end)}</dd></div><div><dt>Chronological split</dt><dd>{report.dataset.training_bars.toLocaleString('en-US')} training / {report.dataset.holdout_bars.toLocaleString('en-US')} holdout bars</dd></div><div><dt>Measured cost setup</dt><dd>{report.config.commission_bps} bps commission / {report.config.slippage_bps} bps slippage</dd></div><div><dt>Report identifier</dt><dd class="report-id">{report.report_id}</dd></div></dl></section>
        <div class="disclosures"><details open><summary>Assumptions <span>{report.assumptions.length}</span></summary>{#if report.assumptions.length}<ul>{#each report.assumptions as assumption}<li>{assumption}</li>{/each}</ul>{:else}<p>No additional assumptions were supplied.</p>{/if}</details><details open><summary>Limitations <span>{report.limitations.length}</span></summary>{#if report.limitations.length}<ul>{#each report.limitations as limitation}<li>{limitation}</li>{/each}</ul>{:else}<p>No additional limitations were supplied.</p>{/if}</details></div>
        <div class="report-actions"><div><h3>Take the evidence with you.</h3><p>A shared link reruns this configuration. It is not a permanent hosted report.</p></div><ReportActions {report} /></div>
      {:else if running}
        <div class="evidence-empty"><span class="eyebrow">Engine at work</span><h3>Calling the numbers to the stand.</h3><p>Measuring costs, benchmark, holdout and sensitivity on the local synthetic scenario.</p><div class="loading-track" aria-hidden="true"></div></div>
      {:else if !runError}
        <div class="evidence-empty"><span class="eyebrow">The record is empty</span><h3>One strategy. A few fair questions.</h3><p>Choose an available case and cross-examine to see measured evidence here.</p></div>
      {/if}
    </section>
    <footer><span>OpenQuant / Strategy on Trial</span><p>Educational research. No live trading. No investment promises.</p><a href={workspaceHref}>Keep researching <span aria-hidden="true">↗</span></a></footer>
  </main>
</div>

<style>
  .trial-shell { --paper: #f0ede5; --muted: #b0b7ad; --line: #343b33; --warm: #efad78; min-height: 100dvh; width: 100%; color: var(--paper); background: radial-gradient(ellipse at 80% 3%, #34362a55, transparent 38%), #101511; font-family: 'Lato', 'Segoe UI', sans-serif; font-size: 16px; line-height: 1.5; color-scheme: dark; }
  .trial-shell :global(*) { box-sizing: border-box; }
  .trial-shell :global(button), .trial-shell :global(input) { font: inherit; }
  .trial-shell :global(button) { cursor: pointer; }
  .trial-shell :global(button:disabled) { cursor: not-allowed; opacity: 0.55; }
  .trial-shell :global(a:focus-visible), .trial-shell :global(button:focus-visible), .trial-shell :global(input:focus-visible), .trial-shell :global(summary:focus-visible) { outline: 2px solid var(--warm); outline-offset: 5px; }
  a { color: inherit; text-decoration: none; }
  .skip-link { position: absolute; left: 1rem; top: -5rem; z-index: 10; padding: 0.7rem 1rem; background: var(--warm); color: #151a14; }
  .skip-link:focus { top: 1rem; }
  .masthead { max-width: 1440px; margin: auto; padding: 1.6rem clamp(1rem, 5vw, 5rem); border-bottom: 1px solid var(--line); display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
  .wordmark { display: flex; align-items: center; gap: 0.75rem; font-size: 1rem; font-weight: 700; }
  .brand-mark { border: 1px solid #6a7463; width: 2.2rem; height: 2.2rem; display: grid; place-items: center; font: 0.72rem 'Space Mono', monospace; color: #cad0bc; }
  .wordmark-divider { color: #67715f; font-weight: normal; }
  .edition { color: var(--muted); font-size: 0.8rem; font-weight: normal; }
  .workspace-link { color: #e4c09e; font-size: 0.8rem; white-space: nowrap; }
  .workspace-link:hover, footer a:hover { text-decoration: underline; text-underline-offset: 4px; }
  main { max-width: 1440px; margin: auto; padding: 0 clamp(1rem, 5vw, 5rem); }
  .intro { display: grid; grid-template-columns: 1.6fr 1fr; gap: clamp(2rem, 6vw, 6rem); align-items: center; padding: 5rem 0 4rem; }
  .eyebrow { margin: 0; color: #c8ad8d; font: 0.67rem 'Space Mono', monospace; letter-spacing: 0.09em; text-transform: uppercase; }
  .intro .eyebrow { display: flex; align-items: center; gap: 0.75rem; }
  .signal-dot { background: #d8b389; width: 6px; height: 6px; border-radius: 50%; }
  h1 { margin: 1.5rem 0; font: normal clamp(2.6rem, 4.5vw, 4.7rem)/1.1 Georgia, 'Times New Roman', serif; letter-spacing: -0.045em; }
  h1 em { color: var(--warm); font-weight: normal; }
  .lede { max-width: 33rem; color: #bdc4b8; font-size: 1rem; line-height: 1.75; margin: 0 0 1.75rem; }
  .intro-tags { display: flex; flex-wrap: wrap; gap: 0.7rem; color: #bec7b4; font-size: 0.7rem; }
  .intro-tags span { padding: 0.45rem 0.7rem; border: 1px solid #3b4435; border-radius: 2px; }
  .case-file { position: relative; background: #1c221a; border: 1px solid #48513f; border-top: 3px solid #777858; padding: 2rem; box-shadow: 10px 10px 0 #090d0980; transform: rotate(1deg); }
  .file-tab { position: absolute; top: -1.6rem; left: -1px; background: #2a3124; border: 1px solid #48513f; border-bottom: none; padding: 0.3rem 1rem; font: 0.6rem 'Space Mono', monospace; text-transform: uppercase; letter-spacing: 0.08em; color: #c5cdb8; }
  .file-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; }
  .synthetic-stamp { font: 0.55rem/1.6 'Space Mono', monospace; padding: 0.35rem 0.5rem; border: 1px solid #d3aa75; color: #e3b883; text-align: center; transform: rotate(-6deg); }
  .case-file h2 { margin: 1.75rem 0 1rem; font: normal clamp(1.7rem, 2.8vw, 2.5rem)/1.18 Georgia, serif; letter-spacing: -0.02em; }
  .case-file h2 em { color: #c8d1b6; }
  .case-file p { color: #b9c1ae; font-size: 0.8rem; line-height: 1.7; }
  .file-footer { display: flex; justify-content: space-between; align-items: center; padding-top: 1rem; margin-top: 1.5rem; border-top: 1px dashed #4a5340; color: #b9c1ae; font-size: 0.7rem; }
  .file-footer strong { color: #d9decf; font: 1.2rem 'Space Mono', monospace; }
  .case-section { padding-bottom: 2.5rem; border-bottom: 1px solid var(--line); }
  .section-heading { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-bottom: 1.3rem; }
  .section-heading h2, .section-heading h3 { font: normal 1.35rem Georgia, serif; margin: 0; }
  .section-number { font: 0.7rem 'Space Mono', monospace; color: #a3a891; margin-right: 0.75rem; }
  .subheading { color: #aab4a3; font-size: 0.75rem; }
  .cases { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; }
  .case-card { background: #171d17; border: 1px solid #3c4437; color: var(--paper); text-align: left; padding: 1.3rem; border-radius: 3px; display: flex; flex-direction: column; gap: 0.65rem; transition: border-color 150ms, background 150ms; }
  .case-card:hover { border-color: #939b7a; background: #1b221a; }
  .case-card.selected { border-color: #d9aa7a; background: #24281d; box-shadow: inset 0 3px #d9aa7a; }
  .card-top { display: flex; align-items: center; justify-content: space-between; color: #b5bea9; font: 0.62rem 'Space Mono', monospace; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 0.65rem; }
  .selection-mark { color: #d7b489; font-size: 0.9rem; }
  .case-card > strong { font: normal 1.5rem Georgia, serif; letter-spacing: -0.025em; }
  .case-note { font-size: 0.85rem; color: #d1bb9e; }
  .case-description { font-size: 0.78rem; line-height: 1.65; color: #b5bea9; padding-bottom: 0.8rem; }
  .card-bottom { border-top: 1px solid #3c4435; padding-top: 0.8rem; margin-top: auto; display: flex; justify-content: space-between; color: #bac4ae; font-size: 0.65rem; }
  .selected .card-bottom { color: #e9bd90; }
  .controls { display: grid; grid-template-columns: 1fr 10rem 10rem minmax(11rem, 0.8fr); align-items: center; gap: 1rem; margin-top: 1.5rem; border: 1px solid var(--line); padding: 1.25rem; background: #131a14; border-radius: 3px; }
  .controls-caption p { font-size: 0.7rem; color: var(--muted); margin: 0.5rem 0 0; }
  .cost-field label { display: flex; justify-content: space-between; font-size: 0.75rem; color: #c5cebb; margin-bottom: 0.4rem; }
  .cost-field label span { font: 0.65rem 'Space Mono', monospace; color: #a7b19d; }
  input { width: 100%; background: #0e140f; border: 1px solid #59614c; border-radius: 2px; padding: 0.7rem; color: var(--paper); min-height: 44px; font-variant-numeric: tabular-nums; }
  .examine-button { display: flex; align-items: center; justify-content: space-between; background: #e4b285; color: #20241a; border: 1px solid #e4b285; border-radius: 2px; min-height: 46px; padding: 0.75rem 1rem; align-self: end; font-weight: 700 !important; }
  .examine-button:hover:not(:disabled) { background: #f0c298; }
  .cost-help { grid-column: 1/-1; font-size: 0.7rem; margin: 0; color: #aeb7a2; }
  .cost-help strong { color: #f0b59c; font-weight: normal; }
  .live-status { display: flex; align-items: center; flex-wrap: wrap; gap: 0.6rem; min-height: 1.3rem; color: #bac5b0; font-size: 0.75rem; margin: 1rem 0 0; }
  .spinner { display: inline-block; width: 0.75rem; height: 0.75rem; border: 1px solid #64715a; border-top-color: #e4b285; border-radius: 50%; animation: spin 1s linear infinite; }
  .cancel-button { background: none; border: none; padding: 0.4rem 0.5rem; color: #dfbc96; text-decoration: underline; text-underline-offset: 3px; }
  .catalog-placeholder { display: flex; align-items: center; justify-content: center; gap: 0.7rem; min-height: 12rem; border: 1px dashed var(--line); font-size: 0.8rem; color: var(--muted); }
  .notice { border: 1px solid #6b7053; border-left: 3px solid #bdac76; background: #24291b; color: #d4d8c3; border-radius: 2px; display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 1rem 1.2rem; margin-bottom: 1.2rem; font-size: 0.8rem; }
  .notice p { margin: 0.25rem 0 0; line-height: 1.6; overflow-wrap: anywhere; }
  .notice.pending p { margin: 0; }
  .notice.error { background: #30221d; border-color: #9d6c57; color: #f0c1a7; }
  .secondary-button { background: transparent; border: 1px solid currentColor; color: inherit; padding: 0.6rem 0.9rem; min-height: 44px; border-radius: 2px; white-space: nowrap; }
  .evidence-section { padding: 2.5rem 0 3rem; scroll-margin-top: 1rem; }
  .report-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 2rem; margin: 2rem 0 1.5rem; }
  .report-heading h3 { font: normal 2rem Georgia, serif; margin: 0.55rem 0; }
  .report-heading p:not(.eyebrow) { color: var(--muted); font-size: 0.85rem; max-width: 42rem; margin: 0; }
  .report-label { font: 0.6rem 'Space Mono', monospace; color: #bdc9ae; border: 1px solid #59664c; padding: 0.5rem 0.7rem; text-transform: uppercase; white-space: nowrap; margin-top: 0.3rem; }
  .headline-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px; background: var(--line); border: 1px solid var(--line); margin-bottom: 1.25rem; border-radius: 3px; overflow: hidden; }
  .headline-metrics article { background: #181e17; padding: 1.4rem; display: flex; flex-direction: column; gap: 0.6rem; }
  .headline-metrics span { color: #bbc5b1; font-size: 0.7rem; }
  .headline-metrics strong { color: #eee0cc; font: normal clamp(1.5rem, 2.6vw, 2.25rem) 'Space Mono', monospace; letter-spacing: -0.06em; font-variant-numeric: tabular-nums; }
  .headline-metrics small { color: #a9b39d; font-size: 0.7rem; }
  .full-metrics { margin: 1rem 0 2rem; }
  .report-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.5rem; }
  .evidence-panel { min-width: 0; }
  .evidence-panel h3, .provenance h3, .report-actions h3 { font: normal 1.5rem Georgia, serif; margin: 0.6rem 0; }
  .evidence-panel > p:not(.eyebrow) { color: #b3beaa; font-size: 0.8rem; line-height: 1.7; margin: 0 0 1.1rem; }
  .inline-number { color: #e3d2b6; font: 0.8rem 'Space Mono', monospace; overflow-wrap: anywhere; }
  .table-scroll { overflow-x: auto; border: 1px solid var(--line); border-radius: 3px; }
  .table-scroll:focus-visible { outline: 2px solid var(--warm); outline-offset: 4px; }
  .sensitivity-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; text-align: right; }
  .sensitivity-table caption { text-align: left; padding: 1rem; background: #181e1a; color: #c2c7be; font-size: 0.75rem; }
  .sensitivity-table th, .sensitivity-table td { padding: 1rem; border-top: 1px solid var(--line); white-space: nowrap; }
  .sensitivity-table th { font-weight: normal; color: #b9c4ae; }
  .sensitivity-table th:first-child { text-align: left; }
  .sensitivity-table td, .sensitivity-table tbody th { font: 0.8rem 'Space Mono', monospace; }
  .sensitivity-table thead th { font-size: 0.7rem; }
  .sensitivity-table tbody tr:nth-child(odd) { background: #171c18; }
  .not-applicable { border: 1px dashed #4a533f; border-radius: 3px; color: #b7c0aa; background: #151b14; padding: 1.5rem; font-size: 0.8rem; line-height: 1.7; }
  .findings-section { margin: 2.5rem 0; }
  .findings { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
  .finding { border: 1px solid #414b38; border-left: 3px solid #81976a; padding: 1.25rem; background: #192017; border-radius: 2px; }
  .finding.warning { border-left-color: #d8a174; background: #24251b; }
  .finding-label { color: #b9cba4; font: 0.6rem 'Space Mono', monospace; text-transform: uppercase; letter-spacing: 0.08em; }
  .warning .finding-label { color: #e1b38c; }
  .finding h4 { font-size: 1rem; font-weight: normal; margin: 0.75rem 0 0.5rem; }
  .finding p { color: #b6c0ad; line-height: 1.7; font-size: 0.8rem; margin: 0; }
  .provenance { display: grid; grid-template-columns: 1fr 1.2fr; gap: 3rem; padding: 2rem; background: #1b2118; border: 1px solid var(--line); border-radius: 3px; }
  .synthetic-disclosure { color: #c7cdbd; line-height: 1.8; font-size: 0.85rem; margin: 1rem 0 0; }
  dl { margin: 0; font-size: 0.75rem; }
  dl > div { display: grid; grid-template-columns: 8rem 1fr; gap: 1rem; padding: 0.7rem 0; border-bottom: 1px solid var(--line); }
  dl > div:first-child { padding-top: 0; }
  dl > div:last-child { border-bottom: 0; padding-bottom: 0; }
  dt { color: #aebba1; }
  dd { margin: 0; color: #e0e1d4; }
  .version { color: #b6c2a9; font-family: 'Space Mono', monospace; }
  .report-id { font: 0.65rem 'Space Mono', monospace; overflow-wrap: anywhere; }
  .disclosures { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.5rem; margin: 1.5rem 0; }
  details { border-top: 1px solid var(--line); padding: 1rem 0; }
  summary { cursor: pointer; font-size: 0.85rem; }
  summary span { color: #c0ad8c; font: 0.6rem 'Space Mono', monospace; margin-left: 0.5rem; }
  details ul { margin: 1rem 0 0; padding-left: 1.1rem; color: #aebba1; font-size: 0.8rem; line-height: 1.8; }
  details li + li { margin-top: 0.5rem; }
  details p { color: #aebba1; font-size: 0.8rem; }
  .report-actions { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1.5rem; border-top: 1px solid var(--line); padding-top: 1.5rem; }
  .report-actions p { color: #b7c0aa; font-size: 0.8rem; margin: 0; }
  .evidence-empty { min-height: 20rem; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 2rem; border: 1px dashed #424d39; background: #151b13; }
  .evidence-empty h3 { font: normal 1.7rem Georgia, serif; margin: 1rem 0; }
  .evidence-empty p { max-width: 30rem; color: #aebba1; font-size: 0.85rem; margin: 0; }
  .loading-track { width: 7rem; height: 2px; margin-top: 2rem; background: #3b4731; overflow: hidden; }
  .loading-track::after { content: ''; display: block; width: 35%; height: 100%; background: var(--warm); animation: progress 1.5s ease-in-out infinite alternate; }
  footer { display: flex; flex-wrap: wrap; gap: 1rem; justify-content: space-between; border-top: 1px solid var(--line); padding: 1.5rem 0 2rem; color: #a7b39b; font-size: 0.7rem; }
  footer > span { font-family: 'Space Mono', monospace; font-size: 0.65rem; }
  footer p { margin: 0; }
  footer a { color: #dfb78f; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes progress { to { transform: translateX(190%); } }
  @media (max-width: 1050px) {
    .intro { gap: 2rem; padding-top: 4rem; }
    .controls { grid-template-columns: 1fr 1fr 1fr; }
    .controls-caption { grid-column: 1/-1; }
    .provenance { gap: 1.5rem; grid-template-columns: 1fr; }
  }
  @media (max-width: 760px) {
    .intro { grid-template-columns: 1fr; padding: 3rem 0; gap: 3rem; }
    h1 { font-size: clamp(2.5rem, 8vw, 3.5rem); }
    .case-file { max-width: 36rem; transform: none; padding: 1.5rem; box-shadow: 5px 5px 0 #090d0980; }
    .case-file h2 { font-size: 2rem; }
    .cases { grid-template-columns: 1fr; }
    .case-card { padding: 1.2rem; }
    .card-top { margin-bottom: 0; }
    .card-bottom { margin-top: 0.5rem; }
    .report-grid, .disclosures, .findings { grid-template-columns: 1fr; }
    .report-heading { flex-direction: column; gap: 0.8rem; }
    .headline-metrics article { padding: 1rem; }
    .headline-metrics strong { font-size: 1.35rem; }
    .section-heading { align-items: flex-start; flex-direction: column; gap: 0.5rem; }
  }
  @media (max-width: 520px) {
    .masthead { padding: 1rem; align-items: flex-start; flex-wrap: wrap; }
    .edition { font-size: 0.7rem; }
    .wordmark { gap: 0.5rem; font-size: 0.9rem; }
    .workspace-link { font-size: 0.75rem; }
    .intro .eyebrow { font-size: 0.6rem; }
    .controls { grid-template-columns: 1fr 1fr; padding: 1rem; }
    .examine-button { grid-column: 1/-1; }
    .headline-metrics { grid-template-columns: 1fr; }
    .headline-metrics article { display: grid; grid-template-columns: 1fr auto; align-items: center; }
    .headline-metrics small { grid-column: 1/-1; }
    .notice { align-items: flex-start; flex-direction: column; }
    .provenance { padding: 1.2rem; }
    dl > div { grid-template-columns: 1fr; gap: 0.3rem; }
    .evidence-empty { padding: 1.25rem; }
  }
  @media (prefers-reduced-motion: reduce) {
    .spinner, .loading-track::after { animation: none; }
    .case-card { transition: none; }
  }
</style>

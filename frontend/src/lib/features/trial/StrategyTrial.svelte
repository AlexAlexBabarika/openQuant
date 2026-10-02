<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch, readErrorMessage } from '$lib/core/api';
  import type { TrialCatalog, TrialConfig, TrialReport, TrialStrategy } from '$lib/features/trial-report/types';
  import { readTrialShareConfig } from '$lib/features/trial-report/sharing';
  import ReportActions from '$lib/features/trial-report/ReportActions.svelte';
  import EquityEvidence from './EquityEvidence.svelte';
  import RunMetrics from './RunMetrics.svelte';
  import { formatDate, formatMoney, formatPercent, validCost } from './evidence';
  import ChartCandlestick from '@lucide/svelte/icons/chart-candlestick';

  let { workspaceHref = '/', embedded = false, onreturnworkspace }: {
    workspaceHref?: string;
    embedded?: boolean;
    onreturnworkspace?: () => void;
  } = $props();

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

<div class="trial-shell" class:embedded>
  <a class="skip-link" href="#trial-evidence">Skip to evidence</a>
  {#if !embedded}
  <header class="masthead">
    <a class="wordmark" href="/?trial=1" aria-label="OpenQuant Strategy on Trial"><span>openQuant</span><ChartCandlestick class="h-4 w-4 text-primary" /><span class="wordmark-divider" aria-hidden="true">/</span><span class="edition">Strategy on Trial demo</span></a>
    <a class="workspace-link ot-workbench-ghost" href={workspaceHref}>Research workspace</a>
  </header>
  {/if}

  <main>
    <section class="intro" aria-labelledby="trial-heading">
      <div class="intro-copy">
        <p class="eyebrow">Guided strategy robustness demo</p>
        <h1 id="trial-heading">Strategy on Trial</h1>
        <p class="lede">Learn how fees, parameter tuning and a change in market regime can break an attractive backtest. Choose one of three built-in strategies, adjust costs, then compare the measured results with buy-and-hold and an unseen period.</p>
        <p class="scope">This is an educational demo, not a test of your workspace data or your own strategy code. Use the workspace's Strategy and Backtesting tools for your own research.</p>
      </div>
      <aside class="case-file" aria-label="Trial ground rules">
        <h2>Synthetic data. Real engine.</h2>
        <p>Locally generated educational scenarios, not real market history. No provider keys, submitted code or live orders. These results are not evidence of market alpha.</p>
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
          <button class="examine-button ot-workbench-primary" type="submit" disabled={!costsValid || running}><span>{running ? 'Examining…' : 'Cross-examine'}</span><span aria-hidden="true">{running ? '…' : '→'}</span></button>
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
    <footer><span>openQuant / Strategy on Trial</span><p>Educational research. No live trading. No investment promises.</p>{#if embedded}<button class="workspace-link ot-workbench-ghost" onclick={onreturnworkspace}>Return to research workspace</button>{:else}<a class="workspace-link" href={workspaceHref}>Research workspace</a>{/if}</footer>
  </main>
</div>

<style>
  .trial-shell { --paper: oklch(var(--foreground)); --trial-muted: oklch(var(--muted-foreground)); --line: oklch(var(--border)); --warm: oklch(var(--primary)); min-height: 100dvh; width: 100%; color: var(--paper); background: oklch(var(--background)); font-family: 'Lato', 'Segoe UI', sans-serif; font-size: 14px; line-height: 1.5; }
  .trial-shell.embedded { min-height: 100%; }
  .scope { max-width: 65ch; color: var(--trial-muted); font-size: 0.8rem; line-height: 1.7; margin: 0; }
  .trial-shell :global(*) { box-sizing: border-box; }
  .trial-shell :global(button) { cursor: pointer; }
  .trial-shell :global(button:disabled) { cursor: not-allowed; opacity: 0.55; }
  .trial-shell :global(a:focus-visible), .trial-shell :global(button:focus-visible), .trial-shell :global(input:focus-visible), .trial-shell :global(summary:focus-visible) { outline: 2px solid var(--warm); outline-offset: 5px; }
  a { color: inherit; text-decoration: none; }
  .skip-link { position: absolute; left: 1rem; top: -5rem; z-index: 10; padding: 0.7rem 1rem; background: var(--warm); color: oklch(var(--primary-foreground)); }
  .skip-link:focus { top: 1rem; }
  .masthead { padding: 0.65rem 1rem; border-bottom: 1px solid var(--line); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem; }
  .wordmark { display: flex; align-items: center; gap: 0.5rem; font: 600 0.875rem var(--font-mono); }
  .wordmark-divider { color: var(--line); font-weight: normal; }
  .edition { color: var(--trial-muted); font-size: 0.8rem; font-weight: normal; }
  .workspace-link { color: oklch(var(--foreground)); font-size: 0.8rem; white-space: nowrap; }
  .workspace-link:hover, footer a:hover { text-decoration: underline; text-underline-offset: 4px; }
  main { max-width: 1200px; margin: auto; padding: 0 clamp(1rem, 3vw, 2rem); }
  .intro { display: grid; grid-template-columns: 1.6fr 1fr; gap: 2rem; align-items: start; padding: 2rem 0; }
  .eyebrow { margin: 0; color: var(--trial-muted); font: 0.67rem var(--font-mono); letter-spacing: 0.09em; text-transform: uppercase; }
  .intro .eyebrow { display: flex; align-items: center; gap: 0.75rem; }
  h1 { margin: 0.5rem 0 1rem; font-size: 1.75rem; font-weight: 700; line-height: 1.2; letter-spacing: -0.025em; }
  .lede { max-width: 65ch; color: var(--paper); font-size: 0.9rem; line-height: 1.7; margin: 0 0 0.75rem; }
  .case-file { background: oklch(var(--card)); border: 1px solid var(--line); padding: 1.25rem; border-radius: var(--radius-md); }
  .case-file h2 { margin: 0 0 0.75rem; font-size: 1rem; font-weight: 700; }
  .case-file p { color: var(--trial-muted); font-size: 0.8rem; line-height: 1.7; }
  .file-footer { display: flex; justify-content: space-between; align-items: center; padding-top: 1rem; margin-top: 1.5rem; border-top: 1px dashed var(--line); color: var(--trial-muted); font-size: 0.7rem; }
  .file-footer strong { color: oklch(var(--foreground)); font: 1.2rem var(--font-mono); }
  .case-section { padding-bottom: 2.5rem; border-bottom: 1px solid var(--line); }
  .section-heading { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-bottom: 1.3rem; }
  .section-heading h2, .section-heading h3 { font: normal 1.35rem 'Lato', system-ui, sans-serif; margin: 0; }
  .section-number { font: 0.7rem var(--font-mono); color: var(--trial-muted); margin-right: 0.75rem; }
  .subheading { color: var(--trial-muted); font-size: 0.75rem; }
  .cases { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; }
  .case-card { background: oklch(var(--card)); border: 1px solid var(--line); color: var(--paper); text-align: left; padding: 1.3rem; border-radius: 3px; display: flex; flex-direction: column; gap: 0.65rem; transition: border-color 150ms, background 150ms; }
  .case-card:hover { border-color: var(--trial-muted); background: oklch(var(--muted)); }
  .case-card.selected { border-color: oklch(var(--primary)); background: color-mix(in oklab, oklch(var(--primary)) 8%, oklch(var(--background))); box-shadow: inset 0 3px oklch(var(--primary)); }
  .card-top { display: flex; align-items: center; justify-content: space-between; color: var(--trial-muted); font: 0.62rem var(--font-mono); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 0.65rem; }
  .selection-mark { color: oklch(var(--primary)); font-size: 0.9rem; }
  .case-card > strong { font: normal 1.5rem 'Lato', system-ui, sans-serif; letter-spacing: -0.025em; }
  .case-note { font-size: 0.85rem; color: var(--trial-muted); }
  .case-description { font-size: 0.78rem; line-height: 1.65; color: var(--trial-muted); padding-bottom: 0.8rem; }
  .card-bottom { border-top: 1px solid var(--line); padding-top: 0.8rem; margin-top: auto; display: flex; justify-content: space-between; color: var(--trial-muted); font-size: 0.65rem; }
  .selected .card-bottom { color: oklch(var(--primary)); }
  .controls { display: grid; grid-template-columns: 1fr 10rem 10rem minmax(11rem, 0.8fr); align-items: center; gap: 1rem; margin-top: 1.5rem; border: 1px solid var(--line); padding: 1.25rem; background: oklch(var(--card)); border-radius: 3px; }
  .controls-caption p { font-size: 0.7rem; color: var(--trial-muted); margin: 0.5rem 0 0; }
  .cost-field label { display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--trial-muted); margin-bottom: 0.4rem; }
  .cost-field label span { font: 0.65rem var(--font-mono); color: var(--trial-muted); }
  input { width: 100%; background: oklch(var(--background)); border: 1px solid oklch(var(--input)); border-radius: 2px; padding: 0.7rem; color: var(--paper); min-height: 44px; font-variant-numeric: tabular-nums; }
  .examine-button { display: flex; align-items: center; justify-content: space-between; height: auto; min-height: 46px; padding: 0.75rem 1rem; align-self: end; }
  .examine-button:hover:not(:disabled) { background: color-mix(in oklab, oklch(var(--primary)) 85%, oklch(var(--foreground))); }
  .cost-help { grid-column: 1/-1; font-size: 0.7rem; margin: 0; color: var(--trial-muted); }
  .cost-help strong { color: oklch(var(--destructive)); font-weight: normal; }
  .live-status { display: flex; align-items: center; flex-wrap: wrap; gap: 0.6rem; min-height: 1.3rem; color: var(--trial-muted); font-size: 0.75rem; margin: 1rem 0 0; }
  .spinner { display: inline-block; width: 0.75rem; height: 0.75rem; border: 1px solid var(--line); border-top-color: oklch(var(--primary)); border-radius: 50%; animation: spin 1s linear infinite; }
  .cancel-button { background: none; border: none; padding: 0.4rem 0.5rem; color: var(--trial-muted); text-decoration: underline; text-underline-offset: 3px; }
  .catalog-placeholder { display: flex; align-items: center; justify-content: center; gap: 0.7rem; min-height: 12rem; border: 1px dashed var(--line); font-size: 0.8rem; color: var(--trial-muted); }
  .notice { border: 1px solid var(--line); border-left: 3px solid var(--trial-muted); background: oklch(var(--muted)); color: var(--trial-muted); border-radius: 2px; display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 1rem 1.2rem; margin-bottom: 1.2rem; font-size: 0.8rem; }
  .notice p { margin: 0.25rem 0 0; line-height: 1.6; overflow-wrap: anywhere; }
  .notice.pending p { margin: 0; }
  .notice.error { background: color-mix(in oklab, oklch(var(--destructive)) 8%, oklch(var(--background))); border-color: oklch(var(--destructive)); color: oklch(var(--foreground)); }
  .secondary-button { background: transparent; border: 1px solid currentColor; color: inherit; padding: 0.6rem 0.9rem; min-height: 44px; border-radius: 2px; white-space: nowrap; }
  .evidence-section { padding: 2.5rem 0 3rem; scroll-margin-top: 1rem; }
  .report-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 2rem; margin: 2rem 0 1.5rem; }
  .report-heading h3 { font: normal 2rem 'Lato', system-ui, sans-serif; margin: 0.55rem 0; }
  .report-heading p:not(.eyebrow) { color: var(--trial-muted); font-size: 0.85rem; max-width: 42rem; margin: 0; }
  .report-label { font: 0.6rem var(--font-mono); color: var(--trial-muted); border: 1px solid var(--line); padding: 0.5rem 0.7rem; text-transform: uppercase; white-space: nowrap; margin-top: 0.3rem; }
  .headline-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px; background: var(--line); border: 1px solid var(--line); margin-bottom: 1.25rem; border-radius: 3px; overflow: hidden; }
  .headline-metrics article { background: oklch(var(--card)); padding: 1.4rem; display: flex; flex-direction: column; gap: 0.6rem; }
  .headline-metrics span { color: var(--trial-muted); font-size: 0.7rem; }
  .headline-metrics strong { color: oklch(var(--foreground)); font: normal clamp(1.5rem, 2.6vw, 2.25rem) var(--font-mono); letter-spacing: -0.06em; font-variant-numeric: tabular-nums; }
  .headline-metrics small { color: var(--trial-muted); font-size: 0.7rem; }
  .full-metrics { margin: 1rem 0 2rem; }
  .report-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.5rem; }
  .evidence-panel { min-width: 0; }
  .evidence-panel h3, .provenance h3, .report-actions h3 { font: normal 1.5rem 'Lato', system-ui, sans-serif; margin: 0.6rem 0; }
  .evidence-panel > p:not(.eyebrow) { color: var(--trial-muted); font-size: 0.8rem; line-height: 1.7; margin: 0 0 1.1rem; }
  .inline-number { color: oklch(var(--foreground)); font: 0.8rem var(--font-mono); overflow-wrap: anywhere; }
  .table-scroll { overflow-x: auto; border: 1px solid var(--line); border-radius: 3px; }
  .table-scroll:focus-visible { outline: 2px solid var(--warm); outline-offset: 4px; }
  .sensitivity-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; text-align: right; }
  .sensitivity-table caption { text-align: left; padding: 1rem; background: var(--line); color: var(--trial-muted); font-size: 0.75rem; }
  .sensitivity-table th, .sensitivity-table td { padding: 1rem; border-top: 1px solid var(--line); white-space: nowrap; }
  .sensitivity-table th { font-weight: normal; color: var(--trial-muted); }
  .sensitivity-table th:first-child { text-align: left; }
  .sensitivity-table td, .sensitivity-table tbody th { font: 0.8rem var(--font-mono); }
  .sensitivity-table thead th { font-size: 0.7rem; }
  .sensitivity-table tbody tr:nth-child(odd) { background: var(--line); }
  .not-applicable { border: 1px dashed var(--line); border-radius: 3px; color: var(--trial-muted); background: var(--line); padding: 1.5rem; font-size: 0.8rem; line-height: 1.7; }
  .findings-section { margin: 2.5rem 0; }
  .findings { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
  .finding { border: 1px solid var(--line); border-left: 3px solid var(--trial-muted); padding: 1.25rem; background: var(--line); border-radius: 2px; }
  .finding.warning { border-left-color: var(--trial-muted); background: var(--line); }
  .finding-label { color: var(--trial-muted); font: 0.6rem var(--font-mono); text-transform: uppercase; letter-spacing: 0.08em; }
  .warning .finding-label { color: var(--trial-muted); }
  .finding h4 { font-size: 1rem; font-weight: normal; margin: 0.75rem 0 0.5rem; }
  .finding p { color: var(--trial-muted); line-height: 1.7; font-size: 0.8rem; margin: 0; }
  .provenance { display: grid; grid-template-columns: 1fr 1.2fr; gap: 3rem; padding: 2rem; background: oklch(var(--card)); border: 1px solid var(--line); border-radius: 3px; }
  .synthetic-disclosure { color: var(--trial-muted); line-height: 1.8; font-size: 0.85rem; margin: 1rem 0 0; }
  dl { margin: 0; font-size: 0.75rem; }
  dl > div { display: grid; grid-template-columns: 8rem 1fr; gap: 1rem; padding: 0.7rem 0; border-bottom: 1px solid var(--line); }
  dl > div:first-child { padding-top: 0; }
  dl > div:last-child { border-bottom: 0; padding-bottom: 0; }
  dt { color: var(--trial-muted); }
  dd { margin: 0; color: oklch(var(--foreground)); }
  .version { color: var(--trial-muted); font-family: var(--font-mono); }
  .report-id { font: 0.65rem var(--font-mono); overflow-wrap: anywhere; }
  .disclosures { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.5rem; margin: 1.5rem 0; }
  details { border-top: 1px solid var(--line); padding: 1rem 0; }
  summary { cursor: pointer; font-size: 0.85rem; }
  summary span { color: var(--trial-muted); font: 0.6rem var(--font-mono); margin-left: 0.5rem; }
  details ul { margin: 1rem 0 0; padding-left: 1.1rem; color: var(--trial-muted); font-size: 0.8rem; line-height: 1.8; }
  details li + li { margin-top: 0.5rem; }
  details p { color: var(--trial-muted); font-size: 0.8rem; }
  .report-actions { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1.5rem; border-top: 1px solid var(--line); padding-top: 1.5rem; }
  .report-actions p { color: var(--trial-muted); font-size: 0.8rem; margin: 0; }
  .evidence-empty { min-height: 20rem; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 2rem; border: 1px dashed var(--line); background: oklch(var(--card)); }
  .evidence-empty h3 { font: normal 1.7rem 'Lato', system-ui, sans-serif; margin: 1rem 0; }
  .evidence-empty p { max-width: 30rem; color: var(--trial-muted); font-size: 0.85rem; margin: 0; }
  .loading-track { width: 7rem; height: 2px; margin-top: 2rem; background: var(--line); overflow: hidden; }
  .loading-track::after { content: ''; display: block; width: 35%; height: 100%; background: var(--warm); animation: progress 1.5s ease-in-out infinite alternate; }
  footer { display: flex; flex-wrap: wrap; gap: 1rem; justify-content: space-between; border-top: 1px solid var(--line); padding: 1.5rem 0 2rem; color: var(--trial-muted); font-size: 0.7rem; }
  footer > span { font-family: var(--font-mono); font-size: 0.65rem; }
  footer p { margin: 0; }
  footer a { color: oklch(var(--foreground)); }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes progress { to { transform: translateX(190%); } }
  @media (max-width: 1050px) {
    .intro { gap: 2rem; padding-top: 2rem; }
    .controls { grid-template-columns: 1fr 1fr 1fr; }
    .controls-caption { grid-column: 1/-1; }
    .provenance { gap: 1.5rem; grid-template-columns: 1fr; }
  }
  @media (max-width: 760px) {
    .intro { grid-template-columns: 1fr; padding: 2rem 0; gap: 1rem; }
    h1 { font-size: 1.5rem; }
    .case-file { padding: 1rem; }
    .case-file h2 { font-size: 1rem; }
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

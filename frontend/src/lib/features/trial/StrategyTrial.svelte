<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { authState } from '$lib/features/auth/auth';
  import AuthDialog from '../../../components/dialogs/AuthDialog.svelte';
  import { apiFetch, readErrorMessage } from '$lib/core/api';
  import type { TrialCatalog, TrialConfig, TrialReport, TrialStrategy } from '$lib/features/trial-report/types';
  import { readTrialShareConfig } from '$lib/features/trial-report/sharing';
  import ReportActions from '$lib/features/trial-report/ReportActions.svelte';
  import EquityEvidence from './EquityEvidence.svelte';
  import RunMetrics from './RunMetrics.svelte';
  import ReportContext from './ReportContext.svelte';
  import { formatDate, formatMoney, formatPercent, validCost } from './evidence';
  import ChartCandlestick from '@lucide/svelte/icons/chart-candlestick';
  import Activity from '@lucide/svelte/icons/activity';
  import { Tabs } from 'bits-ui';
  import { isWorkspaceReport, parseParameterOverrides, runWorkspaceChecks, workspaceFingerprint, type EvidenceReport, type WorkspaceContext, type WorkspaceSettings } from './workspace';

  let { workspaceHref = '/', embedded = false, workspace, onopenstrategy, onreturnworkspace }: {
    workspaceHref?: string;
    embedded?: boolean;
    onreturnworkspace?: () => void;
    workspace?: WorkspaceContext;
    onopenstrategy?: () => void;
  } = $props();

  const knownCases = ['backtest-billionaire', 'overcaffeinated-trader', 'boring-benchmark'];

  let strategies = $state<TrialStrategy[]>([]);
  let selectedId = $state<TrialConfig['strategy_id']>('backtest-billionaire');
  let commission = $state<number | undefined>(1);
  let slippage = $state<number | undefined>(5);
  let catalogLoading = $state(true);
  let catalogError = $state('');
  let running = $state(false);
  let configurationExpanded = $state(false);
  let authDialogOpen = $state(false);
  let runError = $state('');
  let report = $state.raw<EvidenceReport | null>(null);
  let receivedAt = $state('');
  let reportAccount = untrack(() => $authState.user?.id ?? null);
  let mode = $state<'workspace' | 'examples'>(untrack(() => workspace ? 'workspace' : 'examples'));
  let startingCash = $state<number | undefined>(100_000);
  let holdoutPercent = $state<number | undefined>(30);
  let parameterOverrides = $state('{}');
  let sensitivityParameter = $state('');
  let completedFingerprint = $state('');
  let statusMessage = $state(untrack(() => workspace ? 'Ready to check the current Strategy editor draft.' : 'Loading example strategies…'));
  let catalogController: AbortController | null = null;
  let runController: AbortController | null = null;
  let runSequence = 0;
  let initialSharedConfig: TrialConfig | null = null;
  let disposed = false;

  let costsValid = $derived(validCost(commission) && validCost(slippage));
  let workspaceSettings = $derived.by((): WorkspaceSettings | null => {
    if (!validCost(commission) || !validCost(slippage) || !Number.isFinite(startingCash) || !startingCash || startingCash <= 0 || startingCash > 1e12 ||
      !Number.isFinite(holdoutPercent) || holdoutPercent === undefined || holdoutPercent < 10 || holdoutPercent > 50) return null;
    try {
      return { commission_bps: commission, slippage_bps: slippage, starting_cash: startingCash, holdout_fraction: holdoutPercent / 100,
        params: parseParameterOverrides(parameterOverrides), sensitivity_parameter: sensitivityParameter.trim() || null };
    } catch { return null; }
  });
  let inputsChanged = $derived(report !== null && (isWorkspaceReport(report) ?
    mode !== 'workspace' || !workspace || !workspaceSettings || completedFingerprint !== workspaceFingerprint(workspace, workspaceSettings) :
    mode !== 'examples' || report.config.strategy_id !== selectedId ||
    report.config.commission_bps !== commission ||
    report.config.slippage_bps !== slippage
  ));
  let selectedStrategy = $derived(strategies.find(strategy => strategy.id === selectedId));
  let canRun = $derived(mode === 'workspace' ? !!workspaceSettings && !!workspace?.code.trim() && !!workspace?.symbol.trim() : costsValid && !!selectedStrategy);

  $effect(() => {
    const account = $authState.user?.id ?? null;
    if (account === reportAccount) return;
    reportAccount = account;
    untrack(() => {
      if (mode === 'workspace') cancelRun();
      if (report && isWorkspaceReport(report)) {
        report = null;
        completedFingerprint = '';
        receivedAt = '';
        runError = '';
        statusMessage = 'Account changed. Run checks for the current workspace.';
      }
    });
  });

  function chooseMode(next: 'workspace' | 'examples'): void {
    if (next === mode) return;
    cancelRun();
    mode = next;
    report = null;
    runError = '';
    statusMessage = 'Source selected. Run checks to measure this setup.';
  }

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
    statusMessage = 'Strategy selected. Run checks to measure this setup.';
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
        throw new Error('The strategy catalog uses an unsupported format.');
      }
      strategies = catalog.strategies.filter(strategy => knownCases.includes(strategy.id));
      if (!strategies.length) {
        if (mode === 'examples') statusMessage = 'No example strategies are available.';
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
      if (mode === 'examples') await runTrial();
    } catch (error) {
      if (controller.signal.aborted || disposed) return;
      catalogError = error instanceof Error ? error.message : 'The strategy catalog could not be loaded.';
      if (mode === 'examples') statusMessage = 'Example strategies could not be loaded.';
    } finally {
      if (catalogController === controller && !disposed) catalogLoading = false;
    }
  }

  async function runTrial(): Promise<void> {
    if (mode === 'workspace') {
      await runWorkspace();
      return;
    }
    if (!validCost(commission) || !validCost(slippage) || !selectedStrategy) {
      runError = 'Choose a strategy and enter finite costs between 0 and 50 bps.';
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
    statusMessage = `Running checks for ${selectedStrategy.name}…`;
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
        throw new Error('The report did not match this example configuration.');
      }
      report = result;
      receivedAt = new Date().toISOString();
      statusMessage = `Results ready for ${result.strategy.name}.`;
    } catch (error) {
      if (controller.signal.aborted || disposed || sequence !== runSequence) return;
      runError = error instanceof Error ? error.message : 'This run could not be completed.';
      statusMessage = 'The checks did not finish. You can retry.';
    } finally {
      if (sequence === runSequence && !disposed) {
        running = false;
        runController = null;
      }
    }
  }

  async function runWorkspace(): Promise<void> {
    if (!$authState.user) { authDialogOpen = true; return; }
    if (!workspace || !workspaceSettings || !canRun) {
      runError = 'Choose a market symbol, enter a strategy and valid costs, cash, holdout percentage and JSON parameter overrides.';
      return;
    }
    cancelRun();
    const sequence = runSequence;
    const context = { ...workspace };
    const settings = { ...workspaceSettings };
    const fingerprint = workspaceFingerprint(context, settings);
    const controller = new AbortController();
    runController = controller;
    running = true;
    runError = '';
    statusMessage = `Running ${context.name} on ${context.symbol} · ${context.provider}…`;
    try {
      const result = await runWorkspaceChecks(context, settings, controller.signal);
      if (controller.signal.aborted || disposed || sequence !== runSequence) return;
      if (result.schema_version !== 1 || result.source !== 'workspace' || result.dataset.synthetic !== false) {
        throw new Error('The workspace report uses an unsupported format.');
      }
      report = result;
      receivedAt = new Date().toISOString();
      completedFingerprint = fingerprint;
      statusMessage = `Results ready for ${result.strategy.name} · ${result.dataset.label}.`;
    } catch (error) {
      if (controller.signal.aborted || disposed || sequence !== runSequence) return;
      runError = error instanceof Error ? error.message : 'Workspace checks could not be completed.';
      statusMessage = 'The checks did not finish. You can retry.';
    } finally {
      if (sequence === runSequence && !disposed) {
        running = false;
        runController = null;
      }
    }
  }

  onMount(() => {
    initialSharedConfig = readTrialShareConfig(window.location.search);
    if (initialSharedConfig) mode = 'examples';
    void loadCatalog();
    return () => {
      disposed = true;
      catalogController?.abort();
      cancelRun();
    };
  });
</script>

<div class="trial-shell" class:standalone={!embedded} class:embedded>
  <header class="topbar">
    <div class="brand">
      {#if !embedded}
        <span class="wordmark">openQuant <ChartCandlestick class="h-4 w-4 text-primary" /></span>
        <span class="divider" aria-hidden="true">/</span>
      {/if}
      <Activity class="h-4 w-4 text-primary" />
      <h1>Robustness checks</h1>
      <span class="badge">{mode === 'workspace' ? 'WORKSPACE STRATEGY' : 'EXAMPLE DATA'}</span>
    </div>
    {#if embedded}
      <button class="ot-workbench-ghost" onclick={onreturnworkspace}>Back to workspace</button>
    {:else}
      <a class="ot-workbench-ghost" href={workspaceHref}>Research workspace</a>
    {/if}
  </header>

  <div class="workbench">
    <aside class="configuration" aria-label="Robustness configuration">
      <button type="button" class="config-toggle ot-workbench-ghost" aria-expanded={configurationExpanded} aria-controls="robustness-configuration-fields" onclick={() => (configurationExpanded = !configurationExpanded)}>Configuration · {mode === 'workspace' ? workspace?.symbol || 'No symbol' : 'Example data'}</button>
      <div id="robustness-configuration-fields" class="config-scroll" class:expanded={configurationExpanded}>
      <h2>Configuration</h2>
      <p class="muted">Compare execution costs, buy-and-hold, an out-of-sample period and neighboring parameter values.</p>
      <form id="robustness-run-form" onsubmit={event => { event.preventDefault(); void runTrial(); }}>
        {#if workspace}
          <label for="robustness-source">Strategy source</label>
          <select id="robustness-source" value={mode} onchange={event => chooseMode(event.currentTarget.value as 'workspace' | 'examples')}>
            <option value="workspace">Current workspace strategy</option>
            <option value="examples">Built-in examples</option>
          </select>
        {/if}
        {#if mode === 'workspace' && workspace}
          <h3>{workspace.name}</h3>
          <p class="muted">{workspace.symbol || 'Select a chart symbol'} · {workspace.provider} · {workspace.period} / {workspace.interval}. Uses the current editor source, including unsaved changes.</p>
          <button class="ot-workbench-ghost" type="button" onclick={onopenstrategy}>Edit strategy</button>
          <label for="robustness-cash">Starting cash (currency units)</label>
          <input id="robustness-cash" type="number" min="0.01" max="1000000000000" step="any" required bind:value={startingCash} />
          <label for="robustness-holdout">Chronological holdout (%)</label>
          <input id="robustness-holdout" type="number" min="10" max="50" step="any" required bind:value={holdoutPercent} />
          <label for="robustness-params">Parameter overrides (JSON)</label>
          <textarea id="robustness-params" rows="3" bind:value={parameterOverrides} spellcheck="false" aria-describedby="robustness-param-help"></textarea>
          <p id="robustness-param-help" class="muted">For example: {`{"fast": 10, "slow": 30}`}. Empty object uses each declared parameter's first grid value. Overrides must match the declared grid; no automatic tuning.</p>
          <label for="robustness-parameter">Sensitivity parameter (optional)</label>
          <input id="robustness-parameter" type="text" maxlength="100" bind:value={sensitivityParameter} placeholder="First declared parameter by default" />
          {#if !workspaceSettings}<p class="error">Enter valid cash, a 10–50% holdout and a JSON object of numeric or string parameter values.</p>{/if}
        {:else}
        <label for="trial-strategy">Example strategy</label>
        <select id="trial-strategy" value={selectedId} disabled={catalogLoading || !strategies.length}
          onchange={event => chooseCase(event.currentTarget.value as TrialConfig['strategy_id'])}
          aria-describedby="strategy-description">
          {#if !strategies.length}<option value={selectedId}>{catalogLoading ? 'Loading strategies…' : 'No strategies available'}</option>{/if}
          {#each strategies as strategy (strategy.id)}<option value={strategy.id}>{strategy.name}</option>{/each}
        </select>
        <p id="strategy-description" class="muted">{selectedStrategy?.description ?? 'Built-in examples only; no submitted code is executed.'}</p>
        {#if catalogError}
          <p class="error" role="alert">{catalogError}</p>
          <button class="ot-workbench-ghost" type="button" onclick={() => loadCatalog()}>Retry catalog</button>
        {:else if !catalogLoading && !strategies.length}
          <p role="status">No supported examples are available.</p>
          <button class="ot-workbench-ghost" type="button" onclick={() => loadCatalog()}>Reload catalog</button>
        {/if}
        {/if}

        <fieldset>
          <legend>Execution costs</legend>
          <label for="trial-commission">Commission (bps)</label>
          <input id="trial-commission" type="number" min="0" max="50" step="any" required
            bind:value={commission} aria-describedby="trial-cost-help" />
          <label for="trial-slippage">Slippage (bps)</label>
          <input id="trial-slippage" type="number" min="0" max="50" step="any" required
            bind:value={slippage} aria-describedby="trial-cost-help" />
          <p id="trial-cost-help" class="muted">0–50 bps per fill. 1 bp = 0.01%.{#if !costsValid} <strong class="error">Enter finite costs within this range.</strong>{/if}</p>
        </fieldset>
      </form>

      <div class="scope">
        {#if mode === 'workspace'}
          <h2>Research scope</h2>
          <p>Sign in to run single-symbol strategy checks on the selected provider's OHLCV snapshot. All runs reuse the same fetched/cached bars, not a live chart stream.</p>
          <p>Each segment needs at least 20 bars; the suite allows at most 10,000 bars and 30 seconds. Holdout starts flat with fresh strategy state and no history carried from the earlier segment.</p>
          <p>A chronological split cannot prove these dates were unseen during your research. No automatic parameter selection or public code sharing.</p>
        {:else}
        <h2>Example scope</h2>
        <p>Built-in strategies on synthetic educational data, using OpenQuant's backtest engine and $10,000 starting cash.</p>
        <p>These checks do not use your chart data or custom strategy. Use Strategy and Backtesting in the workspace for your own research.</p>
        {/if}
        <p>No live orders or investment advice.</p>
      </div>
      </div>
      <div class="run-controls">
        <button class="run-button ot-workbench-primary" type="submit" form="robustness-run-form" disabled={!canRun || running}>{running ? 'Running…' : mode === 'workspace' && !$authState.user ? 'Sign in to run checks' : 'Run checks'}</button>
        {#if running}<button class="ot-workbench-ghost" type="button" onclick={() => { cancelRun(); statusMessage = 'Stopped waiting for this result. A workspace suite may continue up to its 30-second server limit.'; }}>Stop waiting</button>{/if}
        <span class="muted">{mode === 'workspace' ? 'Current editor draft · no live orders' : 'Synthetic examples · not chart data'}</span>
      </div>
    </aside>

    <main class="results" aria-label="Robustness results" aria-busy={running}>
      <p class="live-status" role="status" aria-live="polite">{statusMessage}</p>
      {#if runError}
        <div class="notice error" role="alert">
          <p>{runError}{#if report} The last completed report remains below.{/if}</p>
          <button class="ot-workbench-ghost" disabled={!canRun || running} onclick={() => runTrial()}>Retry run</button>
        </div>
      {/if}
      {#if report}
        {#if inputsChanged || running}
          <p class="notice">{running ? 'Checks are running. Showing the last completed report.' : 'Configuration changed. Run checks to update the results.'}
            Results below: <strong>{report.strategy.name}</strong>, {report.config.commission_bps} bps commission / {report.config.slippage_bps} bps slippage.</p>
        {/if}
        <div class="result-heading">
          <div><h2>{report.strategy.name}</h2><p class="muted">{report.strategy.lesson}</p></div>
          <span class="badge">{isWorkspaceReport(report) ? 'PROVIDER SNAPSHOT' : 'SYNTHETIC'}</span>
        </div>
        <ReportContext {report} {receivedAt} />

        <div class="metric-strip">
          <div><span>Return · with costs</span><strong>{formatPercent(report.realistic.total_return, true)}</strong><small>Zero-cost: {formatPercent(report.baseline.total_return, true)}</small><small>Buy &amp; hold + costs: {formatPercent(report.benchmark.total_return, true)}</small></div>
          <div><span>Max drawdown</span><strong>{formatPercent(report.realistic.max_drawdown)}</strong><small>Full period · with costs</small></div>
          <div><span>Execution costs · currency units</span><strong>{formatMoney(report.realistic.total_cost, isWorkspaceReport(report))}</strong><small>{report.realistic.trade_count.toLocaleString('en-US')} completed round trips</small></div>
          <div><span>Holdout vs benchmark</span><strong>{formatPercent(report.holdout.strategy.total_return - report.holdout.benchmark.total_return, true).replace('%', ' pp')}</strong><small>Return difference · percentage points</small></div>
        </div>

        <section class="findings" aria-labelledby="findings-heading">
          <h3 id="findings-heading">Measured findings</h3>
          {#each report.findings as finding (finding.id)}
            <article class:warning={finding.severity === 'warning'}><h4>{finding.title}</h4><p>{finding.detail}</p></article>
          {:else}<p class="muted">No findings were supplied for this run.</p>{/each}
        </section>

        <Tabs.Root value="performance">
          <Tabs.List class="result-tabs" aria-label="Robustness report sections" onfocusin={(event) => {
            if (event.target instanceof HTMLElement && event.target.getAttribute('role') === 'tab') {
              event.target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }
          }}>
            <Tabs.Trigger class="result-tab" value="performance">Performance</Tabs.Trigger>
            <Tabs.Trigger class="result-tab" value="holdout">Holdout</Tabs.Trigger>
            <Tabs.Trigger class="result-tab" value="sensitivity">Sensitivity</Tabs.Trigger>
            <Tabs.Trigger class="result-tab" value="assumptions">Assumptions</Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content class="result-content" value="performance">
            <EquityEvidence {report} />
            <RunMetrics currencyUnits={isWorkspaceReport(report)} caption={`Full period · ${isWorkspaceReport(report) ? formatMoney(report.config.starting_cash, true) : '$10,000'} starting cash per account`} runs={[
              { label: 'Zero-cost strategy', summary: report.baseline },
              { label: 'Strategy + costs', summary: report.realistic },
              { label: 'Buy & hold + costs', summary: report.benchmark },
            ]} />
          </Tabs.Content>
          <Tabs.Content class="result-content" value="holdout">
            <h3>{isWorkspaceReport(report) ? 'Chronological holdout comparison' : 'Out-of-sample comparison'}</h3>
            <p class="muted">The earlier segment ends before {formatDate(report.dataset.split_date)}. Both holdout accounts start separately with {isWorkspaceReport(report) ? formatMoney(report.config.starting_cash, true) : '$10,000'} on the same test segment, at the chosen costs. Their curves are not stitched into the full-period results.</p>
            {#if isWorkspaceReport(report)}<p class="muted">No tuning is performed on the earlier segment. These dates may already have been seen during your research; this split is not proof of untouched out-of-sample data.</p>{/if}
            <RunMetrics currencyUnits={isWorkspaceReport(report)} caption="Separately funded holdout · same dates and costs" runs={[
              { label: 'Strategy + costs', summary: report.holdout.strategy },
              { label: 'Buy & hold + costs', summary: report.holdout.benchmark },
            ]} />
          </Tabs.Content>
          <Tabs.Content class="result-content" value="sensitivity">
            <h3>Parameter sensitivity</h3>
            {#if report.selected_parameter}
              <p class="muted">{isWorkspaceReport(report) || report.strategy.id === 'overcaffeinated-trader' ? 'Fixed, not optimized:' : 'Selected on training only:'}
                <strong>{report.selected_parameter.name} = {report.selected_parameter.value}</strong>. Neighboring values below are measured on holdout at the chosen costs; these results do not select a new parameter.</p>
            {:else}<p class="muted">This strategy has no declared tuning parameter. No parameter sweep applies.</p>{/if}
            {#if report.sensitivity.length}
              <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard access to horizontal scrolling.) -->
              <div class="table-scroll" tabindex="0" role="region" aria-label="Holdout parameter sensitivity">
                <table><caption>Holdout parameter grid</caption><thead><tr><th scope="col">Parameter</th><th scope="col">Return</th><th scope="col">Max drawdown</th></tr></thead>
                  <tbody>{#each report.sensitivity as row}<tr><th scope="row">{row.parameter_value}</th><td>{formatPercent(row.total_return, true)}</td><td>{formatPercent(row.max_drawdown)}</td></tr>{/each}</tbody>
                </table>
              </div>
            {/if}
          </Tabs.Content>
          <Tabs.Content class="result-content" value="assumptions">
            <h3>Data and reproducibility</h3>
            <p class="muted">{isWorkspaceReport(report) ? 'Selected provider OHLCV, sorted and snapshotted for this suite. A content hash identifies these bars, not their quality or permanent availability.' : 'Developer-designed synthetic scenarios are not real market history or independent evidence of market alpha.'}</p>
            <dl>
              <div><dt>Dataset</dt><dd>{report.dataset.label}</dd></div>
              <div><dt>Dataset version / SHA-256</dt><dd>{report.dataset.version}</dd></div>
              {#if isWorkspaceReport(report)}
                <div><dt>Source SHA-256</dt><dd>{report.code_hash}</dd></div>
                <div><dt>Engine / seed</dt><dd>{report.engine_version} / {report.config.seed}</dd></div>
                <div><dt>Resolved parameters</dt><dd>{JSON.stringify(report.config.params)}</dd></div>
              {/if}
              <div><dt>Dates (UTC)</dt><dd>{formatDate(report.dataset.start)} — {formatDate(report.dataset.end)}</dd></div>
              <div><dt>Split</dt><dd>{report.dataset.training_bars.toLocaleString('en-US')} {isWorkspaceReport(report) ? 'earlier' : 'training'} / {report.dataset.holdout_bars.toLocaleString('en-US')} holdout bars</dd></div>
              <div><dt>Costs per fill</dt><dd>{report.config.commission_bps} bps commission / {report.config.slippage_bps} bps slippage</dd></div>
              <div><dt>Report ID</dt><dd>{report.report_id}</dd></div>
            </dl>
            <h3>Assumptions</h3><ul>{#each report.assumptions as assumption}<li>{assumption}</li>{/each}</ul>
            <h3>Limitations</h3><ul>{#each report.limitations as limitation}<li>{limitation}</li>{/each}</ul>
          </Tabs.Content>
        </Tabs.Root>
        <div class="report-actions"><ReportActions {report} /></div>
      {:else}
        <div class="empty-state">
          <Activity class="h-6 w-6 text-muted-foreground" />
          <h2>{running ? 'Running robustness checks' : 'No results yet'}</h2>
          <p>{running ? 'Calculating costs, benchmark, holdout and sensitivity.' : mode === 'workspace' ? 'Review the current strategy and market context, then run checks.' : 'Select an example strategy and run checks to compare its results.'}</p>
        </div>
      {/if}
    </main>
  </div>
</div>

<AuthDialog bind:open={authDialogOpen} />

<style>
  .trial-shell { display: flex; flex-direction: column; min-height: 100%; background: oklch(var(--background)); color: oklch(var(--foreground)); font: 14px/20px var(--font-family-lato); }
  .standalone { height: 100dvh; min-height: 0; }
  .embedded { height: 100%; min-height: 0; }
  .workbench { min-height: 0; overflow: hidden; }
  .topbar { display: flex; flex-shrink: 0; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; padding: 12px 48px 12px 18px; border-bottom: 1px solid oklch(var(--border)); }
  .brand, .wordmark { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
  .wordmark { font-weight: 600; }
  .divider, .muted, .scope, .live-status, small, dt { color: oklch(var(--muted-foreground)); }
  h1, h2, h3, h4 { margin: 0; font: 700 14px/20px var(--font-family-lato); }
  h1 { font-size: 13px; }
  h2 { margin-bottom: 8px; }
  h3 { margin-bottom: 12px; }
  p { margin: 0 0 12px; }
  .badge { border: 1px solid oklch(var(--border)); color: oklch(var(--muted-foreground)); border-radius: 3px; padding: 2px 6px; font-size: 10px; letter-spacing: .04em; white-space: nowrap; }
  .workbench { display: grid; grid-template-columns: 280px minmax(0, 1fr); flex: 1; }
  .configuration { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid oklch(var(--border)); background: oklch(var(--popover)); }
  .config-scroll { min-height: 0; flex: 1; overflow-y: auto; padding: 18px; }
  .config-toggle { display: none; }
  .run-controls { display: flex; flex-direction: column; flex-shrink: 0; gap: 8px; padding: 12px 18px; border-top: 1px solid oklch(var(--border)); }
  .run-controls span { font-size: 10px; }
  form { display: flex; flex-direction: column; gap: 8px; margin-top: 20px; }
  label, legend { font-size: 11px; font-weight: 600; }
  input, select, textarea { width: 100%; min-height: 36px; border: 1px solid oklch(var(--input)); border-radius: 4px; background: oklch(var(--background)); color: oklch(var(--foreground)); font: inherit; padding: 6px 8px; }
  textarea { resize: vertical; }
  fieldset { display: flex; flex-direction: column; gap: 8px; padding: 14px 0 0; margin: 0 0 8px; border: 0; border-top: 1px solid oklch(var(--border)); }
  legend { padding: 0 6px 0 0; }
  .run-button { justify-content: center; }
  .trial-shell :global(.ot-workbench-ghost), .trial-shell :global(.ot-workbench-primary) { min-height: 36px; }
  .trial-shell :global(button:disabled), select:disabled { opacity: .55; cursor: not-allowed; }
  input:focus-visible, select:focus-visible, textarea:focus-visible, .trial-shell :global(button:focus-visible), .trial-shell :global(a:focus-visible) { outline: 2px solid oklch(var(--primary)); outline-offset: 2px; }
  .scope { margin-top: 22px; padding-top: 16px; border-top: 1px solid oklch(var(--border)); font-size: 11px; }
  .scope h2 { color: oklch(var(--foreground)); }
  .results { min-width: 0; min-height: 0; overflow-y: auto; padding: 18px; }
  .live-status { font-size: 11px; }
  .notice { border: 1px solid oklch(var(--border)); background: oklch(var(--muted)); padding: 12px; margin-bottom: 16px; }
  .notice p { margin-bottom: 8px; }
  .error { color: oklch(var(--destructive)); }
  .result-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
  .result-heading h2 { font-size: 20px; line-height: 28px; }
  .result-heading p { margin: 0; }
  .metric-strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border: 1px solid oklch(var(--border)); margin-bottom: 18px; }
  .metric-strip > div { display: flex; flex-direction: column; gap: 4px; padding: 12px; background: oklch(var(--muted) / .4); }
  .metric-strip > div + div { border-left: 1px solid oklch(var(--border)); }
  .metric-strip span, .metric-strip small { font-size: 10px; color: oklch(var(--muted-foreground)); }
  .metric-strip strong { font-family: var(--font-mono); font-size: 20px; font-weight: 400; font-variant-numeric: tabular-nums; }
  .trial-shell :global(.result-tabs) { display: flex; gap: 2px; overflow-x: auto; border-bottom: 1px solid oklch(var(--border)); }
  .trial-shell :global(.result-tab) { background: transparent; color: oklch(var(--muted-foreground)); border: 0; border-bottom: 2px solid transparent; padding: 10px 12px; font: inherit; cursor: pointer; white-space: nowrap; }
  .trial-shell :global(.result-tab[data-state="active"]) { color: oklch(var(--foreground)); border-bottom-color: oklch(var(--primary)); }
  .trial-shell :global(.result-content) { padding: 16px 0; }
  .trial-shell :global(.result-content > * + *) { margin-top: 16px; }
  .findings { margin: 0 0 20px; }
  .findings article { padding: 12px 0 12px 12px; border-left: 2px solid oklch(var(--border)); margin-top: 10px; }
  .findings article.warning { border-left-color: oklch(var(--primary)); }
  .findings h4 { margin-bottom: 6px; }
  .findings p { color: oklch(var(--muted-foreground)); margin: 0; }
  .table-scroll { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; text-align: right; }
  caption { text-align: left; color: oklch(var(--muted-foreground)); padding: 10px; }
  th, td { padding: 10px; border: 1px solid oklch(var(--border)); font-weight: 400; }
  th:first-child { text-align: left; }
  dl { margin: 0; border: 1px solid oklch(var(--border)); }
  dl > div { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 12px; padding: 10px 12px; }
  dl > div + div { border-top: 1px solid oklch(var(--border)); }
  dd { margin: 0; overflow-wrap: anywhere; }
  ul { padding-left: 18px; color: oklch(var(--muted-foreground)); }
  li + li { margin-top: 6px; }
  .report-actions { border-top: 1px solid oklch(var(--border)); padding-top: 16px; }
  .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; min-height: 300px; text-align: center; color: oklch(var(--muted-foreground)); }
  .empty-state p { max-width: 50ch; }
  @media (max-width: 900px) { .metric-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); } .metric-strip > div:nth-child(3) { border-left: 0; } .metric-strip > div:nth-child(n+3) { border-top: 1px solid oklch(var(--border)); } }
  @media (max-width: 700px) {
    .workbench { display: flex; flex-direction: column; overflow-y: auto; }
    .configuration { position: sticky; top: 0; z-index: 1; flex-shrink: 0; border-right: 0; border-bottom: 1px solid oklch(var(--border)); }
    .config-toggle { display: flex; justify-content: space-between; margin: 8px 14px; }
    .config-scroll { display: none; flex: none; padding: 14px; max-height: min(45dvh, 360px); overflow-y: auto; }
    .config-scroll.expanded { display: block; }
    .run-controls { padding: 10px 14px; }
    .run-controls span { display: none; }
    .topbar { padding-left: 14px; }
    .results { flex-shrink: 0; overflow: visible; padding: 14px; }
    .empty-state { min-height: 180px; }
    .metric-strip strong { font-size: 16px; overflow-wrap: anywhere; }
  }
</style>

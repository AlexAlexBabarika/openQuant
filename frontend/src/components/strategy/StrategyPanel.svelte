<script lang="ts" module>
  export function editorShareForKey(event: Pick<KeyboardEvent, 'key' | 'preventDefault'>, value: number): number | null {
    const next = event.key === 'ArrowLeft' ? value - 5 : event.key === 'ArrowRight' ? value + 5 : event.key === 'Home' ? 25 : event.key === 'End' ? 75 : null;
    if (next === null) return null;
    event.preventDefault();
    return Math.max(25, Math.min(75, next));
  }
</script>

<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import { authState } from '$lib/features/auth/auth';
  import AuthDialog from '../dialogs/AuthDialog.svelte';
  import { Dialog, Popover } from 'bits-ui';
  import { createModalLifecycle } from '$lib/core/modalLifecycle';
  import Plus from '@lucide/svelte/icons/plus';
  import { confirmAction, confirmDiscard } from '$lib/features/confirm/confirm.svelte';
  import Play from '@lucide/svelte/icons/play';
  import Save from '@lucide/svelte/icons/save';
  import PanelTopbar from '../layout/PanelTopbar.svelte';
  import ScriptRail from '$lib/features/scripts/ScriptRail.svelte';
  import ScriptEditor from '../indicators/ScriptEditor.svelte';
  import StrategyDocs from './StrategyDocs.svelte';
  import OptionsPanel from '../options/OptionsPanel.svelte';
  import SweepPanel from '../sweep/SweepPanel.svelte';
  import PortfolioPanel from './PortfolioPanel.svelte';
  import BacktestPanel from '../backtest/BacktestPanel.svelte';
  import { formatIsoMinute } from '$lib/features/backtest/format';
  import DataQualityEvidence from '../backtest/DataQualityEvidence.svelte';
  import ErrorBanner from '../ErrorBanner.svelte';
  import { StrategyState } from '$lib/features/strategy/strategyState.svelte';
  import { runsHistory } from '$lib/features/runs/runsHistory.svelte';
  import { SweepState } from '$lib/features/sweep/sweepState.svelte';
  import { PortfolioState } from '$lib/features/portfolio/portfolioState.svelte';
  import type { MarketDataProviderValue } from '$lib/features/market/marketDataProviders';

  let {
    open = $bindable(false),
    embedded = false,
    symbol,
    provider,
    period,
    interval,
    strategy,
    onOpenRuns,
    onCompare,
    onRobustness,
    portfolioRunId = null,
    editorShare = $bindable(50),
    recoverySavedAt = null,
    tab = $bindable<'editor' | 'options' | 'sweep' | 'portfolio' | 'docs'>('editor'),
    workspaceSymbol = null,
    workspaceSpot = null,
    optionsLink = 0,
  }: {
    open?: boolean;
    embedded?: boolean;
    symbol: string;
    provider: MarketDataProviderValue;
    period: string;
    interval: string;
    strategy: StrategyState;
    onOpenRuns?: () => void;
    onCompare?: (a: string, b: string) => void;
    onRobustness?: () => void;
    /** When set to a new id, load that stored portfolio run and show it. */
    portfolioRunId?: string | null;
    editorShare?: number;
    recoverySavedAt?: string | null;
    tab?: 'editor' | 'options' | 'sweep' | 'portfolio' | 'docs';
    /** Loaded chart symbol and last close, for the options workbench's spot. */
    workspaceSymbol?: string | null;
    workspaceSpot?: number | null;
    /** Incremented to make the options draft follow the chart symbol again. */
    optionsLink?: number;
  } = $props();

  const strat = $derived(strategy);

  // One SweepState for the panel's lifetime so a running sweep survives
  // toggling between the editor and sweep views; same for the portfolio run.
  const sweep = new SweepState();
  const portfolio = new PortfolioState();
  let backtestOpen = $state(false);
  let libraryOpen = $state(untrack(() => strat.scripts.length > 0));
  let editorView = $state<'editor' | 'results'>('editor');
  let splitEnabled = $state(false);
  let actionsOpen = $state(false);
  let panesEl = $state<HTMLDivElement | null>(null);
  let resizing = $state(false);
  let completedSource = $state<string | null>(null);
  let completedContext = $state('');
  let completedName = $state('');
  let completedMarket = $state<{ symbol: string; provider: MarketDataProviderValue; period: string; interval: string } | null>(null);
  let completedResult = $state<StrategyState['backtest']>(null);
  async function selectAction(action: () => void) {
    actionsOpen = false;
    await tick();
    action();
  }
  const resultChanged = $derived(completedResult === strat.backtest && completedSource !== null && (completedSource !== strat.draftCode || completedContext !== `${symbol}|${provider}|${period}|${interval}`));

  function resizeEditor(event: PointerEvent) {
    if (!resizing || !panesEl) return;
    const rect = panesEl.getBoundingClientRect();
    editorShare = Math.max(25, Math.min(75, (event.clientX - rect.left) / rect.width * 100));
  }

  function openPortfolioTab() {
    // Seed the universe with the chart's symbol so the tab is one click
    // from a runnable state.
    if (portfolio.symbols.length === 0 && symbol) portfolio.add(symbol);
    tab = 'portfolio';
  }

  // Load a stored portfolio run when the parent hands us a new id, and surface
  // it on the portfolio tab. Tracked so the same id doesn't reload on re-render.
  let loadedPortfolioRun: string | null = null;
  $effect(() => {
    const id = portfolioRunId;
    if (id && id !== loadedPortfolioRun) {
      loadedPortfolioRun = id;
      tab = 'portfolio';
      void portfolio.loadStored(id);
    }
  });

  let authDialogOpen = $state(false);
  let savedUserId: string | null = null;
  $effect(() => {
    const userId = $authState.user?.id ?? null;
    if (userId !== savedUserId) untrack(() => {
      savedUserId = userId;
      sweep.reset();
      portfolio.reset();
      loadedPortfolioRun = null;
      strat.clearSaved();
      completedSource = null;
      completedResult = null;
      completedMarket = null;
      strat.backtest = null;
      strat.isRunning = false;
      strat.runError = null;
    });
    if (open && userId) untrack(() => { void strat.load(); });
  });


  const modal = createModalLifecycle();
  onDestroy(() => {
    sweep.reset();
    portfolio.reset();
    modal.close();
  });
  let panelEl = $state<HTMLDivElement | null>(null);

  function close() {
    open = false;
  }


  async function runNow() {
    if (strat.isRunning || !symbol) return;
    const source = strat.draftCode;
    const runName = strat.draftName;
    const accountVersion = runsHistory.accountVersion;
    const context = `${symbol}|${provider}|${period}|${interval}`;
    const market = { symbol, provider, period, interval };
    const bt = await strat.runBacktest(market);
    if (strat.backtest === bt && !bt.error) {
      if (bt.result?.meta.run_id && accountVersion === runsHistory.accountVersion) runsHistory.record({
        run_id: bt.result.meta.run_id, kind: 'single', label: runName,
        created_at: bt.result.meta.finished_at,
      });
      completedSource = source;
      completedContext = context;
      completedName = runName;
      completedMarket = market;
      completedResult = bt;
      editorView = 'results';
    }
  }

  async function saveNow() {
    if (!$authState.user) { authDialogOpen = true; return; }
    await strat.save();
  }

  async function confirmDelete(id: string, name: string) {
    if (!$authState.user) { authDialogOpen = true; return; }
    const unsaved = strat.activeId === id && strat.dirty
      ? ' Unsaved changes will be discarded.'
      : '';
    if (!(await confirmAction({ title: `Delete "${name}"?`, description: `This cannot be undone.${unsaved}`, confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await strat.remove(id);
    } catch (err) {
      void confirmAction({ title: `Could not delete "${name}"`, description: err instanceof Error ? err.message : 'Delete failed', acknowledge: true });
    }
  }

  async function newDraft() {
    if (await confirmDiscard(strat.dirty, 'strategy')) strat.newDraft(() => true);
  }

  async function selectScript(id: string) {
    if (id === strat.activeId) return;
    if (await confirmDiscard(strat.dirty, 'strategy')) strat.select(id, () => true);
  }
</script>

{#snippet panelContent(props: Record<string, unknown> = {})}
  <div {...props}
    bind:this={panelEl}
    class="panel"
    class:embedded
    role={embedded ? 'region' : 'dialog'}
    tabindex="-1"
    aria-modal={embedded ? undefined : true}
    aria-label="Strategy workbench"
    onkeydown={event => {
      if (event.defaultPrevented || tab !== 'editor' || !(event.metaKey || event.ctrlKey) || event.repeat) return;
      if (event.key === 'Enter') { event.preventDefault(); void runNow(); }
      else if (event.key.toLowerCase() === 's') { event.preventDefault(); void saveNow(); }
    }}
  >
    <PanelTopbar
      title="Strategy"
      tone="page"
      {embedded}
      tabsLabel="Strategy views"
      tabs={[{ id: 'editor', label: 'Editor' }, { id: 'options', label: 'Options' }, { id: 'sweep', label: 'Sweep' }, { id: 'portfolio', label: 'Portfolio' }, { id: 'docs', label: 'Docs' }]}
      activeTab={tab}
      onTab={id => { if (id === 'portfolio') openPortfolioTab(); else tab = id; }}
      context={{ symbol, provider, interval, period }}
      onClose={close}
    >
      {#snippet mark()}∿{/snippet}
      {#if tab === 'editor'}<button type="button" class="ot-workbench-ghost quiet" aria-expanded={libraryOpen} aria-controls="strategy-library" onclick={() => (libraryOpen = !libraryOpen)}>Library ({strat.scripts.length})</button>{/if}
    </PanelTopbar>

    <div
      class="body"
      class:sweep-mode={tab === 'sweep' || tab === 'portfolio'}
      class:docs-mode={tab === 'docs'}
      class:options-mode={tab === 'options'}
      class:library-collapsed={!libraryOpen}
    >
      <div class="options-host" hidden={tab !== 'options'}><OptionsPanel {workspaceSymbol} {workspaceSpot} active={open && tab === 'options'} linkRequest={optionsLink} /></div>
      {#if tab === 'docs'}
        <StrategyDocs />
      {:else if tab === 'portfolio'}
        <PortfolioPanel
          code={strat.draftCode}
          {provider}
          {period}
          {interval}
          {portfolio}
          {onOpenRuns}
        />
      {:else if tab === 'sweep'}
        <SweepPanel code={strat.draftCode} {symbol} {provider} {sweep} />
      {:else if tab !== 'options'}
        {#if libraryOpen}<ScriptRail
          id="strategy-library"
          tone="page"
          library={strat}
          signedIn={!!$authState.user}
          copy={{
            label: 'Saved strategies',
            title: 'strategies',
            newLabel: 'New strategy',
            signInHint: 'Sign in to load and save strategies. You can backtest an unsaved draft without an account.',
            empty: 'No saved strategies yet.',
            emptyDetail: 'Draft one on the right and save it.',
            deleteNoun: 'strategy',
            runLabel: 'backtest',
          }}
          onNew={() => void newDraft()}
          onSelect={id => void selectScript(id)}
          onDelete={(id, name) => void confirmDelete(id, name)}
        >
          {#snippet signIn()}
            <button type="button" class="btn ghost" onclick={() => (authDialogOpen = true)}>Sign in</button>
          {/snippet}
        </ScriptRail>{/if}

        <main class="work">
          <div class="work-head">
            <div class="name-wrap">
              <span class="name-prefix" aria-hidden="true">∿</span>
              <input
                class="name-input"
                type="text"
                spellcheck="false"
                autocomplete="off"
                aria-label="Strategy name"
                value={strat.draftName}
                oninput={(e) => strat.setName((e.currentTarget as HTMLInputElement).value)}
              />
              {#if strat.dirty}
                <span class="dirty" title="unsaved changes">●</span>
              {/if}
            </div>

            <div class="editor-views" aria-label="Editor and results views">
              <span title={recoverySavedAt ? `Saved locally ${new Date(recoverySavedAt).toLocaleString()}` : undefined}>{strat.dirty ? recoverySavedAt ? 'Local recovery saved · not saved to account' : 'Unsaved draft · local recovery not confirmed' : strat.activeId ? 'Saved to account' : 'Local starter draft'}</span>
              <div class="view-switch" role="group" aria-label="Visible panes">
                <button type="button" aria-pressed={!splitEnabled && editorView === 'editor'} onclick={() => { splitEnabled = false; editorView = 'editor'; }}>Editor</button>
                <button type="button" aria-pressed={!splitEnabled && editorView === 'results'} onclick={() => { splitEnabled = false; editorView = 'results'; }}>Results</button>
                <button type="button" class="split-view" aria-pressed={splitEnabled} onclick={() => (splitEnabled = true)}>Split view</button>
              </div>
              {#if strat.backtest?.result}<button type="button" class="ot-workbench-ghost quiet" onclick={() => (backtestOpen = true)}>Expand results</button>{/if}
              <span role="status">{strat.isRunning ? 'Running backtest…' : strat.runError ? 'Backtest failed' : resultChanged ? 'Source or context changed · rerun to update' : strat.backtest?.result ? 'Last completed backtest · simulated' : 'No result yet'}</span>
            </div>

            <div class="actions">
              <button type="button" class="btn ghost wide-action" onclick={() => void newDraft()} aria-label="New strategy"><Plus class="h-3.5 w-3.5" /><span>New</span></button>
              {#if onRobustness}<button type="button" class="btn ghost wide-action" onclick={onRobustness} disabled={strat.isRunning || !symbol}>Robustness</button>{/if}
              <button
                type="button"
                class="btn ghost"
                onclick={saveNow}
                disabled={strat.isSaving || !strat.draftName.trim()}
                title="Save (⌘S)"
              >
                <Save class="h-3.5 w-3.5" />
                <span>{strat.isSaving ? 'Saving…' : 'Save'}</span>
              </button>

              <button
                type="button"
                class="btn primary"
                onclick={runNow}
                disabled={strat.isRunning || !symbol}
                title="Run backtest (⌘↵)"
              >
                <Play class="h-3.5 w-3.5" />
                <span>{strat.isRunning ? 'Running…' : 'Backtest'}</span>
              </button>
              <div class="mobile-actions"><Popover.Root bind:open={actionsOpen}>
                <Popover.Trigger class="ot-workbench-ghost min-h-11" aria-label="More strategy actions">More</Popover.Trigger>
                <Popover.Portal><Popover.Content align="end" sideOffset={6} collisionPadding={8} class="z-(--z-popover) flex max-w-[calc(100vw-16px)] flex-col gap-2 rounded border border-border bg-popover p-2 text-popover-foreground shadow-popover">
                  <button type="button" class="btn ghost min-h-11" onclick={() => void selectAction(() => void newDraft())}>New strategy</button>
                  {#if onRobustness}<button type="button" class="btn ghost min-h-11" disabled={strat.isRunning || !symbol} onclick={() => void selectAction(onRobustness)}>Robustness</button>{/if}
                </Popover.Content></Popover.Portal>
              </Popover.Root></div>
            </div>
          </div>

          {#if strat.saveError || strat.isRunning || strat.runError || strat.dataQuality}
            <!-- svelte-ignore a11y_no_noninteractive_tabindex (Scrollable evidence must be keyboard reachable.) -->
            <div class="research-feedback" role="region" aria-label="Strategy feedback" tabindex="0">
              {#if strat.saveError}<ErrorBanner message={strat.saveError} />{/if}
              {#if strat.runError}<ErrorBanner message={strat.runError} />{/if}
              {#if strat.isRunning || strat.runError || strat.dataQuality}<DataQualityEvidence report={strat.dataQuality} pending={strat.isRunning} />{/if}
            </div>
          {/if}

          <div class="editing-panes" class:single={!splitEnabled} class:resizing bind:this={panesEl} style:--editor-share="{editorShare}%">
          <div class="editor-pane" class:inactive={editorView !== 'editor'}>
            <ScriptEditor
              bind:value={() => strat.draftCode, code => strat.setCode(code)}
              documentKey={strat.draftVersion}
              onRun={runNow}
              onSave={saveNow}
            />
          </div>
          <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard-operable splitter.) -->
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions (Keyboard-operable splitter.) -->
          <div class="editor-splitter" role="separator" aria-label="Resize editor and results" aria-orientation="vertical" aria-valuemin="25" aria-valuemax="75" aria-valuenow={Math.round(editorShare)} tabindex="0" onpointerdown={event => { if (event.button !== 0) return; resizing = true; event.currentTarget.setPointerCapture(event.pointerId); resizeEditor(event); }} onpointermove={resizeEditor} onpointerup={() => (resizing = false)} onpointercancel={() => (resizing = false)} onlostpointercapture={() => (resizing = false)} onkeydown={event => { const next = editorShareForKey(event, editorShare); if (next !== null) editorShare = next; }}></div>
          <div class="results-pane" class:inactive={editorView !== 'results'}>
            {#if completedResult === strat.backtest && strat.backtest?.result && completedMarket}
              <p class="completed-context" aria-label="Completed backtest context"><strong>{completedName}</strong> · {completedMarket.symbol} · {completedMarket.provider} · {completedMarket.period} / {completedMarket.interval} · completed <time datetime={strat.backtest.result.meta.finished_at} title={strat.backtest.result.meta.finished_at}>{formatIsoMinute(strat.backtest.result.meta.finished_at)}</time> · simulated</p>
            {/if}
            {#if strat.backtest}
              <BacktestPanel embedded open={true} backtest={strat.backtest} {onOpenRuns} {onCompare} />
            {:else}
              <div class="results-empty"><h2>No backtest results yet</h2><p>Run the current editor draft on the selected market context. Results are simulated; no live orders.</p><button type="button" class="ot-workbench-ghost mt-3" onclick={runNow} disabled={strat.isRunning || !symbol}>Run backtest</button></div>
            {/if}
          </div>
          </div>
        </main>
      {/if}
    </div>
  </div>
{/snippet}

<Dialog.Root open={!embedded && open} onOpenChange={v => { if (!v && !embedded) close(); }}>
  {#if embedded}
    {@render panelContent()}
  {:else}
    <Dialog.Portal disabled={typeof window === 'undefined'}>
      <Dialog.Overlay>
        {#snippet child({ props })}<div {...props} class="backdrop"></div>{/snippet}
      </Dialog.Overlay>
      <Dialog.Content onOpenAutoFocus={() => modal.open(panelEl)} onCloseAutoFocus={() => modal.close()} onEscapeKeydown={e => { if (backtestOpen) e.preventDefault(); }}>
        {#snippet child({ props })}{@render panelContent(props)}{/snippet}
      </Dialog.Content>
    </Dialog.Portal>
  {/if}

  <BacktestPanel bind:open={backtestOpen} backtest={strat.backtest ?? undefined} {onOpenRuns} {onCompare} />
  <AuthDialog bind:open={authDialogOpen} />
</Dialog.Root>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: calc(60 + var(--bits-dialog-depth, 0) * 2);
    background: oklch(var(--background) / 0.55);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    border: 0;
    padding: 0;
    cursor: pointer;
  }

  .panel {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    height: 88vh;
    z-index: calc(61 + var(--bits-dialog-depth, 0) * 2);
    display: flex;
    flex-direction: column;
    color: oklch(var(--foreground));
    background: oklch(var(--card));
    border-top: 1px solid oklch(var(--border-subtle));
    box-shadow:
      0 -30px 60px -20px rgba(0, 0, 0, 0.5),
      0 -1px 0 0 oklch(var(--surface-hover)) inset;
    border-radius: 16px 16px 0 0;
    font-family: var(--font-sans);
    font-size: var(--font-size-body);
    line-height: 20px;
    overflow: hidden;
  }

  .panel.embedded { position: relative; height: 100%; z-index: auto; border-radius: 0; border: 0; box-shadow: none; animation: none; background: oklch(var(--background)); overflow-y: auto; }
  .embedded .body { flex-shrink: 0; min-height: min(600px, 75dvh); }

  .body {
    flex: 1 1 auto;
    min-height: 0;
    display: grid;
    grid-template-columns: 220px minmax(0, 1fr);
  }
  .body.library-collapsed { grid-template-columns: minmax(0, 1fr); }
  /* Options sizes to the panel so its own columns scroll and the payoff stays in view. */
  .body.options-mode { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); overflow: hidden; }
  .embedded .body.options-mode { flex-shrink: 1; min-height: 0; }
  .options-host { min-width: 0; min-height: 0; }
  .options-host[hidden] { display: none; }
  .editor-views { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .editor-views span { color: oklch(var(--muted-foreground)); font-size: var(--font-size-label); }
  .view-switch { display: inline-flex; gap: 2px; padding: 2px; border: 1px solid oklch(var(--border)); border-radius: var(--radius-md); background: oklch(var(--surface-sunken)); }
  .view-switch button { border: 0; border-radius: var(--radius-sm); padding: 4px 12px; background: transparent; color: oklch(var(--muted-foreground)); font: var(--font-size-chrome) var(--font-sans); cursor: pointer; transition: color var(--motion-fast), background var(--motion-fast); }
  .view-switch button:hover { color: oklch(var(--foreground)); }
  .view-switch button[aria-pressed="true"] { background: oklch(var(--accent)); color: oklch(var(--accent-foreground)); font-weight: 600; }
  .editing-panes { display: grid; grid-template-columns: minmax(0, var(--editor-share)) 10px minmax(0, 1fr); min-height: 0; flex: 1; overflow: hidden; }
  .editing-panes.resizing { user-select: none; }
  .embedded .editing-panes { min-height: 240px; flex-shrink: 0; }
  .embedded .work-head, .embedded .editor-views { flex-shrink: 0; }
  .editing-panes.single { grid-template-columns: minmax(0, 1fr); }
  .editing-panes.single .inactive, .editing-panes.single .editor-splitter { display: none; }
  .editor-splitter { cursor: col-resize; touch-action: none; background: oklch(var(--muted)); border-inline: 1px solid oklch(var(--border)); }
  .editor-splitter:hover, .editor-splitter:focus-visible { background: oklch(var(--accent)); outline: 2px solid oklch(var(--ring)); outline-offset: -2px; }
  .results-pane { min-width: 0; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
  .completed-context { padding: 8px 12px; border-bottom: 1px solid oklch(var(--border-subtle)); color: oklch(var(--muted-foreground)); font-size: var(--font-size-label); overflow-wrap: anywhere; }
  .results-empty { padding: 24px; color: oklch(var(--muted-foreground)); font-size: var(--font-size-chrome); }
  .results-empty h2 { color: oklch(var(--foreground)); margin-bottom: 12px; }
  @media (max-width: 1100px) {
    .editing-panes { grid-template-columns: minmax(0, 1fr); }
    .editing-panes .inactive, .editor-splitter { display: none; }
    .split-view { display: none; }
  }
  .body.sweep-mode {
    grid-template-columns: 1fr;
    padding: 14px 18px;
    overflow: hidden;
  }
  .body.docs-mode {
    grid-template-columns: 1fr;
  }

  .work {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .work-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px 12px;
    padding: 8px 18px;
    border-bottom: 1px solid oklch(var(--border-subtle));
    background: oklch(var(--card));
  }
  .name-wrap {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex: 1 1 12rem;
    min-width: 0;
  }
  .name-prefix {
    color: oklch(var(--primary));
    font-size: var(--font-size-body);
  }
  .name-input {
    flex: 1 1 auto;
    min-width: 0;
    background: transparent;
    border: 0;
    border-bottom: 1px solid transparent;
    padding: 4px 0;
    font-family: inherit;
    font-size: var(--font-size-title);
    font-weight: 600;
    color: oklch(var(--foreground));
    letter-spacing: -0.005em;
    outline: none;
    transition: border-color var(--motion-fast);
  }
  .name-input:hover {
    border-bottom-color:
      color-mix(in oklab, oklch(var(--foreground)) 18%, transparent);
  }
  .name-input:focus {
    border-bottom-color: oklch(var(--ring));
  }
  .dirty {
    color: oklch(var(--status-warn));
    font-size: var(--font-size-chrome);
    line-height: 1;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .mobile-actions { display: none; }

  .research-feedback {
    flex: 0 0 auto;
    min-width: 0;
    max-height: min(30dvh, 16rem);
    overflow: auto;
    overflow-wrap: anywhere;
    padding: 6px 12px;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: var(--radius-md);
    border: 1px solid oklch(var(--border));
    background: transparent;
    color: oklch(var(--foreground));
    font-family: inherit;
    font-size: var(--font-size-chrome);
    letter-spacing: var(--tracking-label);
    cursor: pointer;
    transition: all var(--motion-fast);
  }
  .btn:disabled { opacity: var(--opacity-disabled); cursor: not-allowed; }
  .btn.ghost { border-color: transparent; color: oklch(var(--muted-foreground)); }
  .btn.ghost:hover:not(:disabled) {
    color: oklch(var(--foreground));
    background: oklch(var(--surface-hover));
  }
  .btn.primary {
    background: oklch(var(--primary));
    border-color: oklch(var(--primary));
    color: oklch(var(--primary-foreground));
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
  }
  .btn.primary:hover:not(:disabled) {
    background: color-mix(in oklab, oklch(var(--primary)) 94%, oklch(var(--primary-foreground)));
  }
  .btn.primary:active:not(:disabled) { background: color-mix(in oklab, oklch(var(--primary)) 90%, oklch(var(--primary-foreground))); }

  .editor-pane {
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
  }

  @media (max-width: 760px) {
    .body { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); }
    .body:not(.library-collapsed):not(.sweep-mode):not(.docs-mode):not(.options-mode) { grid-template-rows: minmax(80px, 20%) minmax(0, 1fr); }
    .body.sweep-mode, .body.docs-mode { grid-template-rows: minmax(0, 1fr); }
  }

  @media (max-width: 900px) {
    .work-head { flex-wrap: wrap; padding: 8px 12px; }
    .actions { flex-wrap: wrap; }
  }
  @media (max-width: 760px) {
    .work-head { display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px; padding: 4px 12px; }
    .actions { flex-wrap: nowrap; gap: 6px; }
    .actions .btn { min-height: 44px; font-size: var(--font-size-control); }
    .wide-action { display: none; }
    .mobile-actions { display: flex; }
    .editor-views { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 6px; }
    .editor-views .ot-workbench-ghost, .view-switch button { min-height: 44px; }
    .view-switch { grid-column: 1; grid-row: 1 / span 2; }
    .editor-views > button { grid-column: 1 / -1; }
    .editor-views > span { grid-column: 2; font-size: var(--font-size-label); line-height: 14px; }
    .editor-views > span:first-child { grid-row: 1; align-self: end; }
    .editor-views > span[role="status"] { grid-row: 2; align-self: start; }
  }

  .work { min-width: 0; }
  button:focus-visible, input:focus-visible {
    outline: 2px solid oklch(var(--foreground));
    outline-offset: 2px;
  }
  @media (forced-colors: active) {
    button:focus-visible, input:focus-visible { outline-color: Highlight; }
  }

  /* ---------------------------------------------------------------- */
  /* Light theme: pure white chrome, mirroring IndicatorsPanel.        */
  /* ---------------------------------------------------------------- */
</style>

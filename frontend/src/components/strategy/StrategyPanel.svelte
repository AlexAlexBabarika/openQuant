<script lang="ts" module>
  export function editorShareForKey(event: Pick<KeyboardEvent, 'key' | 'preventDefault'>, value: number): number | null {
    const next = event.key === 'ArrowLeft' ? value - 5 : event.key === 'ArrowRight' ? value + 5 : event.key === 'Home' ? 25 : event.key === 'End' ? 75 : null;
    if (next === null) return null;
    event.preventDefault();
    return Math.max(25, Math.min(75, next));
  }
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { authState } from '$lib/features/auth/auth';
  import AuthDialog from '../dialogs/AuthDialog.svelte';
  import { Dialog } from 'bits-ui';
  import { createModalLifecycle } from '$lib/core/modalLifecycle';
  import Plus from '@lucide/svelte/icons/plus';
  import Play from '@lucide/svelte/icons/play';
  import Save from '@lucide/svelte/icons/save';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import X from '@lucide/svelte/icons/x';
  import ScriptEditor from '../indicators/ScriptEditor.svelte';
  import StrategyDocs from './StrategyDocs.svelte';
  import SweepPanel from '../sweep/SweepPanel.svelte';
  import PortfolioPanel from './PortfolioPanel.svelte';
  import BacktestPanel from '../backtest/BacktestPanel.svelte';
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
    tab = $bindable<'editor' | 'sweep' | 'portfolio' | 'docs'>('editor'),
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
    tab?: 'editor' | 'sweep' | 'portfolio' | 'docs';
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
  let panesEl = $state<HTMLDivElement | null>(null);
  let resizing = $state(false);
  let completedSource = $state<string | null>(null);
  let completedContext = $state('');
  let completedName = $state('');
  let completedMarket = $state<{ symbol: string; provider: MarketDataProviderValue; period: string; interval: string } | null>(null);
  let completedResult = $state<StrategyState['backtest']>(null);
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
  onDestroy(() => modal.close());
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
      if (bt.result && accountVersion === runsHistory.accountVersion) runsHistory.record({
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
    if (!confirm(`Delete "${name}"? This cannot be undone.${unsaved}`)) return;
    try {
      await strat.remove(id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  function fmtRelative(iso: string): string {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return '';
    const ms = Date.now() - t;
    const m = Math.round(ms / 60_000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.round(h / 24);
    return `${d}d ago`;
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
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark">∿</span>
        <span class="brand-title">strategy</span>
        <span class="brand-sub">/ workbench</span>
      </div>

      <nav class="tabs" aria-label="Strategy views">
        <button
          type="button"
          class="tab"
          class:active={tab === 'editor'}
          onclick={() => (tab = 'editor')}
        >editor</button>
        <button
          type="button"
          class="tab"
          class:active={tab === 'sweep'}
          onclick={() => (tab = 'sweep')}
        >sweep</button>
        <button
          type="button"
          class="tab"
          class:active={tab === 'portfolio'}
          onclick={openPortfolioTab}
        >portfolio</button>
        <button
          type="button"
          class="tab"
          class:active={tab === 'docs'}
          onclick={() => (tab = 'docs')}
        >docs</button>
      </nav>
      {#if tab === 'editor'}<button type="button" class="ot-workbench-ghost" aria-expanded={libraryOpen} aria-controls="strategy-library" onclick={() => (libraryOpen = !libraryOpen)}>Library ({strat.scripts.length})</button>{/if}

      <div class="ctx" aria-label="Active market context">
        <span class="ctx-label">CTX</span>
        <span class="ctx-pair">
          <span class="ctx-sym">{symbol || '—'}</span>
          <span class="ctx-sep">·</span>
          <span class="ctx-prov">{provider}</span>
          <span class="ctx-sep">·</span>
          <span class="ctx-iv">{interval}</span>
          <span class="ctx-sep">·</span>
          <span class="ctx-pd">{period}</span>
        </span>
      </div>

      <button type="button" class="iconbtn close" onclick={close} aria-label={embedded ? 'Return to chart' : 'Close'}>
        <X class="h-3.5 w-3.5" />
      </button>
    </header>

    <div
      class="body"
      class:sweep-mode={tab === 'sweep' || tab === 'portfolio'}
      class:docs-mode={tab === 'docs'}
      class:library-collapsed={!libraryOpen}
    >
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
      {:else}
        {#if libraryOpen}<aside class="rail" id="strategy-library" aria-label="Saved strategies">
          <div class="rail-head">
            <span class="rail-title">strategies</span>
            <span class="rail-count">{strat.scripts.length}</span>
            <button
              type="button"
              class="iconbtn"
              onclick={() => strat.newDraft()}
              title="New strategy (clears editor)"
              aria-label="New strategy"
            >
              <Plus class="h-3.5 w-3.5" />
            </button>
          </div>

          <div class="rail-list">
            {#if !$authState.user}
              <p class="rail-hint">Sign in to load and save strategies. You can backtest an unsaved draft without an account.</p>
              <button type="button" class="btn ghost" onclick={() => (authDialogOpen = true)}>Sign in</button>
            {:else if strat.loading && strat.scripts.length === 0}
              <p class="rail-hint">loading…</p>
            {:else if strat.loadError}
              <p class="rail-hint err">{strat.loadError}</p>
            {:else if strat.scripts.length === 0}
              <p class="rail-hint">
                no saved strategies yet.<br />
                <span class="dim">draft one on the right and hit save.</span>
              </p>
            {/if}

            {#each ($authState.user ? strat.scripts : []) as s (s.id)}
              <div
                class="rail-item"
                class:active={strat.activeId === s.id}
              >
                <button
                  type="button"
                  class="ri-select"
                  aria-pressed={strat.activeId === s.id}
                  onclick={() => strat.select(s.id)}
                >
                  <span class="ri-name">{s.name}</span>
                  <span class="ri-time">{fmtRelative(s.updated_at)}</span>
                </button>
                <button
                  type="button"
                  class="ri-del"
                  aria-label="Delete strategy {s.name}"
                  onclick={() => void confirmDelete(s.id, s.name)}
                >
                  <Trash2 class="h-3 w-3" />
                </button>
              </div>
            {/each}
          </div>

          <footer class="rail-foot">
            <span class="legend"><span class="kbd">⌘↵</span> backtest</span>
            <span class="legend"><span class="kbd">⌘S</span> save</span>
          </footer>
        </aside>{/if}

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

            <div class="actions">
              <button type="button" class="btn ghost" onclick={() => strat.newDraft()} aria-label="New strategy"><Plus class="h-3.5 w-3.5" /><span>new</span></button>
              {#if onRobustness}<button type="button" class="btn ghost" onclick={onRobustness} disabled={strat.isRunning || !symbol}>robustness</button>{/if}
              {#if strat.saveError}
                <ErrorBanner message={strat.saveError} />
              {/if}
              {#if strat.runError}
                <ErrorBanner message={strat.runError} />
              {/if}

              <button
                type="button"
                class="btn ghost"
                onclick={saveNow}
                disabled={strat.isSaving || !strat.draftName.trim()}
                title="Save (⌘S)"
              >
                <Save class="h-3.5 w-3.5" />
                <span>{strat.isSaving ? 'saving…' : 'save'}</span>
              </button>

              <button
                type="button"
                class="btn primary"
                onclick={runNow}
                disabled={strat.isRunning || !symbol}
                title="Run backtest (⌘↵)"
              >
                <Play class="h-3.5 w-3.5" />
                <span>{strat.isRunning ? 'running…' : 'backtest'}</span>
              </button>
            </div>
          </div>

          <div class="editor-views" class:single={!splitEnabled} aria-label="Editor and results views">
            <span title={recoverySavedAt ? `Saved locally ${new Date(recoverySavedAt).toLocaleString()}` : undefined}>{strat.dirty ? recoverySavedAt ? 'Local recovery saved · not saved to account' : 'Unsaved draft · local recovery not confirmed' : strat.activeId ? 'Saved to account' : 'Local starter draft'}</span>
            <button type="button" class="compact-view ot-workbench-ghost" aria-pressed={editorView === 'editor'} onclick={() => (editorView = 'editor')}>Editor</button>
            <button type="button" class="compact-view ot-workbench-ghost" aria-pressed={editorView === 'results'} onclick={() => (editorView = 'results')}>Results</button>
            <button type="button" class="split-view ot-workbench-ghost" aria-pressed={splitEnabled} onclick={() => (splitEnabled = !splitEnabled)}>Split view</button>
            {#if strat.backtest?.result}<button type="button" class="ot-workbench-ghost" onclick={() => (backtestOpen = true)}>Expand results</button>{/if}
            <span role="status">{strat.isRunning ? 'Running backtest…' : strat.runError ? 'Backtest failed' : resultChanged ? 'Source or context changed · rerun to update' : strat.backtest?.result ? 'Last completed backtest · simulated' : 'No result yet'}</span>
          </div>
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
              <p class="completed-context" aria-label="Completed backtest context"><strong>{completedName}</strong> · {completedMarket.symbol} · {completedMarket.provider} · {completedMarket.period} / {completedMarket.interval}<br />Completed {strat.backtest.result.meta.finished_at} · simulated</p>
            {/if}
            {#if strat.backtest}
              <BacktestPanel embedded open={true} backtest={strat.backtest} {onOpenRuns} {onCompare} />
            {:else}
              <div class="results-empty"><h2>No backtest results yet</h2><p>Run the current editor draft on the selected market context. Results are simulated; no live orders.</p></div>
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
    animation: fadeIn 180ms ease;
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
    background:
      radial-gradient(
        1200px 600px at 20% -200px,
        color-mix(in oklab, oklch(var(--primary)) 18%, transparent),
        transparent 60%
      ),
      color-mix(in oklab, oklch(var(--popover)) 96%, black 4%);
    border-top: 1px solid color-mix(in oklab, oklch(var(--border)) 100%, transparent);
    box-shadow:
      0 -30px 60px -20px rgba(0, 0, 0, 0.5),
      0 -1px 0 0 color-mix(in oklab, oklch(var(--foreground)) 8%, transparent) inset;
    border-radius: 16px 16px 0 0;
    font-family: 'Space Mono', ui-monospace, SFMono-Regular, monospace;
    overflow: hidden;
    animation: slideUp 280ms cubic-bezier(0.18, 0.9, 0.24, 1);
  }

  .panel.embedded { position: relative; height: 100%; z-index: auto; border-radius: 0; border: 0; box-shadow: none; animation: none; background: oklch(var(--background)); }

  @keyframes slideUp {
    from { transform: translateY(24px); opacity: 0; }
    to   { transform: translateY(0);    opacity: 1; }
  }
  @keyframes fadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  .topbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 16px;
    padding: 14px 22px;
    border-bottom: 1px dashed color-mix(in oklab, oklch(var(--border)) 90%, transparent);
    background: color-mix(in oklab, oklch(var(--popover)) 100%, transparent);
  }

  .brand {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 13px;
    letter-spacing: 0.04em;
  }
  .brand-mark {
    color: oklch(var(--primary));
    font-size: 14px;
    transform: translateY(1px);
  }
  .brand-title { font-weight: 700; }
  .brand-sub {
    color: oklch(var(--muted-foreground));
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .ctx {
    margin-left: auto;
    justify-self: center;
    display: inline-flex;
    align-items: baseline;
    gap: 10px;
    padding: 4px 10px;
    border: 1px dashed color-mix(in oklab, oklch(var(--border)) 90%, transparent);
    border-radius: 999px;
    font-size: 11px;
    letter-spacing: 0.04em;
    color: oklch(var(--muted-foreground));
    background: color-mix(in oklab, oklch(var(--background)) 70%, black 30%);
  }
  .ctx-label {
    font-size: 9.5px;
    letter-spacing: 0.18em;
    color: color-mix(in oklab, oklch(var(--foreground)) 50%, transparent);
  }
  .ctx-pair {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
  }
  .ctx-sym {
    color: oklch(var(--foreground));
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .ctx-sep { color: color-mix(in oklab, oklch(var(--foreground)) 25%, transparent); }
  .ctx-prov, .ctx-iv, .ctx-pd { font-size: 10.5px; }

  .iconbtn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px; height: 26px;
    border: 1px solid color-mix(in oklab, oklch(var(--border)) 100%, transparent);
    border-radius: 4px;
    background: transparent;
    color: oklch(var(--muted-foreground));
    cursor: pointer;
    transition: all 120ms ease;
  }
  .iconbtn:hover {
    color: oklch(var(--foreground));
    border-color: color-mix(in oklab, oklch(var(--primary)) 50%, transparent);
    background: color-mix(in oklab, oklch(var(--primary)) 10%, transparent);
  }
  .iconbtn.close:hover {
    border-color: color-mix(in oklab, #ff7373 60%, transparent);
    color: #ff9c9c;
    background: color-mix(in oklab, #ff7373 12%, transparent);
  }

  .tabs {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    border: 1px solid color-mix(in oklab, oklch(var(--border)) 100%, transparent);
    border-radius: 4px;
    background: color-mix(in oklab, oklch(var(--background)) 70%, black 30%);
  }
  .tab {
    appearance: none;
    border: 0;
    padding: 4px 12px;
    font-family: inherit;
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: lowercase;
    color: oklch(var(--muted-foreground));
    background: transparent;
    border-radius: 3px;
    cursor: pointer;
    transition: all 120ms ease;
  }
  .tab:hover { color: oklch(var(--foreground)); }
  .tab.active {
    color: oklch(var(--primary-foreground));
    background: oklch(var(--primary));
    font-weight: 700;
  }

  .body {
    flex: 1 1 auto;
    min-height: 0;
    display: grid;
    grid-template-columns: 220px minmax(0, 1fr);
  }
  .body.library-collapsed { grid-template-columns: minmax(0, 1fr); }
  .editor-views { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 6px 12px; border-bottom: 1px solid oklch(var(--border)); }
  .editor-views span { color: oklch(var(--muted-foreground)); font-size: 11px; }
  .compact-view { display: none; }
  .single .compact-view { display: inline-flex; }
  .split-view[aria-pressed="true"] { border-color: oklch(var(--primary)); color: oklch(var(--foreground)); }
  .editing-panes { display: grid; grid-template-columns: minmax(0, var(--editor-share)) 10px minmax(0, 1fr); min-height: 0; flex: 1; overflow: hidden; }
  .editing-panes.resizing { user-select: none; }
  .editing-panes.single { grid-template-columns: minmax(0, 1fr); }
  .editing-panes.single .inactive, .editing-panes.single .editor-splitter { display: none; }
  .editor-splitter { cursor: col-resize; touch-action: none; background: oklch(var(--muted)); border-inline: 1px solid oklch(var(--border)); }
  .editor-splitter:hover, .editor-splitter:focus-visible { background: oklch(var(--primary)); outline: 2px solid oklch(var(--foreground)); outline-offset: -2px; }
  .results-pane { min-width: 0; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
  .completed-context { padding: 8px 12px; border-bottom: 1px solid oklch(var(--border)); color: oklch(var(--muted-foreground)); font-size: 11px; overflow-wrap: anywhere; }
  .results-empty { padding: 24px; color: oklch(var(--muted-foreground)); font-size: 12px; }
  .results-empty h2 { color: oklch(var(--foreground)); margin-bottom: 12px; }
  @media (max-width: 1100px) {
    .editing-panes { grid-template-columns: minmax(0, 1fr); }
    .editing-panes .inactive, .editor-splitter { display: none; }
    .compact-view { display: inline-flex; }
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

  .rail {
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-right: 1px solid color-mix(in oklab, oklch(var(--border)) 100%, transparent);
    background:
      linear-gradient(
        180deg,
        color-mix(in oklab, oklch(var(--popover)) 100%, black 4%),
        color-mix(in oklab, oklch(var(--popover)) 100%, black 10%)
      );
  }
  .rail-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 14px 16px 10px;
    font-size: 10.5px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: oklch(var(--muted-foreground));
    border-bottom: 1px dashed
      color-mix(in oklab, oklch(var(--border)) 90%, transparent);
  }
  .rail-title { font-weight: 700; color: oklch(var(--foreground)); }
  .rail-count {
    margin-left: 2px;
    padding: 1px 6px;
    border: 1px solid color-mix(in oklab, oklch(var(--border)) 100%, transparent);
    border-radius: 999px;
    font-size: 9.5px;
    color: oklch(var(--muted-foreground));
  }
  .rail-head .iconbtn { margin-left: auto; }

  .rail-list {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: 8px 8px;
  }
  .rail-hint {
    margin: 12px 12px;
    font-size: 11.5px;
    line-height: 1.5;
    color: oklch(var(--muted-foreground));
  }
  .rail-hint .dim { color: oklch(var(--muted-foreground)); }
  .rail-hint.err { color: #ff7373; }

  .rail-item {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    padding: 8px 10px;
    margin: 0 0 2px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: transparent;
    color: oklch(var(--foreground));
    text-align: left;
    cursor: pointer;
    font-family: inherit;
    transition: background 120ms ease, border-color 120ms ease;
  }
  .rail-item:hover {
    background: color-mix(in oklab, oklch(var(--foreground)) 5%, transparent);
  }
  .rail-item.active {
    background: color-mix(in oklab, oklch(var(--primary)) 8%, transparent);
    border-color: transparent;
  }
  .rail-item.active::before {
    content: '';
    position: absolute;
    left: -1px;
    top: 50%;
    transform: translateY(-50%);
    width: 2px;
    height: 60%;
    background: oklch(var(--primary));
    border-radius: 0 2px 2px 0;
    pointer-events: none;
  }
  .ri-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12.5px;
  }
  .ri-time {
    font-size: 10px;
    color: color-mix(in oklab, oklch(var(--foreground)) 40%, transparent);
    letter-spacing: 0.04em;
  }
  .ri-del {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px; height: 22px;
    margin-left: 4px;
    color: color-mix(in oklab, oklch(var(--foreground)) 35%, transparent);
    border-radius: 3px;
    cursor: pointer;
    opacity: 0;
    transition: opacity 120ms, color 120ms, background 120ms;
  }
  .rail-item:hover .ri-del { opacity: 1; }
  .ri-del:hover {
    color: #ff9c9c;
    background: color-mix(in oklab, #ff7373 14%, transparent);
  }

  .rail-foot {
    display: flex;
    gap: 12px;
    padding: 10px 16px;
    border-top: 1px dashed color-mix(in oklab, oklch(var(--border)) 90%, transparent);
    font-size: 10px;
    letter-spacing: 0.06em;
    color: oklch(var(--muted-foreground));
  }
  .legend { display: inline-flex; align-items: center; gap: 6px; }
  .kbd {
    padding: 1px 5px;
    border: 1px solid color-mix(in oklab, oklch(var(--border)) 100%, transparent);
    border-radius: 3px;
    font-size: 10px;
    color: oklch(var(--foreground));
    background: color-mix(in oklab, oklch(var(--foreground)) 4%, transparent);
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
    gap: 12px;
    padding: 12px 18px;
    border-bottom: 1px solid color-mix(in oklab, oklch(var(--border)) 100%, transparent);
    background: color-mix(in oklab, oklch(var(--popover)) 100%, transparent);
  }
  .name-wrap {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex: 1 1 auto;
    min-width: 0;
  }
  .name-prefix {
    color: oklch(var(--primary));
    font-size: 14px;
  }
  .name-input {
    flex: 1 1 auto;
    min-width: 0;
    background: transparent;
    border: 0;
    border-bottom: 1px solid transparent;
    padding: 4px 0;
    font-family: inherit;
    font-size: 16px;
    font-weight: 700;
    color: oklch(var(--foreground));
    letter-spacing: -0.005em;
    outline: none;
    transition: border-color 120ms ease;
  }
  .name-input:hover {
    border-bottom-color:
      color-mix(in oklab, oklch(var(--foreground)) 18%, transparent);
  }
  .name-input:focus {
    border-bottom-color:
      color-mix(in oklab, oklch(var(--primary)) 80%, transparent);
  }
  .dirty {
    color: oklch(var(--primary));
    font-size: 12px;
    line-height: 1;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 4px;
    border: 1px solid color-mix(in oklab, oklch(var(--border)) 100%, transparent);
    background: transparent;
    color: oklch(var(--foreground));
    font-family: inherit;
    font-size: 11.5px;
    letter-spacing: 0.04em;
    text-transform: lowercase;
    cursor: pointer;
    transition: all 120ms ease;
  }
  .btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .btn.ghost:hover:not(:disabled) {
    border-color: color-mix(in oklab, oklch(var(--foreground)) 35%, transparent);
    background: color-mix(in oklab, oklch(var(--foreground)) 6%, transparent);
  }
  .btn.primary {
    background: oklch(var(--primary));
    border-color: oklch(var(--primary));
    color: oklch(var(--primary-foreground));
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  .btn.primary:hover:not(:disabled) {
    box-shadow: 0 6px 18px -6px color-mix(in oklab, oklch(var(--primary)) 60%, transparent);
    transform: translateY(-1px);
  }
  .btn.primary:active:not(:disabled) { transform: translateY(0); }

  .editor-pane {
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
  }

  @media (max-width: 760px) {
    .body { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); }
    .body:not(.library-collapsed):not(.sweep-mode):not(.docs-mode) { grid-template-rows: minmax(80px, 20%) minmax(0, 1fr); }
    .body.sweep-mode, .body.docs-mode { grid-template-rows: minmax(0, 1fr); }
    .rail { border-bottom: 1px solid oklch(var(--border)); }
    .rail-head { padding: 8px 12px; }
    .rail-foot { display: none; }
  }

  @media (max-width: 900px) {
    .topbar { display: flex; flex-wrap: wrap; gap: 8px; padding: 10px 12px; }
    .topbar .close { margin-left: auto; }
    .ctx { flex-wrap: wrap; }
    .work-head { flex-wrap: wrap; padding: 8px 12px; }
    .actions { flex-wrap: wrap; }
  }

  .work { min-width: 0; }
  .ri-select {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
    border: 0;
    padding: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .ri-del { border: 0; padding: 0; background: transparent; opacity: 1; }
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
  :global(html:not(.dark)) .panel:not(.embedded) {
    background: #ffffff;
    box-shadow:
      0 -1px 0 0 #000 inset,
      0 -8px 24px -16px rgba(0, 0, 0, 0.18);
    border-top: 1px solid #000;
  }
  :global(html:not(.dark)) .topbar {
    background: #ffffff;
    border-bottom: 1px dashed #000;
  }
  :global(html:not(.dark)) .ctx {
    background: #ffffff;
    border-color: #000;
    color: #000;
  }
  :global(html:not(.dark)) .ctx-label,
  :global(html:not(.dark)) .ctx-sep {
    color: #000;
    opacity: 0.55;
  }
  :global(html:not(.dark)) .tabs {
    background: #ffffff;
    border-color: #000;
  }
  :global(html:not(.dark)) .tab { color: #000; opacity: 0.5; }
  :global(html:not(.dark)) .tab:hover { opacity: 1; }
  :global(html:not(.dark)) .tab.active { opacity: 1; }
  :global(html:not(.dark)) .iconbtn {
    border-color: #000;
    color: #000;
  }
  :global(html:not(.dark)) .iconbtn:hover {
    background: #000;
    color: #fff;
    border-color: #000;
  }
  :global(html:not(.dark)) .rail {
    background: #ffffff;
    border-right: 1px solid #000;
  }
  :global(html:not(.dark)) .rail-head {
    border-bottom: 1px dashed #000;
    color: #000;
  }
  :global(html:not(.dark)) .rail-count {
    border-color: #000;
    color: #000;
  }
  :global(html:not(.dark)) .rail-foot {
    border-top: 1px dashed #000;
    color: #000;
  }
  :global(html:not(.dark)) .kbd {
    background: #ffffff;
    border-color: #000;
    color: #000;
  }
  :global(html:not(.dark)) .work-head {
    background: #ffffff;
    border-bottom: 1px solid #000;
  }
  :global(html:not(.dark)) .btn {
    background: #ffffff;
    border-color: #000;
    color: #000;
  }
  :global(html:not(.dark)) .btn.ghost:hover:not(:disabled) {
    background: #000;
    border-color: #000;
    color: #fff;
  }
</style>

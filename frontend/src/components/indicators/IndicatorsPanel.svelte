<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { authState } from '$lib/features/auth/auth';
  import AuthDialog from '../dialogs/AuthDialog.svelte';
  import { Dialog } from 'bits-ui';
  import { createModalLifecycle } from '$lib/core/modalLifecycle';
  import Plus from '@lucide/svelte/icons/plus';
  import Play from '@lucide/svelte/icons/play';
  import Square from '@lucide/svelte/icons/square';
  import Save from '@lucide/svelte/icons/save';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import X from '@lucide/svelte/icons/x';
  import ScriptEditor from './ScriptEditor.svelte';
  import ScriptOutputs from './ScriptOutputs.svelte';
  import ScriptDocs from './ScriptDocs.svelte';
  import ErrorBanner from '../ErrorBanner.svelte';
  import { IndicatorState } from '$lib/features/indicators/indicatorState.svelte';
  import type { MarketDataProviderValue } from '$lib/features/market/marketDataProviders';

  let {
    open = $bindable(false),
    symbol,
    provider,
    period,
    interval,
    indicators,
    splitPct = $bindable(60),
    recoverySavedAt = null,
    tab = $bindable<'editor' | 'docs'>('editor'),
  }: {
    open?: boolean;
    symbol: string;
    provider: MarketDataProviderValue;
    period: string;
    interval: string;
    indicators: IndicatorState;
    splitPct?: number;
    recoverySavedAt?: string | null;
    tab?: 'editor' | 'docs';
  } = $props();

  const ind = $derived(indicators);

  let libraryOpen = $state(untrack(() => ind.scripts.length > 0));
  let dragging = $state(false);
  let panelEl = $state<HTMLDivElement | null>(null);

  let authDialogOpen = $state(false);
  let savedUserId: string | null = null;
  $effect(() => {
    const userId = $authState.user?.id ?? null;
    if (userId !== savedUserId) untrack(() => {
      savedUserId = userId;
      ind.clearSaved();
    });
    if (open && userId) untrack(() => { void ind.refresh(); });
  });


  const modal = createModalLifecycle();
  onDestroy(() => modal.close());

  function close() {
    open = false;
  }


  function startDrag(e: PointerEvent) {
    if (!panelEl) return;
    dragging = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function moveDrag(e: PointerEvent) {
    if (!dragging || !panelEl) return;
    const rect = panelEl.getBoundingClientRect();
    const pct = ((e.clientY - rect.top) / rect.height) * 100;
    splitPct = Math.min(82, Math.max(22, pct));
  }
  function endDrag(e: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    const target = e.currentTarget as HTMLElement;
    if (target.hasPointerCapture(e.pointerId))
      target.releasePointerCapture(e.pointerId);
  }

  async function runNow() {
    if (ind.activeId && !$authState.user) { authDialogOpen = true; return; }
    await ind.run({ symbol, provider, period, interval });
  }

  function stopNow() {
    if (ind.activeId) ind.stop(ind.activeId);
  }

  async function toggleScriptRun(id: string) {
    if (!$authState.user) { authDialogOpen = true; return; }
    if (ind.runners[id]) {
      ind.stop(id);
      return;
    }
    if (id === ind.activeId) {
      await runNow();
      return;
    }
    await ind.start(id, { symbol, provider, period, interval });
  }

  async function saveNow() {
    if (!$authState.user) { authDialogOpen = true; return; }
    await ind.save();
  }

  async function saveAndRun() {
    if (!$authState.user) { authDialogOpen = true; return; }
    await ind.saveAndRun({ symbol, provider, period, interval });
  }

  async function confirmDelete(id: string, name: string) {
    if (!$authState.user) { authDialogOpen = true; return; }
    const unsaved = ind.activeId === id && ind.dirty
      ? ' Unsaved changes will be discarded.'
      : '';
    if (!confirm(`Delete "${name}"? This cannot be undone.${unsaved}`)) return;
    try {
      await ind.delete(id);
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

<Dialog.Root {open} onOpenChange={v => { if (!v) close(); }}>
  <Dialog.Portal disabled={typeof window === 'undefined'}>
    <Dialog.Overlay>
      {#snippet child({ props })}
        <div {...props} class="backdrop"></div>
      {/snippet}
    </Dialog.Overlay>
    <Dialog.Content
      onOpenAutoFocus={() => modal.open(panelEl)}
      onCloseAutoFocus={() => modal.close()}
      onEscapeKeydown={e => { if (dragging) e.preventDefault(); }}
    >
    {#snippet child({ props })}
  <div {...props}
    bind:this={panelEl}
    class="panel"
    role="dialog"
    aria-modal="true"
    aria-label="Indicators workbench"
  >
    <!-- <span class="corner tl" aria-hidden="true"></span>
    <span class="corner tr" aria-hidden="true"></span> -->

    <header class="topbar">
      <div class="brand">
        <span class="brand-mark">▣</span>
        <span class="brand-title">indicators</span>
        <span class="brand-sub">/ workbench</span>
      </div>

      <nav class="tabs" aria-label="Workbench tabs">
        <button
          type="button"
          class="tab"
          class:active={tab === 'editor'}
          onclick={() => (tab = 'editor')}
        >editor</button>
        <button
          type="button"
          class="tab"
          class:active={tab === 'docs'}
          onclick={() => (tab = 'docs')}
        >docs</button>
      </nav>
      {#if tab === 'editor'}<button type="button" class="ot-workbench-ghost" aria-expanded={libraryOpen} aria-controls="indicator-library" onclick={() => (libraryOpen = !libraryOpen)}>Library ({ind.scripts.length})</button>{/if}

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

      <button type="button" class="iconbtn close" onclick={close} aria-label="Close">
        <X class="h-3.5 w-3.5" />
      </button>
    </header>

    <div class="body" class:docs-mode={tab === 'docs'} class:library-collapsed={!libraryOpen}>
      {#if tab === 'docs'}
        <ScriptDocs />
      {:else}
      {#if libraryOpen}<aside class="rail" id="indicator-library" aria-label="Saved scripts">
        <div class="rail-head">
          <span class="rail-title">scripts</span>
          <span class="rail-count">{ind.scripts.length}</span>
          <button
            type="button"
            class="iconbtn"
            onclick={() => ind.newDraft()}
            title="New indicator (clears editor)"
            aria-label="New indicator"
          >
            <Plus class="h-3.5 w-3.5" />
          </button>
        </div>

        <div class="rail-list">
          {#if !$authState.user}
            <p class="rail-hint">Sign in to load and save indicators. You can run an unsaved draft without an account.</p>
            <button type="button" class="btn ghost" onclick={() => (authDialogOpen = true)}>Sign in</button>
          {:else if ind.loading && ind.scripts.length === 0}
            <p class="rail-hint">loading…</p>
          {:else if ind.loadError}
            <p class="rail-hint err">{ind.loadError}</p>
          {:else if ind.scripts.length === 0}
            <p class="rail-hint">
              no saved scripts yet.<br />
              <span class="dim">draft something on the right and hit save.</span>
            </p>
          {/if}

          {#each ($authState.user ? ind.scripts : []) as s (s.id)}
            <div
              class="rail-item"
              class:active={ind.activeId === s.id}
            >
              <button
                type="button"
                class="ri-status"
                class:running={ind.isRunningOk(s.id)}
                aria-label={`${ind.runners[s.id] ? 'Stop' : 'Start'} script ${s.name}`}
                title={ind.runners[s.id] ? 'stop script' : 'start script'}
                onclick={() => void toggleScriptRun(s.id)}
              ></button>
              <button
                type="button"
                class="ri-select"
                aria-pressed={ind.activeId === s.id}
                onclick={() => ind.openScript(s.id)}
              >
                <span class="ri-name">{s.name}</span>
                <span class="ri-time">{fmtRelative(s.updated_at)}</span>
              </button>
              <button
                type="button"
                class="ri-del"
                aria-label="Delete script {s.name}"
                onclick={() => void confirmDelete(s.id, s.name)}
              >
                <Trash2 class="h-3 w-3" />
              </button>
            </div>
          {/each}
        </div>

        <footer class="rail-foot">
          <span class="legend"><span class="kbd">⌘↵</span> run</span>
          <span class="legend"><span class="kbd">⌘S</span> save</span>
        </footer>
      </aside>{/if}

      <main class="work">
        <div class="work-head">
          <div class="name-wrap">
            <span class="name-prefix" aria-hidden="true">∷</span>
            <input
              class="name-input"
              type="text"
              spellcheck="false"
              autocomplete="off"
              aria-label="Script name"
              value={ind.draftName}
              oninput={(e) => ind.setName((e.currentTarget as HTMLInputElement).value)}
            />
            {#if ind.dirty}
              <span class="dirty" title="unsaved changes">●</span>
            {/if}
          </div>

          <div class="actions">
            <button type="button" class="btn ghost" onclick={() => ind.newDraft()} aria-label="New indicator"><Plus class="h-3.5 w-3.5" /><span>new</span></button>
            {#if ind.saveError}
              <ErrorBanner message={ind.saveError} />
            {/if}

            <button
              type="button"
              class="btn ghost"
              onclick={saveNow}
              disabled={ind.isSaving || !ind.draftName.trim()}
              title="Save (⌘S)"
            >
              <Save class="h-3.5 w-3.5" />
              <span>{ind.isSaving ? 'saving…' : 'save'}</span>
            </button>

            <button
              type="button"
              class="btn ghost"
              onclick={saveAndRun}
              disabled={ind.isSaving || ind.isRunning || !ind.draftName.trim()}
              title="Save & run"
            >
              <span>save &amp; run</span>
            </button>

            {#if ind.runningId && ind.runningId === ind.activeId}
              <button
                type="button"
                class="btn primary stop"
                onclick={stopNow}
                title="Stop"
              >
                <Square class="h-3.5 w-3.5" />
                <span>stop</span>
              </button>
            {:else}
              <button
                type="button"
                class="btn primary"
                onclick={runNow}
                disabled={ind.isRunning || !symbol}
                title="Run (⌘↵)"
              >
                <Play class="h-3.5 w-3.5" />
                <span>{ind.isRunning ? 'running…' : 'run'}</span>
              </button>
            {/if}
          </div>
        </div>

        <p class="px-3 py-1 text-xs text-muted-foreground" title={recoverySavedAt ? `Saved locally ${new Date(recoverySavedAt).toLocaleString()}` : undefined}>{ind.dirty ? recoverySavedAt ? 'Local recovery saved · not saved to account' : 'Unsaved draft · local recovery not confirmed' : ind.activeId ? 'Saved to account' : 'Local starter draft'}</p>
        <div class="split" style:--top="{splitPct}%">
          <div class="pane editor-pane">
            <ScriptEditor
              bind:value={() => ind.draftCode, code => ind.setCode(code)}
              documentKey={ind.draftVersion}
              onRun={runNow}
              onSave={saveNow}
            />
          </div>

          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <div
            class="splitter"
            class:dragging
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize editor and output"
            tabindex="0"
            onpointerdown={startDrag}
            onpointermove={moveDrag}
            onpointerup={endDrag}
            onpointercancel={endDrag}
            onkeydown={(e) => {
              if (e.key === 'ArrowUp') splitPct = Math.max(22, splitPct - 4);
              else if (e.key === 'ArrowDown') splitPct = Math.min(82, splitPct + 4);
            }}
          >
            <span class="grip" aria-hidden="true">
              <i></i><i></i><i></i><i></i><i></i>
            </span>
          </div>

          <div class="pane output-pane">
            <ScriptOutputs
              result={ind.lastResult}
              runError={ind.runError}
              isRunning={ind.isRunning}
              projected={ind.runningOutputs.some(script => script.scriptId === ind.activeId)}
            />
          </div>
        </div>
      </main>
      {/if}
    </div>
  </div>
    {/snippet}
    </Dialog.Content>
  </Dialog.Portal>
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
  }

  .corner {
    position: absolute;
    width: 18px;
    height: 18px;
    pointer-events: none;
    color: color-mix(in oklab, oklch(var(--foreground)) 35%, transparent);
  }
  .corner.tl { top: 12px; left: 12px; border-top: 1px solid currentColor; border-left: 1px solid currentColor; }
  .corner.tr { top: 12px; right: 12px; border-top: 1px solid currentColor; border-right: 1px solid currentColor; }

  .topbar {
    display: grid;
    grid-template-columns: auto auto 1fr auto;
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
    grid-template-columns: 280px 1fr;
  }
  .body.docs-mode {
    grid-template-columns: 1fr;
  }
  .body.library-collapsed { grid-template-columns: minmax(0, 1fr); }

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
    grid-template-columns: 14px minmax(0, 1fr) auto;
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
  .ri-status {
    border: 0;
    padding: 0;
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: #ef4444;
    box-shadow: 0 0 0 2px color-mix(in oklab, #ef4444 22%, transparent);
    transition: background 120ms ease, box-shadow 120ms ease, transform 120ms ease;
    align-self: center;
    justify-self: center;
    cursor: pointer;
  }
  .ri-status:hover {
    transform: scale(1.25);
  }
  .ri-status.running {
    background: #22c55e;
    box-shadow: 0 0 0 2px color-mix(in oklab, #22c55e 28%, transparent);
    animation: pulseDot 1.6s ease-in-out infinite;
  }
  @keyframes pulseDot {
    0%, 100% { box-shadow: 0 0 0 2px color-mix(in oklab, #22c55e 22%, transparent); }
    50% { box-shadow: 0 0 0 4px color-mix(in oklab, #22c55e 32%, transparent); }
  }
  .ri-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12.5px;
  }
  .ri-time {
    font-size: 10px;
    color: oklch(var(--muted-foreground));
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
  .btn.primary.stop {
    background: #ef4444;
    border-color: #ef4444;
    color: #fff;
  }
  .btn.primary.stop:hover:not(:disabled) {
    box-shadow: 0 6px 18px -6px color-mix(in oklab, #ef4444 60%, transparent);
  }

  .split {
    flex: 1 1 auto;
    min-height: 0;
    display: grid;
    grid-template-rows: var(--top) 8px 1fr;
  }
  .pane { min-height: 0; overflow: hidden; }
  .splitter {
    position: relative;
    cursor: ns-resize;
    background: color-mix(in oklab, oklch(var(--popover)) 100%, black 8%);
    border-top: 1px solid color-mix(in oklab, oklch(var(--border)) 100%, transparent);
    border-bottom: 1px solid color-mix(in oklab, oklch(var(--border)) 100%, transparent);
    user-select: none;
    touch-action: none;
  }
  .splitter:hover, .splitter.dragging {
    background: color-mix(in oklab, oklch(var(--primary)) 12%, transparent);
  }
  .grip {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    display: inline-flex;
    gap: 3px;
  }
  .grip i {
    display: inline-block;
    width: 3px;
    height: 3px;
    border-radius: 999px;
    background: color-mix(in oklab, oklch(var(--foreground)) 30%, transparent);
  }
  .splitter:hover .grip i, .splitter.dragging .grip i {
    background: oklch(var(--primary));
  }

  @media (max-width: 760px) {
    .body { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); }
    .body:not(.library-collapsed):not(.docs-mode) { grid-template-rows: minmax(80px, 20%) minmax(0, 1fr); }
    .body.docs-mode { grid-template-rows: minmax(0, 1fr); }
    .rail { border-bottom: 1px solid oklch(var(--border)); }
    .rail-head { padding: 8px 12px; }
    .rail-foot { display: none; }
  }

  @media (max-width: 900px) {
    .topbar { display: flex; flex-wrap: wrap; gap: 8px; padding: 10px 12px; }
    .topbar .close { margin-left: auto; }
    .ctx, .ctx-pair { flex-wrap: wrap; }
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
  /* Light theme: pure white chrome, no greys, no top vignette.       */
  /* The default styles above target dark mode; this block strips the */
  /* radial-gradient halo, the heavy upward box-shadow, and every     */
  /* color-mix(...black...) grey wash from the panel surfaces.        */
  /* ---------------------------------------------------------------- */
  :global(html:not(.dark)) .panel {
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
  :global(html:not(.dark)) .rail-hint.err {
    color: oklch(var(--destructive));
  }
  :global(html:not(.dark)) .ri-status.running {
    background: oklch(var(--primary));
    box-shadow: 0 0 0 2px
      color-mix(in oklab, oklch(var(--primary)) 22%, transparent);
  }
  :global(html:not(.dark)) .ri-del {
    color: #000;
  }
  :global(html:not(.dark)) .ri-del:hover {
    background: #000;
    color: #fff;
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
  :global(html:not(.dark)) .splitter {
    background: #ffffff;
    border-top: 1px solid #000;
    border-bottom: 1px solid #000;
  }
  :global(html:not(.dark)) .splitter:hover,
  :global(html:not(.dark)) .splitter.dragging {
    background: color-mix(in oklab, oklch(var(--primary)) 14%, #ffffff);
  }
  :global(html:not(.dark)) .grip i {
    background: #000;
  }
</style>

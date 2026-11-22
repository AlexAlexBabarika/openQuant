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
  import PanelTopbar from '../layout/PanelTopbar.svelte';
  import ScriptRail from '$lib/features/scripts/ScriptRail.svelte';
  import { confirmAction, confirmDiscard } from '$lib/features/confirm/confirm.svelte';
  import Activity from '@lucide/svelte/icons/activity';
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
    if (open && userId) untrack(() => { void ind.load(); });
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
    if (!(await confirmAction({ title: `Delete "${name}"?`, description: `This cannot be undone.${unsaved}`, confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await ind.remove(id);
    } catch (err) {
      void confirmAction({ title: `Could not delete "${name}"`, description: err instanceof Error ? err.message : 'Delete failed', acknowledge: true });
    }
  }

  async function newDraft() {
    if (await confirmDiscard(ind.dirty, 'indicator')) ind.newDraft(() => true);
  }

  async function openScript(id: string) {
    if (id === ind.activeId) return;
    if (await confirmDiscard(ind.dirty, 'indicator')) ind.select(id, () => true);
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

    <PanelTopbar
      title="Indicators"
      tabs={[{ id: 'editor', label: 'Editor' }, { id: 'docs', label: 'Docs' }]}
      activeTab={tab}
      onTab={id => (tab = id)}
      context={{ symbol, provider, interval, period }}
      onClose={close}
    >
      {#snippet mark()}<Activity class="h-3.5 w-3.5" />{/snippet}
      {#if tab === 'editor'}<button type="button" class="ot-workbench-ghost quiet" aria-expanded={libraryOpen} aria-controls="indicator-library" onclick={() => (libraryOpen = !libraryOpen)}>Library ({ind.scripts.length})</button>{/if}
    </PanelTopbar>

    <div class="body" class:docs-mode={tab === 'docs'} class:library-collapsed={!libraryOpen}>
      {#if tab === 'docs'}
        <ScriptDocs />
      {:else}
      {#if libraryOpen}<ScriptRail
        id="indicator-library"
        library={ind}
        signedIn={!!$authState.user}
        copy={{
          label: 'Saved scripts',
          title: 'scripts',
          newLabel: 'New indicator',
          signInHint: 'Sign in to load and save indicators. You can run an unsaved draft without an account.',
          empty: 'No saved scripts yet.',
          emptyDetail: 'Draft something on the right and save it.',
          deleteNoun: 'script',
          runLabel: 'run',
        }}
        onNew={() => void newDraft()}
        onSelect={id => void openScript(id)}
        onDelete={(id, name) => void confirmDelete(id, name)}
      >
        {#snippet signIn()}
          <button type="button" class="btn ghost" onclick={() => (authDialogOpen = true)}>Sign in</button>
        {/snippet}
        {#snippet status(s)}
          <button
            type="button"
            class="ri-status"
            class:running={ind.isRunningOk(s.id)}
            aria-label={`${ind.runners[s.id] ? 'Stop' : 'Start'} script ${s.name}`}
            title={ind.runners[s.id] ? 'stop script' : 'start script'}
            onclick={() => void toggleScriptRun(s.id)}
          ></button>
        {/snippet}
      </ScriptRail>{/if}

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
            <button type="button" class="btn ghost" onclick={() => void newDraft()} aria-label="New indicator"><Plus class="h-3.5 w-3.5" /><span>New</span></button>
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
              <span>{ind.isSaving ? 'Saving…' : 'Save'}</span>
            </button>

            <button
              type="button"
              class="btn ghost"
              onclick={saveAndRun}
              disabled={ind.isSaving || ind.isRunning || !ind.draftName.trim()}
              title="Save & run"
            >
              <span>Save &amp; run</span>
            </button>

            {#if ind.runningId && ind.runningId === ind.activeId}
              <button
                type="button"
                class="btn primary stop"
                onclick={stopNow}
                title="Stop"
              >
                <Square class="h-3.5 w-3.5" />
                <span>Stop</span>
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
                <span>{ind.isRunning ? 'Running…' : 'Run'}</span>
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
        oklch(var(--primary) / 10%),
        transparent 60%
      ),
      color-mix(in oklab, oklch(var(--card)) 96%, black 4%);
    border-top: 1px solid oklch(var(--border-subtle));
    box-shadow:
      0 -30px 60px -20px rgba(0, 0, 0, 0.5),
      0 -1px 0 0 oklch(var(--surface-hover)) inset;
    border-radius: 16px 16px 0 0;
    font-family: var(--font-mono);
    overflow: hidden;
  }

  .corner {
    position: absolute;
    width: 18px;
    height: 18px;
    pointer-events: none;
    color: oklch(var(--foreground-tertiary));
  }
  .corner.tl { top: 12px; left: 12px; border-top: 1px solid currentColor; border-left: 1px solid currentColor; }
  .corner.tr { top: 12px; right: 12px; border-top: 1px solid currentColor; border-right: 1px solid currentColor; }

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
  .ri-status {
    border: 0;
    padding: 0;
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: oklch(var(--status-error));
    box-shadow: 0 0 0 2px oklch(var(--status-error-wash));
    transition: background var(--motion-fast), box-shadow var(--motion-fast), transform var(--motion-fast);
    align-self: center;
    justify-self: center;
    cursor: pointer;
  }
  .ri-status:hover {
    transform: scale(1.25);
  }
  .ri-status.running {
    background: oklch(var(--status-ok));
    box-shadow: 0 0 0 2px color-mix(in oklab, oklch(var(--status-ok)) 28%, transparent);
    animation: pulseDot 1.6s ease-in-out infinite;
  }
  @keyframes pulseDot {
    0%, 100% { box-shadow: 0 0 0 2px color-mix(in oklab, oklch(var(--status-ok)) 22%, transparent); }
    50% { box-shadow: 0 0 0 4px color-mix(in oklab, oklch(var(--status-ok)) 32%, transparent); }
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
    border-bottom: 1px solid oklch(var(--border-subtle));
    background: oklch(var(--card));
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
    transform: translateY(-1px);
  }
  .btn.primary:active:not(:disabled) { transform: translateY(0); }
  .btn.primary.stop {
    background: oklch(var(--destructive));
    border-color: oklch(var(--destructive));
    color: oklch(var(--destructive-foreground));
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
    background: color-mix(in oklab, oklch(var(--card)) 100%, black 8%);
    border-top: 1px solid oklch(var(--border-subtle));
    border-bottom: 1px solid oklch(var(--border-subtle));
    user-select: none;
    touch-action: none;
  }
  .splitter:hover, .splitter.dragging {
    background: oklch(var(--surface-selected));
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
  }

  @media (max-width: 900px) {
    .work-head { flex-wrap: wrap; padding: 8px 12px; }
    .actions { flex-wrap: wrap; }
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
  /* Light theme: pure white chrome, no greys, no top vignette.       */
  /* The default styles above target dark mode; this block strips the */
  /* radial-gradient halo, the heavy upward box-shadow, and every     */
  /* color-mix(...black...) grey wash from the panel surfaces.        */
  /* ---------------------------------------------------------------- */
  :global(html:not(.dark)) .panel {
    background: oklch(var(--card));
    box-shadow:
      0 -1px 0 0 oklch(var(--foreground)) inset,
      0 -8px 24px -16px rgba(0, 0, 0, 0.18);
    border-top: 1px solid oklch(var(--foreground));
  }
  :global(html:not(.dark)) .ri-status.running {
    background: oklch(var(--primary));
    box-shadow: 0 0 0 2px oklch(var(--primary) / 22%);
  }
  :global(html:not(.dark)) .work-head {
    background: oklch(var(--card));
    border-bottom: 1px solid oklch(var(--foreground));
  }
  :global(html:not(.dark)) .btn {
    background: oklch(var(--card));
    border-color: oklch(var(--foreground));
    color: oklch(var(--foreground));
  }
  :global(html:not(.dark)) .btn.ghost:hover:not(:disabled) {
    background: oklch(var(--foreground));
    border-color: oklch(var(--foreground));
    color: oklch(var(--card));
  }
  :global(html:not(.dark)) .splitter {
    background: oklch(var(--card));
    border-top: 1px solid oklch(var(--foreground));
    border-bottom: 1px solid oklch(var(--foreground));
  }
  :global(html:not(.dark)) .splitter:hover,
  :global(html:not(.dark)) .splitter.dragging {
    background: color-mix(in oklab, oklch(var(--primary)) 14%, oklch(var(--card)));
  }
  :global(html:not(.dark)) .grip i {
    background: oklch(var(--foreground));
  }
</style>

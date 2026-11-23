<script lang="ts" generics="T extends SavedScript & { updated_at: string }">
  import type { Snippet } from 'svelte';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import type { SavedScript, SavedScriptDraft } from './savedScriptDraft.svelte';

  // The saved-script library beside an editor. `tone` is the surface it sits on:
  // a floating workbench panel ('overlay') or a full workspace view ('page').
  let {
    id,
    library,
    signedIn,
    copy,
    tone = 'overlay',
    onNew,
    onSelect,
    onDelete,
    signIn,
    status,
  }: {
    id: string;
    library: SavedScriptDraft<T>;
    signedIn: boolean;
    copy: {
      label: string;
      title: string;
      newLabel: string;
      signInHint: string;
      empty: string;
      emptyDetail: string;
      deleteNoun: string;
      runLabel: string;
    };
    tone?: 'overlay' | 'page';
    onNew: () => void;
    onSelect: (id: string) => void;
    onDelete: (id: string, name: string) => void;
    /** Rendered under the signed-out hint. */
    signIn: Snippet;
    /** A per-script control in front of the name, such as a run toggle. */
    status?: Snippet<[T]>;
  } = $props();

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

<aside class="rail" class:page={tone === 'page'} {id} aria-label={copy.label}>
  <div class="rail-head">
    <span class="rail-title">{copy.title}</span>
    <span class="rail-count">{library.scripts.length}</span>
    <button
      type="button"
      class="iconbtn"
      onclick={onNew}
      title={`${copy.newLabel} (clears editor)`}
      aria-label={copy.newLabel}
    >
      <Plus class="h-3.5 w-3.5" />
    </button>
  </div>

  <div class="rail-list">
    {#if !signedIn}
      <p class="rail-hint">{copy.signInHint}</p>
      {@render signIn()}
    {:else if library.loading && library.scripts.length === 0}
      <p class="rail-hint">Loading…</p>
    {:else if library.loadError}
      <p class="rail-hint err">{library.loadError}</p>
    {:else if library.scripts.length === 0}
      <p class="rail-hint">
        {copy.empty}<br />
        <span class="dim">{copy.emptyDetail}</span>
      </p>
    {/if}

    {#each signedIn ? library.scripts : [] as s (s.id)}
      <div
        class="rail-item"
        class:with-status={!!status}
        class:active={library.activeId === s.id}
      >
        {@render status?.(s)}
        <button
          type="button"
          class="ri-select"
          aria-pressed={library.activeId === s.id}
          onclick={() => onSelect(s.id)}
        >
          <span class="ri-name">{s.name}</span>
          <span class="ri-time">{fmtRelative(s.updated_at)}</span>
        </button>
        <button
          type="button"
          class="ri-del"
          aria-label="Delete {copy.deleteNoun} {s.name}"
          onclick={() => onDelete(s.id, s.name)}
        >
          <Trash2 class="h-3 w-3" />
        </button>
      </div>
    {/each}
  </div>

  <footer class="rail-foot">
    <span class="legend"><span class="kbd">⌘↵</span> {copy.runLabel}</span>
    <span class="legend"><span class="kbd">⌘S</span> save</span>
  </footer>
</aside>

<style>
  .iconbtn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px; height: 26px;
    border: 1px solid oklch(var(--border));
    border-radius: var(--radius-md);
    background: transparent;
    color: oklch(var(--muted-foreground));
    cursor: pointer;
    transition: all var(--motion-fast);
  }
  .iconbtn:hover {
    color: oklch(var(--foreground));
    border-color: oklch(var(--border-strong));
    background: oklch(var(--surface-selected));
  }
  .rail {
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-right: 1px solid oklch(var(--border-subtle));
    background: oklch(var(--card));
  }
  .rail-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 14px 16px 10px;
    font-size: var(--font-size-label);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: oklch(var(--muted-foreground));
    border-bottom: 1px dashed
      oklch(var(--border));
  }
  .rail-title { font-weight: 600; color: oklch(var(--foreground)); }
  .rail-count {
    margin-left: 2px;
    padding: 1px 6px;
    border: 1px solid oklch(var(--border));
    border-radius: 999px;
    font-size: var(--font-size-annotation);
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
    font-size: var(--font-size-chrome);
    line-height: 1.5;
    color: oklch(var(--muted-foreground));
  }
  .rail-hint .dim { color: oklch(var(--muted-foreground)); }
  .rail-hint.err { color: oklch(var(--status-error)); }
  .page .rail-hint.err { color: oklch(var(--down-color)); }
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
    border-radius: var(--radius-md);
    background: transparent;
    color: oklch(var(--foreground));
    text-align: left;
    cursor: pointer;
    font-family: inherit;
    transition: background var(--motion-fast), border-color var(--motion-fast);
  }
  .rail-item.with-status { grid-template-columns: 14px minmax(0, 1fr) auto; }
  .rail-item:hover {
    background: oklch(var(--surface-hover));
  }
  .rail-item.active {
    background: oklch(var(--surface-selected));
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
    background: oklch(var(--foreground));
    border-radius: 0 2px 2px 0;
    pointer-events: none;
  }
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
  .ri-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--font-size-control);
  }
  .ri-time {
    font-size: var(--font-size-annotation);
    color: oklch(var(--muted-foreground));
    letter-spacing: var(--tracking-label);
  }
  .ri-del {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px; height: 22px;
    margin-left: 4px;
    border: 0;
    padding: 0;
    background: transparent;
    color: oklch(var(--foreground-tertiary));
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: opacity 120ms, color 120ms, background 120ms;
  }
  .page .ri-del { color: oklch(var(--muted-foreground)); }
  .ri-del:hover {
    color: oklch(var(--status-error));
    background: oklch(var(--status-error-wash));
  }
  .page .ri-del:hover {
    color: oklch(var(--down-color));
    background: oklch(var(--down-color) / 0.1);
  }
  .rail-foot {
    display: flex;
    gap: 12px;
    padding: 10px 16px;
    border-top: 1px dashed oklch(var(--border));
    font-size: var(--font-size-annotation);
    letter-spacing: var(--tracking-label);
    color: oklch(var(--muted-foreground));
  }
  .legend { display: inline-flex; align-items: center; gap: 6px; }
  .kbd {
    padding: 1px 5px;
    border: 1px solid oklch(var(--border));
    border-radius: var(--radius-sm);
    font-size: var(--font-size-annotation);
    color: oklch(var(--foreground));
    background: oklch(var(--surface-hover));
  }
  @media (max-width: 760px) {
    .rail { border-bottom: 1px solid oklch(var(--border-subtle)); }
    .rail-head { padding: 8px 12px; }
    .rail-foot { display: none; }
  }
  @media (forced-colors: active) {
    .rail-item.active { border-color: Highlight; }
    .rail-item.active::before { forced-color-adjust: none; background: Highlight; }
  }
</style>

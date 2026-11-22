<script lang="ts" generics="TabId extends string">
  import type { Snippet } from 'svelte';
  import X from '@lucide/svelte/icons/x';

  // The bar across the top of a workbench panel. `tone` is the surface it sits on:
  // a floating panel ('overlay') or a full workspace view ('page'). An embedded
  // page already has the app header above it, so it shows only tabs and actions.
  let {
    title,
    mark,
    tone = 'overlay',
    embedded = false,
    tabs,
    tabsLabel = 'Workbench tabs',
    activeTab,
    onTab,
    context,
    onClose,
    children,
  }: {
    title: string;
    mark: Snippet;
    tone?: 'overlay' | 'page';
    embedded?: boolean;
    tabs?: readonly { id: TabId; label: string }[];
    tabsLabel?: string;
    activeTab?: TabId;
    onTab?: (id: TabId) => void;
    /** The market context the panel works on; without a provider only the symbol shows. */
    context: {
      symbol: string;
      provider?: string;
      interval?: string;
      period?: string;
    };
    onClose: () => void;
    /** Extra controls placed after the tabs. */
    children?: Snippet;
  } = $props();
</script>

<header
  class="topbar"
  class:page={tone === 'page'}
  class:embedded
  class:with-tabs={!!tabs}
>
  {#if !embedded}<div class="brand">
      <span class="brand-mark">{@render mark()}</span>
      <span class="brand-title">{title}</span>
      <span class="brand-sub">/ workbench</span>
    </div>{/if}

  {#if tabs}
    <nav class="tabs" aria-label={tabsLabel}>
      {#each tabs as tab (tab.id)}
        <button
          type="button"
          class="tab"
          class:active={activeTab === tab.id}
          onclick={() => onTab?.(tab.id)}>{tab.label}</button
        >
      {/each}
    </nav>
  {/if}
  {@render children?.()}

  {#if !embedded}
    {#if context.provider}
      <div class="ctx" aria-label="Active market context">
        <span class="ctx-label">CTX</span>
        <span class="ctx-pair">
          <span class="ctx-sym">{context.symbol || '—'}</span>
          <span class="ctx-sep">·</span>
          <span class="ctx-prov">{context.provider}</span>
          <span class="ctx-sep">·</span>
          <span class="ctx-iv">{context.interval}</span>
          <span class="ctx-sep">·</span>
          <span class="ctx-pd">{context.period}</span>
        </span>
      </div>
    {:else}
      <div class="ctx" aria-label="Active symbol">
        <span class="ctx-label">SYM</span>
        <span class="ctx-sym">{context.symbol || '—'}</span>
      </div>
    {/if}

    <button
      type="button"
      class="iconbtn close"
      onclick={onClose}
      aria-label="Close"
    >
      <X class="h-3.5 w-3.5" />
    </button>
  {/if}
</header>

<style>
  .topbar {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 16px;
    padding: 14px 22px;
    border-bottom: 1px dashed color-mix(in oklab, oklch(var(--border)) 90%, transparent);
    background: oklch(var(--card));
  }
  .topbar.with-tabs { grid-template-columns: auto auto 1fr auto; }
  .topbar.page { display: flex; flex-wrap: wrap; }
  .topbar.embedded { flex-shrink: 0; flex-wrap: nowrap; gap: 8px; padding: 6px 12px; }
  .embedded > :global(.ot-workbench-ghost) { flex: none; }

  .brand {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: var(--font-size-control);
    letter-spacing: 0.04em;
  }
  .brand-mark {
    color: oklch(var(--primary));
    font-size: var(--font-size-body);
    transform: translateY(1px);
  }
  .brand-title { font-weight: 600; }
  .brand-sub {
    color: oklch(var(--muted-foreground));
    font-size: var(--font-size-label);
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
    font-size: var(--font-size-label);
    letter-spacing: 0.04em;
    color: oklch(var(--muted-foreground));
    background: oklch(var(--surface-sunken));
  }
  .page .ctx { margin-left: auto; background: oklch(var(--background)); }
  .ctx-label {
    font-size: var(--font-size-annotation);
    letter-spacing: 0.18em;
    color: oklch(var(--foreground-tertiary));
  }
  .ctx-pair {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
  }
  .ctx-sym {
    color: oklch(var(--foreground));
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .ctx-sep { color: color-mix(in oklab, oklch(var(--foreground)) 25%, transparent); }
  .ctx-prov, .ctx-iv, .ctx-pd { font-size: var(--font-size-label); }

  .iconbtn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px; height: 26px;
    border: 1px solid oklch(var(--border));
    border-radius: 4px;
    background: transparent;
    color: oklch(var(--muted-foreground));
    cursor: pointer;
    transition: all var(--motion-fast);
  }
  .iconbtn:hover {
    color: oklch(var(--foreground));
    border-color: color-mix(in oklab, oklch(var(--primary)) 50%, transparent);
    background: oklch(var(--surface-selected));
  }
  .iconbtn.close:hover {
    border-color: color-mix(in oklab, oklch(var(--status-error)) 60%, transparent);
    color: oklch(var(--status-error));
    background: color-mix(in oklab, oklch(var(--status-error)) 12%, transparent);
  }
  .page .iconbtn.close:hover {
    border-color: oklch(var(--down-color));
    color: oklch(var(--down-color));
    background: oklch(var(--down-color) / 0.1);
  }

  .tabs {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    border: 1px solid oklch(var(--border));
    border-radius: 4px;
    background: oklch(var(--surface-sunken));
  }
  .page .tabs { background: oklch(var(--background)); }
  .embedded .tabs { min-width: 0; overflow-x: auto; }
  .embedded .tabs .tab { flex: none; }
  .tab {
    appearance: none;
    border: 0;
    background: transparent;
    color: oklch(var(--muted-foreground));
    font-family: inherit;
    font-size: var(--font-size-label);
    letter-spacing: 0.08em;
    padding: 4px 12px;
    border-radius: 3px;
    cursor: pointer;
    transition: all var(--motion-fast);
  }
  .tab:hover { color: oklch(var(--foreground)); }
  .tab.active {
    background: oklch(var(--accent));
    color: oklch(var(--accent-foreground));
    font-weight: 600;
  }

  @media (max-width: 900px) {
    .topbar { display: flex; flex-wrap: wrap; gap: 8px; padding: 10px 12px; }
    .topbar .close { margin-left: auto; }
    .ctx { flex-wrap: wrap; }
    .topbar:not(.page) .ctx-pair { flex-wrap: wrap; }
  }
  @media (max-width: 760px) {
    .topbar.embedded { flex-wrap: nowrap; padding: 0 8px; }
    .embedded .tab { min-height: 36px; padding: 4px 9px; }
    .embedded > :global(.ot-workbench-ghost) { min-height: 44px; }
  }

  button:focus-visible {
    outline: 2px solid oklch(var(--foreground));
    outline-offset: 2px;
  }
  @media (forced-colors: active) {
    button:focus-visible { outline-color: Highlight; }
  }

  /* Light theme on an overlay panel: pure white surfaces, dark hairlines. */
  :global(html:not(.dark)) .topbar:not(.page) {
    background: oklch(var(--card));
    border-bottom: 1px dashed oklch(var(--foreground));
  }
  :global(html:not(.dark)) .topbar:not(.page) .ctx {
    background: oklch(var(--card));
    border-color: oklch(var(--foreground));
    color: oklch(var(--foreground));
  }
  :global(html:not(.dark)) .topbar:not(.page) .ctx-label,
  :global(html:not(.dark)) .topbar:not(.page) .ctx-sep {
    color: oklch(var(--foreground));
    opacity: 0.55;
  }
  :global(html:not(.dark)) .topbar:not(.page) .tabs {
    background: oklch(var(--card));
    border-color: oklch(var(--foreground));
  }
  :global(html:not(.dark)) .topbar:not(.page) .iconbtn {
    border-color: oklch(var(--foreground));
    color: oklch(var(--foreground));
  }
  :global(html:not(.dark)) .topbar:not(.page) .iconbtn:hover {
    background: oklch(var(--foreground));
    color: oklch(var(--card));
    border-color: oklch(var(--foreground));
  }
</style>

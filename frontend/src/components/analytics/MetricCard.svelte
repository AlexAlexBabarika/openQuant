<script lang="ts">
  import X from '@lucide/svelte/icons/x';
  import type { Snippet } from 'svelte';
  import type { AnalyticsResult } from '$lib/features/analytics/analyticsState.svelte';
  import type { MetricDef } from '$lib/features/analytics/metrics';

  let {
    def,
    result,
    loading,
    error,
    onClose,
    children,
    errorMode = 'replace',
  }: {
    def: MetricDef;
    result: AnalyticsResult | null;
    loading: boolean;
    error: string | null;
    onClose: () => void;
    children?: Snippet<[AnalyticsResult]>;
    /**
     * 'replace' (default): error message replaces the body.
     * 'inline': children stay rendered when a previous result exists,
     * with the error message appended below. Used for cards whose body
     * is interactive (e.g., the correlation chip editor) and needs to
     * stay reachable so the user can recover from a failed fetch.
     */
    errorMode?: 'replace' | 'inline';
  } = $props();
</script>

<article class="card" class:err={!!error} aria-label={def.label}>
  <header class="card-head">
    <div class="title-wrap">
      <span class="cat">{def.category}</span>
      <h3 class="title">{def.label}</h3>
    </div>
    <button
      type="button"
      class="iconbtn"
      onclick={onClose}
      aria-label="Disable {def.label}"
      title="disable"
    >
      <X class="h-3 w-3" />
    </button>
  </header>

  <div class="body">
    {#if loading && !result}
      <div class="skeleton" aria-hidden="true">
        <span class="sk-bar"></span>
        <span class="sk-bar narrow"></span>
      </div>
    {:else if errorMode === 'inline' && result && children}
      {@render children(result)}
      {#if error}
        <p class="err-msg inline">{error}</p>
      {/if}
    {:else if error}
      <p class="err-msg">{error}</p>
    {:else if result && children}
      {@render children(result)}
    {:else if result}
      <pre class="placeholder">{JSON.stringify(result.data, null, 2)}</pre>
    {:else}
      <p class="empty">no data — load market data first.</p>
    {/if}
  </div>
</article>

<style>
  .card {
    display: flex;
    flex-direction: column;
    min-width: 0;
    border: 1px solid color-mix(in oklab, oklch(var(--border)) 100%, transparent);
    border-radius: 6px;
    background: color-mix(in oklab, oklch(var(--popover)) 100%, black 4%);
    overflow: hidden;
    transition: border-color 120ms ease;
  }
  .card.err {
    border-color: color-mix(in oklab, oklch(var(--status-error)) 60%, transparent);
  }

  .card-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-bottom: 1px dashed
      color-mix(in oklab, oklch(var(--border)) 90%, transparent);
  }
  .title-wrap {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1 1 auto;
  }
  .cat {
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: color-mix(in oklab, oklch(var(--foreground)) 45%, transparent);
  }
  .title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: oklch(var(--foreground));
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .iconbtn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: 1px solid
      color-mix(in oklab, oklch(var(--border)) 100%, transparent);
    border-radius: 4px;
    background: transparent;
    color: oklch(var(--muted-foreground));
    cursor: pointer;
    transition: all 120ms ease;
  }
  .iconbtn:hover {
    color: oklch(var(--status-error));
    border-color: color-mix(in oklab, oklch(var(--status-error)) 60%, transparent);
    background: color-mix(in oklab, oklch(var(--status-error)) 12%, transparent);
  }

  .body {
    flex: 1 1 auto;
    min-height: 96px;
    padding: 10px 12px;
    font-size: 12px;
    color: oklch(var(--foreground));
  }
  .empty {
    margin: 0;
    color: oklch(var(--muted-foreground));
    font-size: 12px;
  }
  .err-msg {
    margin: 0;
    color: oklch(var(--status-error));
    font-size: 12px;
    line-height: 1.45;
  }
  .err-msg.inline {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px dashed
      color-mix(in oklab, oklch(var(--status-error)) 35%, transparent);
  }
  .placeholder {
    margin: 0;
    font-size: 11px;
    line-height: 1.45;
    color: color-mix(in oklab, oklch(var(--foreground)) 75%, transparent);
    overflow: auto;
    max-height: 180px;
  }

  .skeleton {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .sk-bar {
    height: 10px;
    width: 70%;
    border-radius: 3px;
    background: linear-gradient(
      90deg,
      color-mix(in oklab, oklch(var(--foreground)) 6%, transparent) 0%,
      color-mix(in oklab, oklch(var(--foreground)) 14%, transparent) 50%,
      color-mix(in oklab, oklch(var(--foreground)) 6%, transparent) 100%
    );
    background-size: 200% 100%;
    animation: shimmer 1.4s linear infinite;
  }
  .sk-bar.narrow {
    width: 40%;
  }
  @keyframes shimmer {
    from {
      background-position: 200% 0;
    }
    to {
      background-position: -200% 0;
    }
  }

  :global(html:not(.dark)) .card {
    background: oklch(var(--card));
    border-color: oklch(var(--foreground));
  }
  :global(html:not(.dark)) .card-head {
    border-bottom-color: oklch(var(--foreground));
  }
  :global(html:not(.dark)) .iconbtn {
    border-color: oklch(var(--foreground));
    color: oklch(var(--foreground));
  }
</style>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Dialog } from 'bits-ui';
  import { createModalLifecycle } from '$lib/core/modalLifecycle';
  import Search from '@lucide/svelte/icons/search';
  import PanelTopbar from '../layout/PanelTopbar.svelte';
  import Sigma from '@lucide/svelte/icons/sigma';
  import MetricCard from './MetricCard.svelte';
  import ScalarBody from './cards/ScalarBody.svelte';
  import VaRBody from './cards/VaRBody.svelte';
  import DrawdownCard from './cards/DrawdownCard.svelte';
  import DistributionCard from './cards/DistributionCard.svelte';
  import CorrelationCard from './cards/CorrelationCard.svelte';
  import VolatilityClusteringBody from './cards/VolatilityClusteringBody.svelte';
  import {
    METRICS,
    METRIC_CATEGORIES,
    type MetricCategory,
    type MetricDef,
    type MetricId,
  } from '$lib/features/analytics/metrics';
  import {
    AnalyticsState,
    type AnalyticsResult,
  } from '$lib/features/analytics/analyticsState.svelte';

  let {
    open = $bindable(false),
    symbol,
    analytics,
  }: {
    open?: boolean;
    symbol: string;
    analytics: AnalyticsState;
  } = $props();

  let query = $state('');
  let searchInput = $state<HTMLInputElement | null>(null);


  const filtered = $derived.by<MetricDef[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [...METRICS];
    return METRICS.filter(
      m =>
        m.label.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.id.includes(q),
    );
  });

  const grouped = $derived.by<Record<MetricCategory, MetricDef[]>>(() => {
    const out = {
      Risk: [] as MetricDef[],
      Statistical: [] as MetricDef[],
      Advanced: [] as MetricDef[],
    };
    for (const m of filtered) out[m.category].push(m);
    return out;
  });

  const enabledMetrics = $derived(
    METRICS.filter(m => analytics.enabled[m.id]),
  );

  // Re-fetch enabled metrics whenever the symbol changes while open.
  $effect(() => {
    if (!open) return;
    if (!symbol) return;
    void analytics.refresh(symbol);
  });



  const modal = createModalLifecycle();
  onDestroy(() => modal.close());
  let panelEl = $state<HTMLDivElement | null>(null);

  function close() {
    open = false;
  }


  function toggle(id: MetricId) {
    analytics.toggle(id);
  }

  // Correlation needs the chip editor reachable even when no result has
  // landed yet (first fetch failed, or benchmark list emptied with no
  // symbol). Synthesize an empty result so MetricCard always renders the
  // body; the real error is surfaced inline via errorMode='inline'.
  function resultFor(id: MetricId): AnalyticsResult | null {
    const r = analytics.results[id];
    if (r) return r;
    if (id === 'correlation') {
      return {
        kind: 'correlation',
        data: { symbol, metric: 'correlation', rows: [] },
      };
    }
    return null;
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
      onOpenAutoFocus={e => { modal.open(panelEl); e.preventDefault(); searchInput?.focus(); }}
      onCloseAutoFocus={() => modal.close()}
    >
    {#snippet child({ props })}
  <div {...props}
    bind:this={panelEl}
    class="panel"
    role="dialog"
    aria-modal="true"
    aria-label="Analytics workbench"
  >
    <PanelTopbar title="Analytics" context={{ symbol }} onClose={close}>
      {#snippet mark()}<Sigma class="h-3.5 w-3.5" />{/snippet}
    </PanelTopbar>

    <div class="body">
      <aside class="rail" aria-label="Available metrics">
        <div class="search">
          <Search class="h-3.5 w-3.5" />
          <input
            type="text"
            spellcheck="false"
            autocomplete="off"
            placeholder="search metrics…"
            aria-label="Search metrics"
            bind:value={query}
            bind:this={searchInput}
          />
        </div>

        <div class="rail-list">
          {#each METRIC_CATEGORIES as cat (cat)}
            {#if grouped[cat].length > 0}
              <div class="group">
                <div class="group-head">{cat}</div>
                {#each grouped[cat] as m (m.id)}
                  {@const on = analytics.enabled[m.id]}
                  <button
                    type="button"
                    class="row"
                    class:active={on}
                    onclick={() => toggle(m.id)}
                    aria-pressed={on}
                  >
                    <span class="dot" class:on aria-hidden="true"></span>
                    <span class="row-text">
                      <span class="row-name">{m.label}</span>
                      <span class="row-desc">{m.description}</span>
                    </span>
                  </button>
                {/each}
              </div>
            {/if}
          {/each}

          {#if filtered.length === 0}
            <p class="hint">no metrics match “{query}”.</p>
          {/if}
        </div>

        <footer class="rail-foot">
          <span class="legend">
            <span class="kbd">esc</span> close
          </span>
          <span class="count">{enabledMetrics.length} enabled</span>
        </footer>
      </aside>

      <main class="work">
        {#if !symbol}
          <p class="empty-pane">
            no symbol loaded — pick one from the chart to see metrics.
          </p>
        {:else if enabledMetrics.length === 0}
          <p class="empty-pane">
            select a metric in the available metrics list to enable it.
          </p>
        {:else}
          <div class="grid">
            {#each enabledMetrics as m (m.id)}
              <MetricCard
                def={m}
                result={resultFor(m.id)}
                loading={analytics.loading[m.id]}
                error={analytics.errors[m.id]}
                errorMode={m.id === 'correlation' ? 'inline' : 'replace'}
                onClose={() => toggle(m.id)}
              >
                {#snippet children(result)}
                  {#if result.kind === 'scalar'}
                    <ScalarBody data={result.data} />
                  {:else if result.kind === 'var'}
                    <VaRBody data={result.data} />
                  {:else if result.kind === 'max_drawdown'}
                    <DrawdownCard data={result.data} />
                  {:else if result.kind === 'return_distribution'}
                    <DistributionCard data={result.data} />
                  {:else if result.kind === 'correlation'}
                    <CorrelationCard
                      data={result.data}
                      {analytics}
                      loading={analytics.loading.correlation}
                    />
                  {:else if result.kind === 'volatility_clustering'}
                    <VolatilityClusteringBody data={result.data} />
                  {/if}
                {/snippet}
              </MetricCard>
            {/each}
          </div>
        {/if}
      </main>
    </div>
  </div>
    {/snippet}
    </Dialog.Content>
  </Dialog.Portal>
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
    background: oklch(var(--card));
    border-top: 1px solid
      oklch(var(--border));
    box-shadow: var(--elevation-dialog);
    border-radius: 16px 16px 0 0;
    font-family: var(--font-mono);
    overflow: hidden;
    animation: slideUp 280ms cubic-bezier(0.18, 0.9, 0.24, 1);
  }

  @keyframes slideUp {
    from {
      transform: translateY(24px);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }
  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .body {
    flex: 1 1 auto;
    min-height: 0;
    display: grid;
    grid-template-columns: 280px 1fr;
  }

  .rail {
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-right: 1px solid
      oklch(var(--border));
    background: oklch(var(--card));
  }

  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 14px;
    border-bottom: 1px dashed
      oklch(var(--border));
    color: oklch(var(--muted-foreground));
  }
  .search input {
    flex: 1 1 auto;
    min-width: 0;
    background: transparent;
    border: 0;
    outline: none;
    font-family: inherit;
    font-size: var(--font-size-chrome);
    color: oklch(var(--foreground));
  }
  .search input::placeholder {
    color: oklch(var(--foreground-tertiary));
  }

  .rail-list {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: 6px 6px 12px;
  }

  .group + .group {
    margin-top: 6px;
  }
  .group-head {
    padding: 8px 10px 4px;
    font-size: var(--font-size-annotation);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: oklch(var(--muted-foreground));
  }

  .row {
    position: relative;
    display: grid;
    grid-template-columns: 12px 1fr;
    gap: 10px;
    align-items: start;
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
    transition:
      background var(--motion-fast),
      border-color var(--motion-fast);
  }
  .row:hover {
    background: oklch(var(--surface-hover));
  }
  .row.active {
    background: oklch(var(--surface-selected));
    border-color: transparent;
  }
  .row.active::before {
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

  .dot {
    margin-top: 5px;
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: color-mix(in oklab, oklch(var(--foreground)) 22%, transparent);
    transition:
      background var(--motion-fast),
      box-shadow var(--motion-fast);
  }
  .dot.on {
    background: oklch(var(--status-ok));
    box-shadow: 0 0 0 2px oklch(var(--status-ok) / 28%);
  }

  .row-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .row-name {
    font-size: var(--font-size-control);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row-desc {
    font-size: var(--font-size-label);
    line-height: 1.4;
    color: oklch(var(--foreground-tertiary));
  }

  .hint {
    margin: 14px 12px;
    font-size: var(--font-size-chrome);
    color: oklch(var(--muted-foreground));
  }

  .rail-foot {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
    border-top: 1px dashed
      oklch(var(--border));
    font-size: var(--font-size-annotation);
    letter-spacing: var(--tracking-label);
    color: oklch(var(--muted-foreground));
  }
  .legend {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .kbd {
    padding: 1px 5px;
    border: 1px solid
      oklch(var(--border));
    border-radius: var(--radius-sm);
    font-size: var(--font-size-annotation);
    color: oklch(var(--foreground));
    background: oklch(var(--surface-hover));
  }

  .work {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: auto;
  }
  .empty-pane {
    margin: auto;
    padding: 24px;
    color: oklch(var(--muted-foreground));
    font-size: var(--font-size-control);
    letter-spacing: var(--tracking-label);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 12px;
    padding: 16px;
  }

  @media (max-width: 760px) {
    .body {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(110px, 35%) minmax(0, 1fr);
    }
    .rail {
      border-bottom: 1px solid oklch(var(--border-subtle));
    }
    .rail-foot { display: none; }
    .grid { grid-template-columns: minmax(0, 1fr); }
  }
  .work { min-width: 0; }
  button:focus-visible, input:focus-visible {
    outline: 2px solid oklch(var(--foreground));
    outline-offset: 2px;
  }
  @media (forced-colors: active) {
    button:focus-visible, input:focus-visible { outline-color: Highlight; }
  }

</style>

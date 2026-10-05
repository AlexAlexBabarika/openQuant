<script lang="ts" module>
  import {
    RESULT_TABS,
    type BacktestState,
  } from '$lib/features/backtest/backtestState.svelte';

  export function resultTabForKey(
    event: Pick<KeyboardEvent, 'key' | 'preventDefault'>,
    current: BacktestState['activeTab'],
  ): BacktestState['activeTab'] | null {
    const index = RESULT_TABS.findIndex(tab => tab.id === current);
    let next: number;
    switch (event.key) {
      case 'ArrowRight': next = (index + 1) % RESULT_TABS.length; break;
      case 'ArrowLeft': next = (index + RESULT_TABS.length - 1) % RESULT_TABS.length; break;
      case 'Home': next = 0; break;
      case 'End': next = RESULT_TABS.length - 1; break;
      default: return null;
    }
    event.preventDefault();
    return RESULT_TABS[next].id;
  }
</script>

<script lang="ts">
  import EquityTab from './tabs/EquityTab.svelte';
  import DrawdownTab from './tabs/DrawdownTab.svelte';
  import TradesTab from './tabs/TradesTab.svelte';
  import MonthlyTab from './tabs/MonthlyTab.svelte';
  import MetricsGrid from './MetricsGrid.svelte';

  let { backtest }: { backtest: BacktestState } = $props();

  const result = $derived(backtest.result);
  const id = $props.id();
  const tabButtons: Partial<Record<BacktestState['activeTab'], HTMLButtonElement>> = {};

  function onTabKey(event: KeyboardEvent) {
    const next = resultTabForKey(event, backtest.activeTab);
    if (!next) return;
    backtest.setTab(next);
    tabButtons[next]?.focus();
  }
</script>

{#if result}
  <div class="tabs">
    <div class="tabbar" role="tablist" aria-label="Backtest result views">
      {#each RESULT_TABS as t (t.id)}
        <button
          type="button"
          role="tab"
          id={`${id}-tab-${t.id}`}
          aria-controls={`${id}-panel-${t.id}`}
          tabindex={backtest.activeTab === t.id ? 0 : -1}
          bind:this={tabButtons[t.id]}
          class="tab"
          class:active={backtest.activeTab === t.id}
          aria-selected={backtest.activeTab === t.id}
          onclick={() => backtest.setTab(t.id)}
          onkeydown={onTabKey}
        >
          {t.label}
        </button>
      {/each}
    </div>

    {#each RESULT_TABS as t (t.id)}
    <div
      class="pane"
      role="tabpanel"
      id={`${id}-panel-${t.id}`}
      aria-labelledby={`${id}-tab-${t.id}`}
      hidden={backtest.activeTab !== t.id}
      tabindex="0"
    >
      {#if backtest.activeTab === t.id}
      {#if backtest.activeTab === 'equity'}
        <EquityTab {result} />
      {:else if backtest.activeTab === 'drawdown'}
        <DrawdownTab {result} {backtest} />
      {:else if backtest.activeTab === 'trades'}
        <TradesTab {result} {backtest} />
      {:else if backtest.activeTab === 'monthly'}
        <MonthlyTab {result} />
      {:else if backtest.activeTab === 'stats'}
        <MetricsGrid metrics={result.metrics} />
      {/if}
      {/if}
    </div>
    {/each}
  </div>
{/if}

<style>
  .tabs {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
  }
  .tabbar {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    padding: 0 10px;
    border-bottom: 1px solid
      color-mix(in oklab, oklch(var(--border)) 100%, transparent);
  }
  .tab {
    position: relative;
    padding: 9px 14px;
    border: 0;
    background: transparent;
    color: oklch(var(--muted-foreground));
    font-family: inherit;
    font-size: 11.5px;
    letter-spacing: 0.06em;
    cursor: pointer;
    transition: color 120ms ease;
  }
  .tab:hover {
    color: oklch(var(--foreground));
  }
  .tab.active {
    color: oklch(var(--foreground));
  }
  .tab.active::after {
    content: '';
    position: absolute;
    left: 8px;
    right: 8px;
    bottom: -1px;
    height: 2px;
    background: oklch(var(--primary));
    border-radius: 2px 2px 0 0;
  }
  .pane {
    flex: 1 1 auto;
    min-height: 0;
  }
  .tab:focus-visible, .pane:focus-visible {
    outline: 2px solid oklch(var(--foreground));
    outline-offset: -2px;
  }
  @media (forced-colors: active) {
    .tab:focus-visible, .pane:focus-visible { outline-color: Highlight; }
  }

</style>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import PanelRight from '@lucide/svelte/icons/panel-right';
  import PanelRightClose from '@lucide/svelte/icons/panel-right-close';
  import GitCompare from '@lucide/svelte/icons/git-compare';
  import ChartOptionsMenu from '../chart/ChartOptionsMenu.svelte';
  import type {
    MovingAverageConfig,
    BollingerBandsConfig,
  } from '../chart/ChartOptionsMenu.svelte';
  import type { ChartColours, ChartType } from '$lib/features/chart/chartColours';
  import type { Theme } from '$lib/features/theme/theme';
  import { MAX_COMPARISONS } from '$lib/features/chart/comparisonController.svelte';

  let {
    chartType = $bindable(),
    showArea = $bindable(),
    showVolume = $bindable(),
    smaConfig = $bindable(),
    emaConfig = $bindable(),
    bbandsConfig = $bindable(),
    colours = $bindable(),
    theme,
    onthemechange,
    sidebarVisible,
    ontogglesidebar,
    comparisonCount = 0,
    oncompare,
    onopenindicators,
    onopenanalytics,
    drawingTools,
  }: {
    chartType: ChartType;
    showArea: boolean;
    showVolume: boolean;
    smaConfig: MovingAverageConfig;
    emaConfig: MovingAverageConfig;
    bbandsConfig: BollingerBandsConfig;
    colours: ChartColours;
    theme: Theme;
    onthemechange: (theme: Theme) => void;
    sidebarVisible: boolean;
    ontogglesidebar: () => void;
    comparisonCount?: number;
    oncompare?: () => void;
    onopenindicators?: () => void;
    onopenanalytics?: () => void;
    drawingTools?: Snippet;
  } = $props();

  const atLimit = $derived(comparisonCount >= MAX_COMPARISONS);
</script>

<div
  class="relative flex items-center justify-between px-2 py-1 border-t border-border bg-background h-10 shrink-0"
>
  <div class="flex items-center gap-1">
    {@render drawingTools?.()}
    <ChartOptionsMenu
      bind:chartType
      bind:showArea
      bind:showVolume
      bind:smaConfig
      bind:emaConfig
      bind:bbandsConfig
      bind:colours
      {theme}
      {onthemechange}
    />

    {#if oncompare}
      <button
        type="button"
        class="ot-workbench-ghost"
        disabled={atLimit}
        onclick={oncompare}
        aria-label="Add comparison symbol"
        title={atLimit
          ? `Maximum ${MAX_COMPARISONS} comparisons`
          : 'Add comparison symbol'}
      >
        <GitCompare class="h-3 w-3" />
        <span>cmp</span>
      </button>
    {/if}

    {#if onopenindicators || onopenanalytics}
      <span class="ot-hairline-v hidden md:block"></span>
    {/if}

    {#if onopenindicators}
      <button
        type="button"
        class="ot-workbench-ghost hidden md:inline-flex"
        onclick={onopenindicators}
        title="Open indicators workbench"
      >
        <span class="text-primary font-bold leading-none">▣</span>
        <span>indicators</span>
      </button>
    {/if}

    {#if onopenanalytics}
      <button
        type="button"
        class="ot-workbench-ghost hidden md:inline-flex"
        onclick={onopenanalytics}
        title="Open analytics workbench"
      >
        <span class="text-primary font-bold leading-none">∑</span>
        <span>analytics</span>
      </button>
    {/if}
  </div>

  <div class="flex items-center gap-1">
    <button
      type="button"
      class="ot-workbench-ghost"
      aria-label={sidebarVisible ? 'Hide watchlist' : 'Show watchlist'}
      onclick={ontogglesidebar}
    >
      {#if sidebarVisible}
        <PanelRightClose class="h-3 w-3" />
      {:else}
        <PanelRight class="h-3 w-3" />
      {/if}
      <span>watchlist</span>
    </button>
  </div>
</div>

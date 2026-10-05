<script lang="ts">
  import { tick } from 'svelte';
  import AuthDialog from '../dialogs/AuthDialog.svelte';
  import ApiKeysModal from '../dialogs/ApiKeysModal.svelte';
  import type { ConnectionStatus } from '$lib/core/ws';
  import * as Select from '$lib/components/ui/select';
  import { authState, logout } from '$lib/features/auth/auth';
  import {
    MARKET_DATA_PROVIDERS,
    providerSupportsWs,
    type MarketDataProviderValue,
  } from '$lib/features/market/marketDataProviders';
  import { DEFAULT_MARKET_INTERVAL } from '$lib/features/market/marketIntervals';
  import IntervalPicker from './IntervalPicker.svelte';
  import { DEFAULT_MARKET_PERIOD } from '$lib/features/market/marketPeriods';
  import PeriodPicker from './PeriodPicker.svelte';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import ChartCandlestick from '@lucide/svelte/icons/chart-candlestick';
  import { Popover } from 'bits-ui';
  import UserRound from '@lucide/svelte/icons/user-round';
  let {
    symbol = $bindable('AAPL'),
    period = $bindable(DEFAULT_MARKET_PERIOD),
    interval = $bindable(DEFAULT_MARKET_INTERVAL),
    source = $bindable('yfinance' as MarketDataProviderValue),
    autoRefresh = $bindable(false),
    connectionStatus = 'disconnected' as ConnectionStatus,
    isLoading = false,
    onload = () => {},
    onstream = () => {},
    oncsvupload = (_file: File) => {},
    onstrategy = () => {},
    onchart = () => {},
    onrobustness = () => {},
    activeView = 'chart',
    onworkspaces = () => {},
    oninspectdata = () => {},
    loadedProvider = null,
    errorMessage = null,
    compact = false,
  }: {
    symbol: string;
    period: string;
    interval: string;
    source: MarketDataProviderValue;
    autoRefresh: boolean;
    connectionStatus: ConnectionStatus;
    isLoading: boolean;
    onload: () => void;
    onstream: () => void;
    oncsvupload: (file: File) => void;
    onstrategy?: () => void;
    onchart?: () => void;
    onrobustness?: () => void;
    activeView?: 'chart' | 'strategy' | 'robustness';
    onworkspaces?: () => void;
    oninspectdata?: () => void;
    loadedProvider?: string | null;
    errorMessage?: string | null;
    compact?: boolean;
  } = $props();

  let authDialogOpen = $state(false);
  let apiKeysModalOpen = $state(false);
  let accountOpen = $state(false);
  let dataSettingsOpen = $state(false);
  let currentUser = $derived($authState.user);

  async function openResearch(action: () => void) {
    dataSettingsOpen = false;
    await tick();
    action();
  }

  async function handleLogout() {
    await logout();
  }

  let fileInput: HTMLInputElement | undefined = $state();

  function handleLoad() {
    if (source === 'csv') {
      fileInput?.click();
    } else {
      onload();
    }
  }

  function handleFileChange() {
    const file = fileInput?.files?.[0];
    if (!file) return;
    oncsvupload(file);
  }

  let streamable = $derived(source === 'csv' || providerSupportsWs(source));
  let streamActive = $derived(
    connectionStatus === 'connected' || connectionStatus === 'connecting',
  );
  let activeSourceLabel = $derived(
    MARKET_DATA_PROVIDERS.find(p => p.value === source)?.label ?? source,
  );
</script>

{#snippet dataControls()}
  <Select.Root type="single" bind:value={source}>
    <Select.Trigger class="ot-ctx-pill h-7 px-3 outline-none [&_svg]:opacity-60" aria-label="Market data source">
      <span class="ot-ctx-label">SRC</span><span class="ot-ctx-value">{activeSourceLabel}</span>
    </Select.Trigger>
    <Select.Content>{#each MARKET_DATA_PROVIDERS as p (p.value)}<Select.Item value={p.value}>{p.label}</Select.Item>{/each}</Select.Content>
  </Select.Root>
  <div class="context-group" aria-label="Date range"><span class="context-label">Range</span><PeriodPicker bind:value={period} /></div>
  <input type="file" accept=".csv,text/csv" class="hidden" bind:this={fileInput} onchange={handleFileChange} />
    <button type="button" class="ot-workbench-ghost" onclick={handleLoad} disabled={isLoading || (source !== 'csv' && !symbol.trim())}>
      {#if isLoading}<LoaderCircle class="h-3 w-3 animate-spin" />{/if}
      <span>{isLoading ? 'Loading…' : source === 'csv' ? 'Upload CSV' : 'Load history'}</span>
    </button>
  <button type="button" class="ot-workbench-ghost stream-control" onclick={onstream} disabled={(!streamActive && (!streamable || !symbol.trim())) || isLoading} aria-pressed={streamActive} title={!streamable ? `Live streaming is not available for ${source}.` : streamActive ? 'Stop the live stream' : 'Start a live stream; matching history is loaded if needed'}>
    <span>{streamActive ? 'Stop stream' : 'Stream'}</span>
    {#if connectionStatus === 'connecting'}<span class="ot-stream-dot idle"></span>
    {:else if connectionStatus === 'connected'}<span class="ot-stream-dot" aria-label="Connected"></span>
    {:else if connectionStatus === 'error'}<span class="ot-stream-dot error" aria-label="Stream error"></span>{/if}
  </button>
  <button type="button" class="ot-workbench-ghost" onclick={() => openResearch(oninspectdata)} aria-label="Inspect loaded market data">Inspect data</button>
{/snippet}

<header class="workbench-header">
<div class="global-row">
  <!-- Brand zone -->
  <div
    class="flex items-center gap-1.5 font-mono text-sm font-semibold tracking-tight select-none"
  >
    <span>openQuant</span>
    <ChartCandlestick class="h-4 w-4 text-primary" />
  </div>

  <nav class="task-navigation" aria-label="Research tasks">
    <button type="button" class="task-link" aria-current={activeView === 'chart' ? 'page' : undefined} onclick={onchart}>Chart</button>
    <button type="button" class="task-link" aria-current={activeView === 'strategy' ? 'page' : undefined} onclick={onstrategy}>Strategy</button>
    <button type="button" class="task-link" aria-current={activeView === 'robustness' ? 'page' : undefined} onclick={onrobustness}>Robustness</button>
  </nav>
  <button type="button" class="workspace-link ot-workbench-ghost" onclick={onworkspaces}>Workspaces</button>

  <div class="account-zone">
    {#if currentUser}
      <Popover.Root bind:open={accountOpen}>
        <Popover.Trigger class="ot-workbench-ghost" aria-label="Account menu"><UserRound class="h-4 w-4" /></Popover.Trigger>
        <Popover.Portal><Popover.Content align="end" sideOffset={8} class="z-[60] w-64 max-w-[calc(100vw-2rem)] rounded border border-border bg-popover p-3 text-popover-foreground shadow-lg">
          <p class="mb-3 break-all text-sm">{currentUser.email}</p>
          <div class="flex flex-col gap-2">
            <button type="button" class="ot-workbench-ghost" onclick={async () => { accountOpen = false; await tick(); apiKeysModalOpen = true; }}>API keys</button>
            <button type="button" class="ot-workbench-ghost" onclick={() => { accountOpen = false; void handleLogout(); }}>Sign out</button>
          </div>
        </Popover.Content></Popover.Portal>
      </Popover.Root>
    {:else}
      <button type="button" class="ot-workbench-ghost" onclick={() => (authDialogOpen = true)}>Sign in</button>
    {/if}
  </div>
</div>
<div class="context-row" aria-label="Chart data context">
  <span class="ot-ctx-pill"><span class="ot-ctx-label">SYM</span><span class="ot-ctx-value">{symbol || '—'}</span></span>
  <div class="context-group" aria-label="Bar interval"><span class="context-label">Interval</span><IntervalPicker bind:value={interval} /></div>
  {#if compact}<Popover.Root bind:open={dataSettingsOpen}>
    <Popover.Trigger class="ot-workbench-ghost">Data settings</Popover.Trigger>
    <Popover.Portal><Popover.Content sideOffset={6} align="end" collisionPadding={8} class="z-[60] w-[320px] max-w-[calc(100vw-16px)] rounded border border-border bg-popover p-3 text-popover-foreground shadow-lg">
      <div class="data-controls">{@render dataControls()}</div>
    </Popover.Content></Popover.Portal>
  </Popover.Root>
  {:else}<div class="data-controls">{@render dataControls()}</div>{/if}
  <span class="request-status" role="status">{isLoading ? 'Loading…' : errorMessage ? 'Data error' : streamActive ? `Stream · ${connectionStatus}` : loadedProvider ? `Historical · ${loadedProvider}` : 'No data loaded'}</span>
</div>
</header>

<AuthDialog bind:open={authDialogOpen} />
<ApiKeysModal bind:open={apiKeysModalOpen} />

<style>
  .workbench-header { background: oklch(var(--background)); border-bottom: 1px solid oklch(var(--border)); position: relative; z-index: 40; flex-shrink: 0; }
  .global-row, .context-row, .data-controls { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .global-row { padding: 8px 12px; border-bottom: 1px solid oklch(var(--border)); }
  .context-row { padding: 6px 12px; flex-wrap: wrap; }
  .account-zone { margin-left: auto; flex-shrink: 0; }
  .task-navigation { display: flex; align-items: center; align-self: stretch; gap: 4px; }
  .task-link { background: transparent; border: 0; border-bottom: 2px solid transparent; color: oklch(var(--muted-foreground)); padding: 6px 10px; font: 600 13px var(--font-family-lato); cursor: pointer; }
  .task-link:hover { color: oklch(var(--foreground)); background: oklch(var(--accent)); }
  .task-link[aria-current] { color: oklch(var(--foreground)); border-bottom-color: oklch(var(--primary)); }
  .task-link:focus-visible { outline: 2px solid oklch(var(--ring)); outline-offset: -2px; }
  .context-group { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .context-label { font: 12px var(--font-family-lato); color: oklch(var(--muted-foreground)); }
  .stream-control[aria-pressed="true"] { border-color: oklch(var(--primary)); }
  .request-status { font: 11px var(--font-mono); color: oklch(var(--muted-foreground)); }
  @media (max-width: 760px) {
    .global-row { flex-wrap: wrap; gap: 4px; padding: 6px 8px; }
    .task-navigation { order: 3; flex-basis: 100%; }
    .task-link { flex: 1; }
    .context-row { gap: 6px; padding: 6px 8px; }
    .data-controls { flex-wrap: wrap; }
    .context-label { display: none; }
    .request-status { flex-basis: 100%; }
  }
</style>

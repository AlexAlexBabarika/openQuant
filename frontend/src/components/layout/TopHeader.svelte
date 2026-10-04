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
  import * as Dialog from '$lib/components/ui/dialog';
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
    errorMessage?: string | null;
    compact?: boolean;
  } = $props();

  let authDialogOpen = $state(false);
  let apiKeysModalOpen = $state(false);
  let accountOpen = $state(false);
  let dataSettingsOpen = $state(false);
  let currentUser = $derived($authState.user);

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
  <PeriodPicker bind:value={period} />
  <Select.Root type="single" bind:value={source}>
    <Select.Trigger class="ot-ctx-pill h-7 px-3 outline-none [&_svg]:opacity-60" aria-label="Market data source">
      <span class="ot-ctx-label">SRC</span><span class="ot-ctx-value">{activeSourceLabel}</span>
    </Select.Trigger>
    <Select.Content>{#each MARKET_DATA_PROVIDERS as p (p.value)}<Select.Item value={p.value}>{p.label}</Select.Item>{/each}</Select.Content>
  </Select.Root>
  <input type="file" accept=".csv,text/csv" class="hidden" bind:this={fileInput} onchange={handleFileChange} />
  {#if source === 'csv'}
    <button type="button" class="ot-workbench-ghost" onclick={handleLoad} disabled={isLoading}>
      {#if isLoading}<LoaderCircle class="h-3 w-3 animate-spin" />{/if}
      <span>{isLoading ? 'loading…' : 'upload csv'}</span>
    </button>
  {/if}
  <button type="button" class="ot-workbench-primary {streamActive ? 'stop' : ''}" onclick={onstream} disabled={!streamable || (source !== 'csv' && !symbol.trim())} title={!streamable ? `Live streaming is not available for ${source}.` : streamActive ? 'Stop the live stream' : 'Start a live stream (load data first unless using yfinance)'}>
    <span>{streamActive ? 'STOP' : 'STREAM'}</span>
    {#if connectionStatus === 'connecting'}<span class="ot-stream-dot idle"></span>
    {:else if connectionStatus === 'connected'}<span class="ot-stream-dot" aria-label="Connected"></span>
    {:else if connectionStatus === 'error'}<span class="ot-stream-dot error" aria-label="Stream error"></span>{/if}
  </button>
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

  <button type="button" class="ot-workbench-ghost" onclick={onstrategy}>Strategy</button>

  <Dialog.Trigger>
    {#snippet child({ props })}
      <button {...props} class="ot-workbench-ghost" title="Check your workspace strategy and selected market data, or explore built-in examples">Robustness</button>
    {/snippet}
  </Dialog.Trigger>

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
  <IntervalPicker bind:value={interval} />
  {#if compact}<Popover.Root bind:open={dataSettingsOpen}>
    <Popover.Trigger class="ot-workbench-ghost">Data settings</Popover.Trigger>
    <Popover.Portal><Popover.Content sideOffset={6} align="end" collisionPadding={8} class="z-[60] w-[320px] max-w-[calc(100vw-16px)] rounded border border-border bg-popover p-3 text-popover-foreground shadow-lg">
      <div class="data-controls">{@render dataControls()}</div>
    </Popover.Content></Popover.Portal>
  </Popover.Root>
  {:else}<div class="data-controls">{@render dataControls()}</div>{/if}
  <span class="request-status" role="status">{isLoading ? 'Loading…' : errorMessage ? 'Data error' : streamActive ? connectionStatus : 'Historical'}</span>
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
  .request-status { font: 11px var(--font-mono); color: oklch(var(--muted-foreground)); }
  @media (max-width: 760px) {
    .global-row { gap: 4px; padding: 6px 8px; }
    .context-row { gap: 6px; padding: 6px 8px; }
    .data-controls { flex-wrap: wrap; }
    .request-status { flex-basis: 100%; }
  }
</style>

<script lang="ts">
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
  } = $props();

  let authDialogOpen = $state(false);
  let apiKeysModalOpen = $state(false);
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

<div
  class="flex items-center gap-3 px-4 py-2.5 bg-background border-b border-border flex-wrap relative z-40"
>
  <!-- Brand zone -->
  <div
    class="flex items-center gap-1.5 font-mono text-sm font-semibold tracking-tight select-none"
  >
    <span>openQuant</span>
    <ChartCandlestick class="h-4 w-4 text-primary" />
  </div>

  <Dialog.Trigger>
    {#snippet child({ props })}
      <button {...props} class="ot-workbench-ghost" title="Check your workspace strategy and selected market data, or explore built-in examples">Robustness</button>
    {/snippet}
  </Dialog.Trigger>

  <span class="ot-hairline-v"></span>

  <!-- Timeframe zone — period × interval grouped together -->
  <PeriodPicker bind:value={period} />
  <span class="ot-hairline-v"></span>
  <IntervalPicker bind:value={interval} />

  <span class="ot-hairline-v"></span>

  <!-- Source zone — ctx pill instead of vanilla select -->
  <Select.Root type="single" bind:value={source}>
    <Select.Trigger
      class="ot-ctx-pill h-7 px-3 outline-none [&_svg]:opacity-60"
      aria-label="Market data source"
    >
      <span class="ot-ctx-label">SRC</span>
      <span class="ot-ctx-value">{activeSourceLabel}</span>
    </Select.Trigger>
    <Select.Content>
      {#each MARKET_DATA_PROVIDERS as p (p.value)}
        <Select.Item value={p.value}>{p.label}</Select.Item>
      {/each}
    </Select.Content>
  </Select.Root>

  <!-- CSV upload action (only when source is CSV — unchanged behaviour) -->
  <input
    type="file"
    accept=".csv,text/csv"
    class="hidden"
    bind:this={fileInput}
    onchange={handleFileChange}
  />
  {#if source === 'csv'}
    <button
      type="button"
      class="ot-workbench-ghost"
      onclick={handleLoad}
      disabled={isLoading}
    >
      {#if isLoading}
        <LoaderCircle class="h-3 w-3 animate-spin" />
      {/if}
      <span>{isLoading ? 'loading…' : 'upload csv'}</span>
    </button>
  {/if}

  <button
    type="button"
    class="ot-workbench-primary {streamActive ? 'stop' : ''}"
    onclick={onstream}
    disabled={!streamable || (source !== 'csv' && !symbol.trim())}
    title={!streamable
      ? `Live streaming is not available for ${source}.`
      : streamActive
        ? 'Stop the live stream'
        : 'Start a live stream (load data first unless using yfinance)'}
  >
    <span>{streamActive ? 'STOP' : 'STREAM'}</span>
    {#if connectionStatus === 'connecting'}
      <span class="ot-stream-dot idle"></span>
    {:else if connectionStatus === 'connected'}
      <span class="ot-stream-dot" aria-label="Connected"></span>
    {:else if connectionStatus === 'error'}
      <span class="ot-stream-dot error" aria-label="Stream error"></span>
    {/if}
  </button>

  <div class="ml-auto flex items-center gap-2">
    {#if currentUser}
      <button
        type="button"
        class="ot-workbench-ghost"
        onclick={() => (apiKeysModalOpen = true)}
      >api keys</button>
      <span class="font-mono text-[11px] tracking-[0.04em] text-muted-foreground truncate max-w-[180px]">
        {currentUser.email}
      </span>
      <button
        type="button"
        class="ot-workbench-ghost"
        onclick={handleLogout}
      >sign out</button>
    {:else}
      <button
        type="button"
        class="ot-workbench-ghost"
        onclick={() => (authDialogOpen = true)}
      >sign in</button>
    {/if}
  </div>
</div>

<AuthDialog bind:open={authDialogOpen} />
<ApiKeysModal bind:open={apiKeysModalOpen} />

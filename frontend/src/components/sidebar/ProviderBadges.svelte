<script lang="ts">
  import type { SymbolProviders } from '$lib/features/market/symbols';

  let {
    providers,
    size = 'sm',
  }: {
    providers: SymbolProviders;
    size?: 'xs' | 'sm';
  } = $props();

  const LABELS: { key: keyof SymbolProviders; short: string; full: string }[] = [
    { key: 'twelvedata', short: 'TD', full: 'Twelve Data' },
    { key: 'yfinance', short: 'YF', full: 'Yahoo Finance' },
    { key: 'binance', short: 'BN', full: 'Binance' },
  ];

  let textClass = $derived(size === 'xs' ? 'text-[10px]' : 'text-[11px]');
  let padClass = $derived(size === 'xs' ? 'px-1 py-0' : 'px-1.5 py-0.5');
</script>

<span class="inline-flex items-center gap-1">
  {#each LABELS as { key, short, full } (key)}
    {@const on = providers[key]}
    <span
      class="inline-flex items-center rounded border font-mono tracking-wider uppercase {textClass} {padClass} {on
        ? 'border-border bg-secondary text-secondary-foreground'
        : 'border-border bg-muted text-muted-foreground'}"
      aria-label="{full}: {on ? 'supported' : 'not in directory'}"
      title="{full}: {on ? 'supported' : 'not in directory'}"
    >
      {short}
    </span>
  {/each}
</span>

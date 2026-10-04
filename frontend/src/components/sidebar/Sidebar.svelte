<script lang="ts">
  import Plus from '@lucide/svelte/icons/plus';
  import Flag from '@lucide/svelte/icons/flag';
  import Tag from '@lucide/svelte/icons/tag';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Check from '@lucide/svelte/icons/check';
  import NotebookPen from '@lucide/svelte/icons/notebook-pen';
  import { ContextMenu } from 'bits-ui';
  import GroupSelector from './GroupSelector.svelte';
  import NotesPanel from './NotesPanel.svelte';
  import ProviderBadges from './ProviderBadges.svelte';
  import {
    TickerPriority,
    TickerStance,
    PRIORITY_COLOURS,
    PRIORITY_OPTIONS,
    STANCE_COLOURS,
    STANCE_OPTIONS,
  } from '$lib/features/market/tickers';
  import type {
    TickerGroup,
    TrackedTicker,
    GroupActions,
    FlaggedPriority,
    FlaggedStance,
  } from '$lib/features/market/tickers';
  import type { TickerQuote } from '$lib/features/market/tickerQuotes';
  import { formatMarketPrice } from '$lib/features/market/priceFormat';
  import type { TickerNote } from '$lib/features/notes/notes';

  let {
    sheet = false,
    symbol = '',
    symbolFullName = null as string | null,
    symbolExchange = null as string | null,
    closePrice = null as number | null,
    groups,
    selectedGroupName,
    selectedPriority,
    selectedStance,
    priorityCounts,
    stanceCounts,
    tickers,
    quotes,
    groupActions,
    onaddticker,
    onselectpriority,
    onselectstance,
    onselectticker,
    ondeleteticker,
    onsetpriority,
    onsetstance,
    notes = [],
    onaddnote,
    oneditnote,
    ondeletenote,
  }: {
    sheet?: boolean;
    symbol?: string;
    symbolFullName?: string | null;
    symbolExchange?: string | null;
    closePrice?: number | null;
    groups: TickerGroup[];
    selectedGroupName: string;
    selectedPriority: FlaggedPriority | null;
    selectedStance: FlaggedStance | null;
    priorityCounts: Record<FlaggedPriority, number>;
    stanceCounts: Record<FlaggedStance, number>;
    tickers: TrackedTicker[];
    quotes: Record<string, TickerQuote>;
    groupActions: GroupActions;
    onaddticker: () => void;
    onselectpriority: (p: FlaggedPriority) => void;
    onselectstance: (s: FlaggedStance) => void;
    onselectticker: (symbol: string) => void;
    ondeleteticker: (symbol: string) => void;
    onsetpriority: (symbol: string, priority: TickerPriority) => void;
    onsetstance: (symbol: string, stance: TickerStance) => void;
    notes?: TickerNote[];
    onaddnote: (symbol: string) => void;
    oneditnote: (note: TickerNote) => void;
    ondeletenote: (id: string) => void;
  } = $props();

  let aggregateFilterActive = $derived(
    selectedPriority !== null || selectedStance !== null,
  );

  function formatQuote(q: TickerQuote | undefined): string {
    if (!q || q.status === 'loading') return '…';
    if (q.status === 'error') return '—';
    return formatMarketPrice(q.close, true);
  }

  const loadedSymbolKey = $derived((symbol ?? '').trim().toUpperCase());

  const currentTicker = $derived(
    tickers.find(t => t.symbol.toUpperCase() === loadedSymbolKey) ?? null,
  );

  const hasSidebarTags = $derived(
    currentTicker != null &&
      (currentTicker.priority !== TickerPriority.None ||
        currentTicker.stance !== TickerStance.None),
  );
</script>

<aside
  class="{sheet ? 'w-full min-w-0 flex-1 min-h-0' : 'w-[17%] min-w-[200px]'} border-l border-border bg-background flex flex-col shrink-0 overflow-visible"
  aria-label="Sidebar"
>
  <div class="flex items-center justify-between px-2 py-2 border-b border-border h-10">
    <GroupSelector
      {groups}
      selectedName={selectedGroupName}
      {selectedPriority}
      {selectedStance}
      {priorityCounts}
      {stanceCounts}
      actions={groupActions}
      {onselectpriority}
      {onselectstance}
    />
    <div class="flex items-center gap-1">
      <button
        type="button"
        class="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-accent hover:text-accent-foreground text-muted-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
        aria-label="Add symbol"
        disabled={aggregateFilterActive}
        title={aggregateFilterActive
          ? 'Switch to a group to add symbols'
          : undefined}
        onclick={onaddticker}
      >
        <Plus class="h-4 w-4" />
      </button>
    </div>
  </div>

  <div class="flex-1 min-h-0 overflow-y-auto">
    {#if tickers.length === 0}
      <div class="px-3 py-4 text-xs text-muted-foreground">
        {#if selectedStance}
          No tickers with this stance.
        {:else if selectedPriority}
          No tickers with this priority.
        {:else}
          No symbols yet. Click + to add one.
        {/if}
      </div>
    {:else}
      <div class="py-1">
        {#each tickers as ticker (ticker.symbol)}
          <ContextMenu.Root>
            <ContextMenu.Trigger class="block w-full">
              {@const isLoaded =
                ticker.symbol.toUpperCase() === loadedSymbolKey}
              <button
                type="button"
                class="ot-keyline-host ot-keyline-flush relative flex w-full items-center justify-between gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-accent hover:text-accent-foreground transition-colors {isLoaded
                  ? 'ot-keyline-active bg-primary/[0.08]'
                  : ''}"
                aria-current={isLoaded ? 'true' : undefined}
                onclick={() => onselectticker(ticker.symbol)}
              >
                <span class="flex items-center gap-1.5 min-w-0">
                  {#if ticker.priority !== TickerPriority.None}
                    {@const colour = PRIORITY_COLOURS[ticker.priority]}
                    <Flag
                      class="h-3 w-3 shrink-0"
                      style="color: {colour}; fill: {colour};"
                    />
                  {/if}
                  {#if ticker.stance !== TickerStance.None}
                    {@const sColour = STANCE_COLOURS[ticker.stance]}
                    <Tag
                      class="h-3 w-3 shrink-0"
                      style="color: {sColour}; fill: {sColour};"
                    />
                  {/if}
                  <span class="truncate">{ticker.symbol}</span>
                  {#if ticker.providers}
                    <ProviderBadges providers={ticker.providers} size="xs" />
                  {/if}
                </span>
                <span
                  class="font-mono tabular-nums text-muted-foreground shrink-0"
                  title={quotes[ticker.symbol]?.status === 'error'
                    ? 'Failed to fetch — will retry when group or source changes'
                    : undefined}
                >
                  {formatQuote(quotes[ticker.symbol])}
                </span>
              </button>
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
              <ContextMenu.Content
                class="z-[80] w-44 rounded-md border border-border bg-popover text-popover-foreground shadow-md py-1 outline-none"
              >
                <ContextMenu.Item
                  onSelect={() => onaddnote(ticker.symbol)}
                  class="flex w-full items-center gap-2 px-3 py-1.5 text-sm data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground cursor-default outline-none"
                >
                  <NotebookPen class="h-3.5 w-3.5" /> Add note
                </ContextMenu.Item>
                <ContextMenu.Item
                  onSelect={() => ondeleteticker(ticker.symbol)}
                  class="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-destructive data-[highlighted]:bg-destructive/10 cursor-default outline-none"
                >
                  <Trash2 class="h-3.5 w-3.5" /> Delete ticker
                </ContextMenu.Item>
                <ContextMenu.Separator class="my-1 h-px bg-border" />
                <div
                  class="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
                >
                  Priority
                </div>
                {#each PRIORITY_OPTIONS as p (p)}
                  <ContextMenu.Item
                    onSelect={() => onsetpriority(ticker.symbol, p)}
                    class="flex w-full items-center gap-2 px-3 py-1.5 text-sm data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground cursor-default outline-none"
                  >
                    {#if p === TickerPriority.None}
                      <span
                        class="h-2 w-2 rounded-full border border-muted-foreground/40 shrink-0"
                      ></span>
                    {:else}
                      <span
                        class="h-2 w-2 rounded-full shrink-0"
                        style="background: {PRIORITY_COLOURS[p]};"
                      ></span>
                    {/if}
                    <span class="flex-1 text-left capitalize">{p}</span>
                    {#if p === ticker.priority}
                      <Check class="h-3.5 w-3.5" />
                    {/if}
                  </ContextMenu.Item>
                {/each}
                <ContextMenu.Separator class="my-1 h-px bg-border" />
                <div
                  class="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
                >
                  Stance
                </div>
                {#each STANCE_OPTIONS as st (st)}
                  <ContextMenu.Item
                    onSelect={() => onsetstance(ticker.symbol, st)}
                    class="flex w-full items-center gap-2 px-3 py-1.5 text-sm data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground cursor-default outline-none"
                  >
                    {#if st === TickerStance.None}
                      <span
                        class="h-2 w-2 rounded-full border border-muted-foreground/40 shrink-0"
                      ></span>
                    {:else}
                      <span
                        class="h-2 w-2 rounded-full shrink-0"
                        style="background: {STANCE_COLOURS[st]};"
                      ></span>
                    {/if}
                    <span class="flex-1 text-left capitalize">{st}</span>
                    {#if st === ticker.stance}
                      <Check class="h-3.5 w-3.5" />
                    {/if}
                  </ContextMenu.Item>
                {/each}
              </ContextMenu.Content>
            </ContextMenu.Portal>
          </ContextMenu.Root>
        {/each}
      </div>
    {/if}
  </div>

  <div class="border-t border-border px-3 py-2">
    <div class="text-[10px] font-medium tracking-wider uppercase text-muted-foreground">
      Current Symbol
    </div>
    <div class="mt-1 flex items-start justify-between gap-2">
      <div class="min-w-0 flex-1">
        <div class="text-sm font-semibold text-foreground truncate leading-snug">
          {symbol || '—'}
        </div>
        {#if symbolFullName}
          <div
            class="mt-0.5 text-xs text-muted-foreground truncate leading-snug"
          >
            {symbolFullName}
          </div>
        {/if}
        {#if symbolExchange}
          <div
            class="mt-0.5 text-[10px] text-muted-foreground truncate leading-snug"
          >
            {symbolExchange}
          </div>
        {/if}
      </div>
      <div class="shrink-0 text-right min-w-0">
        <div
          class="text-sm font-mono tabular-nums text-foreground leading-snug"
        >
          {formatMarketPrice(closePrice, true)}
        </div>
        {#if hasSidebarTags && currentTicker}
          <div
            class="mt-1 flex flex-wrap items-center justify-end gap-1 max-w-[10rem] sm:max-w-[12rem]"
          >
            {#if currentTicker.priority !== TickerPriority.None}
              {@const p = currentTicker.priority}
              <span
                class="inline-flex rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none capitalize"
                style="border-color: {PRIORITY_COLOURS[
                  p
                ]}; color: {PRIORITY_COLOURS[p]}; background: color-mix(in srgb, {PRIORITY_COLOURS[
                  p
                ]} 12%, transparent);"
              >
                {p}
              </span>
            {/if}
            {#if currentTicker.stance !== TickerStance.None}
              {@const s = currentTicker.stance}
              <span
                class="inline-flex rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none capitalize"
                style="border-color: {STANCE_COLOURS[
                  s
                ]}; color: {STANCE_COLOURS[s]}; background: color-mix(in srgb, {STANCE_COLOURS[
                  s
                ]} 12%, transparent);"
              >
                {s}
              </span>
            {/if}
          </div>
        {/if}
      </div>
    </div>
    {#if symbol}
      <NotesPanel {notes} onedit={oneditnote} ondelete={ondeletenote} />
    {/if}
  </div>
</aside>

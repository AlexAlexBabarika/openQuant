<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Star from '@lucide/svelte/icons/star';
  import { DropdownMenu } from 'bits-ui';
  import {
    GROUPED_INTERVALS,
    loadIntervalFavourites,
    persistIntervalFavourites,
    sortFavouritesByCanonical,
  } from '$lib/features/market/marketIntervals';

  let {
    value = $bindable(),
    compact = false,
  }: {
    value: string;
    compact?: boolean;
  } = $props();

  let favourites = $state<string[]>(loadIntervalFavourites());

  $effect(() => {
    persistIntervalFavourites(favourites);
  });

  let sortedFavourites = $derived(sortFavouritesByCanonical(favourites));
  let favouriteSet = $derived(new Set(favourites));

  function toggleFavourite(v: string, event?: Event) {
    event?.preventDefault();
    event?.stopPropagation();
    favourites = favouriteSet.has(v)
      ? favourites.filter(f => f !== v)
      : [...favourites, v];
  }

  function selectValue(v: string) {
    value = v;
  }

  function findLongLabel(v: string): string {
    for (const g of GROUPED_INTERVALS) {
      const o = g.options.find(opt => opt.value === v);
      if (o) return o.longLabel;
    }
    return v;
  }
</script>

<div class="flex items-center gap-0.5">
  {#each compact ? [] : sortedFavourites as fav (fav)}
    <button
      type="button"
      title={findLongLabel(fav)}
      class="px-2 h-7 rounded-sm font-mono text-[11px] lowercase tracking-[0.04em] transition-colors {value === fav
        ? 'bg-accent text-accent-foreground'
        : 'text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground'}"
      onclick={() => selectValue(fav)}
    >
      {fav}
    </button>
  {/each}

  <DropdownMenu.Root>
    <DropdownMenu.Trigger
      class="inline-flex items-center justify-center h-7 w-6 rounded-sm text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground transition-colors outline-none {compact ? 'min-h-11 gap-2 border border-input px-3 text-sm font-mono' : ''}"
      aria-label={compact ? `Bar interval ${value}; choose interval` : 'All intervals'}
    >
      {#if compact}<span>{value}</span>{/if}
      <ChevronDown class="h-3.5 w-3.5" />
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align="end"
        sideOffset={6}
        class="z-50 w-64 max-h-[28rem] overflow-y-auto rounded-md border border-border bg-popover text-popover-foreground shadow-lg py-1 outline-none"
      >
        {#each GROUPED_INTERVALS as group, gi (group.category)}
          {#if gi > 0}
            <DropdownMenu.Separator class="my-1 h-px bg-border" />
          {/if}
          <div
            class="px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground"
          >
            {group.category}
          </div>
          {#each group.options as opt (opt.value)}
            {@const isFav = favouriteSet.has(opt.value)}
            {@const isActive = value === opt.value}
            <DropdownMenu.Item
              onSelect={() => selectValue(opt.value)}
              class="group/item flex w-full items-center gap-2 px-3 {compact ? 'py-0' : 'py-1.5'} text-sm data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground cursor-default outline-none {isActive
                ? 'bg-accent/60 text-accent-foreground'
                : ''}"
            >
              <span class="flex-1 text-left">{opt.longLabel}</span>
              <button
                type="button"
                aria-label={isFav ? 'Remove favourite' : 'Add favourite'}
                class="inline-flex items-center justify-center {compact ? 'h-11 w-11' : 'h-5 w-5'} rounded transition-opacity {isFav || compact
                  ? 'opacity-100'
                  : 'opacity-0 group-hover/item:opacity-60 group-data-[highlighted]/item:opacity-60'} hover:!opacity-100"
                onclick={e => toggleFavourite(opt.value, e)}
                onpointerdown={e => e.stopPropagation()}
                onpointerup={e => e.stopPropagation()}
                onkeydown={e => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); }}
              >
                <Star
                  class="h-3.5 w-3.5 {isFav
                    ? 'fill-yellow-400 text-yellow-400'
                    : 'text-muted-foreground'}"
                />
              </button>
            </DropdownMenu.Item>
          {/each}
        {/each}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
</div>

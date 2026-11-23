<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Star from '@lucide/svelte/icons/star';
  import { DropdownMenu } from 'bits-ui';
  import {
    GROUPED_PERIODS,
    loadPeriodFavourites,
    persistPeriodFavourites,
    sortPeriodFavouritesByCanonical,
  } from '$lib/features/market/marketPeriods';

  let {
    value = $bindable(),
  }: {
    value: string;
  } = $props();

  let favourites = $state<string[]>(loadPeriodFavourites());

  $effect(() => {
    persistPeriodFavourites(favourites);
  });

  let sortedFavourites = $derived(sortPeriodFavouritesByCanonical(favourites));
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

  function findShortLabel(v: string): string {
    for (const g of GROUPED_PERIODS) {
      const o = g.options.find(opt => opt.value === v);
      if (o) return o.label;
    }
    return v;
  }

  function findLongLabel(v: string): string {
    for (const g of GROUPED_PERIODS) {
      const o = g.options.find(opt => opt.value === v);
      if (o) return o.longLabel;
    }
    return v;
  }
</script>

<div class="flex items-center gap-0.5">
  {#each sortedFavourites as fav (fav)}
    <button
      type="button"
      title={findLongLabel(fav)}
      class="px-2 h-7 rounded-sm font-mono text-[11px] lowercase tracking-[0.04em] transition-colors {value === fav
        ? 'bg-accent text-accent-foreground forced-color-adjust-none forced-colors:bg-[Highlight] forced-colors:text-[HighlightText]'
        : 'text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground'}"
      onclick={() => selectValue(fav)}
    >
      {findShortLabel(fav)}
    </button>
  {/each}

  <DropdownMenu.Root>
    <DropdownMenu.Trigger
      class="inline-flex items-center justify-center h-7 w-6 rounded-sm text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground transition-colors outline-none"
      aria-label="All periods"
    >
      <ChevronDown class="h-3.5 w-3.5" />
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align="end"
        sideOffset={6}
        class="z-50 w-64 max-h-[28rem] overflow-y-auto rounded-md border border-border bg-popover text-popover-foreground shadow-popover py-1 outline-none"
      >
        {#each GROUPED_PERIODS as group, gi (group.category)}
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
              class="group/item flex w-full items-center gap-2 px-3 py-1.5 text-sm data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground cursor-default outline-none {isActive
                ? 'bg-accent/60 text-accent-foreground'
                : ''}"
            >
              <span class="flex-1 text-left">{opt.longLabel}</span>
              <button
                type="button"
                aria-label={isFav ? 'Remove favourite' : 'Add favourite'}
                class="inline-flex items-center justify-center h-5 w-5 rounded transition-opacity {isFav
                  ? 'opacity-100'
                  : 'opacity-0 group-hover/item:opacity-60 group-data-[highlighted]/item:opacity-60'} hover:!opacity-100"
                onclick={e => toggleFavourite(opt.value, e)}
                onpointerdown={e => e.stopPropagation()}
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

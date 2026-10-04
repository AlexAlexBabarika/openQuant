<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Copy from '@lucide/svelte/icons/copy';
  import Eraser from '@lucide/svelte/icons/eraser';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Flag from '@lucide/svelte/icons/flag';
  import Tag from '@lucide/svelte/icons/tag';
  import Check from '@lucide/svelte/icons/check';
  import { DropdownMenu } from 'bits-ui';
  import type {
    TickerGroup,
    GroupActions,
    FlaggedPriority,
    FlaggedStance,
  } from '$lib/features/market/tickers';
  import {
    FLAGGED_PRIORITIES,
    FLAGGED_STANCES,
    PRIORITY_COLOURS,
    STANCE_COLOURS,
  } from '$lib/features/market/tickers';

  let {
    groups,
    selectedName,
    selectedPriority,
    selectedStance,
    priorityCounts,
    stanceCounts,
    actions,
    onselectpriority,
    onselectstance,
  }: {
    groups: TickerGroup[];
    selectedName: string;
    selectedPriority: FlaggedPriority | null;
    selectedStance: FlaggedStance | null;
    priorityCounts: Record<FlaggedPriority, number>;
    stanceCounts: Record<FlaggedStance, number>;
    actions: GroupActions;
    onselectpriority: (p: FlaggedPriority) => void;
    onselectstance: (s: FlaggedStance) => void;
  } = $props();

  let inGroupMode = $derived(
    selectedPriority === null && selectedStance === null,
  );
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger
    class="inline-flex items-center gap-1 rounded h-7 px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors max-w-[140px] outline-none"
  >
    {#if selectedPriority}
      {@const colour = PRIORITY_COLOURS[selectedPriority]}
      <Flag
        class="h-3 w-3 shrink-0"
        style="color: {colour}; fill: {colour};"
      />
      <span class="truncate capitalize">{selectedPriority}</span>
    {:else if selectedStance}
      {@const colour = STANCE_COLOURS[selectedStance]}
      <Tag
        class="h-3 w-3 shrink-0"
        style="color: {colour}; fill: {colour};"
      />
      <span class="truncate capitalize">{selectedStance}</span>
    {:else}
      <span class="truncate">{selectedName}</span>
    {/if}
    <ChevronDown class="h-3.5 w-3.5 shrink-0" />
  </DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content
      align="start"
      sideOffset={4}
      class="z-[80] w-56 rounded-md border border-border bg-popover text-popover-foreground shadow-md py-1 outline-none"
    >
      {#if inGroupMode}
        <DropdownMenu.Item
          onSelect={actions.rename}
          class="flex w-full items-center gap-2 px-3 py-1.5 text-sm data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground cursor-default outline-none"
        >
          <Pencil class="h-3.5 w-3.5" /> Rename current
        </DropdownMenu.Item>
        <DropdownMenu.Item
          onSelect={actions.duplicate}
          class="flex w-full items-center gap-2 px-3 py-1.5 text-sm data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground cursor-default outline-none"
        >
          <Copy class="h-3.5 w-3.5" /> Duplicate current
        </DropdownMenu.Item>
        <DropdownMenu.Item
          onSelect={actions.clear}
          class="flex w-full items-center gap-2 px-3 py-1.5 text-sm data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground cursor-default outline-none"
        >
          <Eraser class="h-3.5 w-3.5" /> Clear current
        </DropdownMenu.Item>
      {/if}
      <DropdownMenu.Item
        onSelect={actions.add}
        class="flex w-full items-center gap-2 px-3 py-1.5 text-sm data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground cursor-default outline-none"
      >
        <Plus class="h-3.5 w-3.5" /> Add new group
      </DropdownMenu.Item>
      {#if inGroupMode && groups.length > 1}
        <DropdownMenu.Item
          onSelect={actions.delete}
          class="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-destructive data-[highlighted]:bg-destructive/10 cursor-default outline-none"
        >
          <Trash2 class="h-3.5 w-3.5" /> Delete current
        </DropdownMenu.Item>
      {/if}

      <DropdownMenu.Separator class="my-1 h-px bg-border" />

      <div class="max-h-60 overflow-y-auto">
        {#each groups as group (group.name)}
          <DropdownMenu.Item
            onSelect={() => actions.select(group.name)}
            class="ot-keyline-host ot-keyline-flush relative flex w-full items-center px-3 py-1.5 text-sm data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground cursor-default outline-none {inGroupMode &&
            group.name === selectedName
              ? 'ot-keyline-active bg-primary/[0.08]'
              : ''}"
          >
            <span class="truncate">{group.name}</span>
          </DropdownMenu.Item>
        {/each}
      </div>

      <DropdownMenu.Separator class="my-1 h-px bg-border" />
      <div
        class="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
      >
        By priority
      </div>
      {#each FLAGGED_PRIORITIES as p (p)}
        {@const colour = PRIORITY_COLOURS[p]}
        <DropdownMenu.Item
          onSelect={() => onselectpriority(p)}
          class="ot-keyline-host ot-keyline-flush relative flex w-full items-center gap-2 px-3 py-1.5 text-sm data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground cursor-default outline-none {selectedPriority ===
          p
            ? 'ot-keyline-active bg-primary/[0.08]'
            : ''}"
        >
          <Flag
            class="h-3.5 w-3.5 shrink-0"
            style="color: {colour}; fill: {colour};"
          />
          <span class="flex-1 text-left capitalize">{p}</span>
          <span class="text-xs text-muted-foreground tabular-nums">
            {priorityCounts[p]}
          </span>
          {#if selectedPriority === p}
            <Check class="h-3.5 w-3.5" />
          {/if}
        </DropdownMenu.Item>
      {/each}

      <DropdownMenu.Separator class="my-1 h-px bg-border" />
      <div
        class="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
      >
        By stance
      </div>
      {#each FLAGGED_STANCES as s (s)}
        {@const colour = STANCE_COLOURS[s]}
        <DropdownMenu.Item
          onSelect={() => onselectstance(s)}
          class="ot-keyline-host ot-keyline-flush relative flex w-full items-center gap-2 px-3 py-1.5 text-sm data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground cursor-default outline-none {selectedStance ===
          s
            ? 'ot-keyline-active bg-primary/[0.08]'
            : ''}"
        >
          <Tag
            class="h-3.5 w-3.5 shrink-0"
            style="color: {colour}; fill: {colour};"
          />
          <span class="flex-1 text-left capitalize">{s}</span>
          <span class="text-xs text-muted-foreground tabular-nums">
            {stanceCounts[s]}
          </span>
          {#if selectedStance === s}
            <Check class="h-3.5 w-3.5" />
          {/if}
        </DropdownMenu.Item>
      {/each}
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>

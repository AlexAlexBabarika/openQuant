<script lang="ts">
  import { tick } from 'svelte';
  import { Popover } from 'bits-ui';
  import Crosshair from '@lucide/svelte/icons/crosshair';
  import Check from '@lucide/svelte/icons/check';
  import Settings from '@lucide/svelte/icons/settings';
  import X from '@lucide/svelte/icons/x';
  import {
    CROSSHAIR_MODES,
    type CrosshairModeName,
  } from '$lib/features/chart/crosshair';
  import BadgeDollarSign from '@lucide/svelte/icons/badge-dollar-sign';
  import {
    listToolbarDrawableTools,
    POSITION_TOOLBAR_MODES,
    CURSOR,
    type ActiveTool,
    type DrawableToolbarCommands,
  } from '$lib/features/drawables';

  let {
    chartSymbol = '',
    crosshairMode = $bindable<CrosshairModeName>('magnet'),
    activeTool = $bindable<ActiveTool>(CURSOR),
    onToolSettings,
    drawableCommands,
  }: {
    /** Current chart ticker — drawables cleared for this symbol only. */
    chartSymbol?: string;
    crosshairMode: CrosshairModeName;
    activeTool: ActiveTool;
    onToolSettings: (toolType: string) => void;
    /** Injected drawable actions (use `toolbarCommandsFromStore(drawables)` in App; pass fakes in tests). */
    drawableCommands: DrawableToolbarCommands;
  } = $props();

  /** Snapshot at mount; bundled tool list is fixed after `ensureToolsRegistered()`. */
  const tools = listToolbarDrawableTools();
  let crosshairOpen = $state(false);
  let positionPopoverOpen = $state(false);
  let positionTrigger = $state<HTMLButtonElement | null>(null);
  const toolTriggers: Record<string, HTMLButtonElement> = {};
  /** Last position subtype for settings when cursor tool is active. */
  let positionSettingsType = $state<string>(POSITION_TOOLBAR_MODES[0].type);
  /** Popover open state per tool type — keys must exist for bind:open. */
  let toolPopoverOpen = $state<Record<string, boolean>>(
    Object.fromEntries(tools.map(t => [t.type, false])),
  );

  const positionToolActive = $derived(
    POSITION_TOOLBAR_MODES.some(m => m.type === activeTool),
  );

  function selectCrosshair(mode: CrosshairModeName) {
    crosshairMode = mode;
    crosshairOpen = false;
  }

  function activateTool(type: string) {
    activeTool = activeTool === type ? CURSOR : type;
    toolPopoverOpen = { ...toolPopoverOpen, [type]: false };
  }

  function selectPositionTool(type: string) {
    activeTool = activeTool === type ? CURSOR : type;
    positionSettingsType = type;
    positionPopoverOpen = false;
  }

  async function openPositionSettings() {
    const t = positionToolActive ? activeTool : positionSettingsType;
    positionPopoverOpen = false;
    await tick();
    positionTrigger?.focus();
    onToolSettings(t);
  }

  async function openSettings(type: string) {
    toolPopoverOpen = { ...toolPopoverOpen, [type]: false };
    await tick();
    toolTriggers[type]?.focus();
    onToolSettings(type);
  }

  function clearDrawablesForChart() {
    if (!chartSymbol) return;
    drawableCommands.removeAllForSymbol(chartSymbol);
  }
</script>

<div
  class="flex flex-col items-center gap-1 py-1 border-r border-border bg-background w-10 shrink-0 h-full min-h-0"
>
  <Popover.Root bind:open={crosshairOpen}>
    <Popover.Trigger
      class="flex items-center justify-center w-8 h-8 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground forced-colors:focus-visible:outline-[Highlight]"
      aria-label="Crosshair mode"
    >
      <Crosshair class="h-4 w-4" />
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content
        side="right"
        align="start"
        sideOffset={10}
        class="z-[60] min-w-[180px] rounded-lg border border-border bg-popover p-1 shadow-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground forced-colors:focus-visible:outline-[Highlight]"
      >
        {#each CROSSHAIR_MODES as mode (mode.value)}
          {@const Icon = mode.icon}
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground forced-colors:focus-visible:outline-[Highlight]"
            onclick={() => selectCrosshair(mode.value)}
          >
            <Icon class="h-4 w-4 text-muted-foreground shrink-0" />
            <span class="flex-1">{mode.label}</span>
            {#if crosshairMode === mode.value}
              <Check class="h-4 w-4 shrink-0" />
            {/if}
          </button>
        {/each}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>

  <Popover.Root bind:open={positionPopoverOpen}>
    <Popover.Trigger
      bind:ref={positionTrigger}
      class="flex items-center justify-center w-8 h-8 rounded hover:bg-accent transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground forced-colors:focus-visible:outline-[Highlight] {positionToolActive
        ? 'bg-accent text-foreground'
        : 'text-muted-foreground'}"
      aria-label="Long or short position tool"
      aria-pressed={positionToolActive}
    >
      <BadgeDollarSign class="h-4 w-4" />
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content
        side="right"
        align="start"
        sideOffset={10}
        class="z-[60] min-w-[200px] rounded-lg border border-border bg-popover p-1 shadow-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground forced-colors:focus-visible:outline-[Highlight]"
      >
        {#each POSITION_TOOLBAR_MODES as mode (mode.type)}
          {@const Icon = mode.icon}
          <div class="flex items-center gap-1">
            <button
              type="button"
              class="flex flex-1 items-center gap-2 rounded px-2 py-1.5 text-sm text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground forced-colors:focus-visible:outline-[Highlight]"
              onclick={() => selectPositionTool(mode.type)}
            >
              <Icon class="h-4 w-4 text-muted-foreground shrink-0" />
              <span class="flex-1">{mode.label}</span>
              {#if activeTool === mode.type}
                <Check class="h-4 w-4 shrink-0" />
              {/if}
            </button>
          </div>
        {/each}
        <div class="mt-1 flex justify-end border-t border-border pt-1">
          <button
            type="button"
            class="flex items-center justify-center w-8 h-8 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground forced-colors:focus-visible:outline-[Highlight]"
            aria-label="Position tool settings"
            title="Position tool settings"
            onclick={() => openPositionSettings()}
          >
            <Settings class="h-4 w-4" />
          </button>
        </div>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>

  {#each tools as tool (tool.type)}
    {@const Icon = tool.icon}
    <Popover.Root bind:open={toolPopoverOpen[tool.type]!}>
      <Popover.Trigger
        bind:ref={toolTriggers[tool.type]}
        type="button"
        class="flex items-center justify-center w-8 h-8 rounded hover:bg-accent transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground forced-colors:focus-visible:outline-[Highlight] {activeTool ===
        tool.type
          ? 'bg-accent text-foreground'
          : 'text-muted-foreground'}"
        aria-label={tool.label}
        aria-pressed={activeTool === tool.type}
      >
        <Icon class="h-4 w-4" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="right"
          align="start"
          sideOffset={10}
          class="z-[60] min-w-[200px] rounded-lg border border-border bg-popover p-1 shadow-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground forced-colors:focus-visible:outline-[Highlight]"
        >
          <div class="flex items-center gap-1">
            <button
              type="button"
              class="flex flex-1 items-center gap-2 rounded px-2 py-1.5 text-sm text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground forced-colors:focus-visible:outline-[Highlight]"
              onclick={() => activateTool(tool.type)}
            >
              <Icon class="h-4 w-4 text-muted-foreground shrink-0" />
              <span class="flex-1">{tool.label}</span>
              {#if activeTool === tool.type}
                <Check class="h-4 w-4 shrink-0" />
              {/if}
            </button>
            <button
              type="button"
              class="flex items-center justify-center w-8 h-8 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground forced-colors:focus-visible:outline-[Highlight]"
              aria-label="{tool.label} settings"
              title="{tool.label} settings"
              onclick={() => openSettings(tool.type)}
            >
              <Settings class="h-4 w-4" />
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  {/each}

  <div class="mt-auto flex flex-col items-center pt-2">
    <button
      type="button"
      class="flex items-center justify-center w-8 h-8 rounded-sm bg-destructive hover:bg-destructive/90 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground forced-colors:focus-visible:outline-[Highlight] shrink-0"
      aria-label="Clear all drawables on chart"
      title="Clear all drawables"
      onclick={clearDrawablesForChart}
    >
      <X
        class="h-4 w-4 text-white dark:text-zinc-950"
        strokeWidth={2.5}
      />
    </button>
  </div>
</div>

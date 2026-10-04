<script lang="ts">
  import { onDestroy } from 'svelte';
  import { createModalLifecycle } from '$lib/core/modalLifecycle';
  import * as Dialog from '$lib/components/ui/dialog';
  import {
    getTool,
    drawables,
    saveToolDefaults,
    deepCloneDrawableSnapshot,
    type Drawable,
  } from '$lib/features/drawables';
  import ModalFooter from '$lib/features/drawables/ui/ModalFooter.svelte';

  let {
    toolType,
    open = $bindable<boolean>(false),
  }: {
    toolType: string | null;
    open: boolean;
  } = $props();

  let tool = $derived(toolType ? getTool(toolType) : null);

  // Staged copies live for the lifetime of the open modal. Cleared on close.
  let stagedParams = $state<unknown>(null);
  let stagedStyle = $state<unknown>(null);
  let lastOpenedType: string | null = null;
  let panelEl = $state<HTMLDivElement | null>(null);
  const modal = createModalLifecycle();
  onDestroy(() => modal.close());

  $effect(() => {
    if (open && tool && lastOpenedType !== tool.type) {
      stagedParams = deepCloneDrawableSnapshot(tool.defaults.params);
      stagedStyle = deepCloneDrawableSnapshot(tool.defaults.style);
      lastOpenedType = tool.type;
    }
    if (!open) {
      lastOpenedType = null;
    }
  });

  function applyAndClose(): void {
    if (!tool || !toolType) {
      open = false;
      return;
    }
    const nextParams = stagedParams;
    const nextStyle = stagedStyle;

    // Update registry defaults so new drawables use the latest.
    tool.defaults.params = nextParams as typeof tool.defaults.params;
    tool.defaults.style = nextStyle as typeof tool.defaults.style;

    saveToolDefaults(toolType, { params: nextParams, style: nextStyle });

    for (const d of drawables.items) {
      if (d.type === toolType) {
        drawables.update(d.id, {
          params: deepCloneDrawableSnapshot(nextParams),
          style: deepCloneDrawableSnapshot(nextStyle),
        } as Partial<Drawable>);
      }
    }

    open = false;
  }

  function cancel(): void {
    open = false;
  }
</script>

<Dialog.Root
  {open}
  onOpenChange={(v) => {
    open = v;
  }}
>
  <Dialog.Content
    bind:ref={panelEl}
    class="sm:max-w-md"
    showCloseButton={false}
    onOpenAutoFocus={() => modal.open(panelEl)}
    onCloseAutoFocus={() => modal.close()}
  >
    {#if tool && stagedParams !== null && stagedStyle !== null}
      {@const SettingsCmp = tool.Settings}
      <Dialog.Header>
        <Dialog.Title class="text-lg font-semibold"
          >{tool.label} · type-wide settings</Dialog.Title
        >
      </Dialog.Header>
      <Dialog.Description>
        Applies to all stored Elements of this type and the defaults for future Elements.
      </Dialog.Description>
      <div class="mt-2">
        <SettingsCmp params={stagedParams} style={stagedStyle} />
      </div>
      <ModalFooter onCancel={cancel} onOk={applyAndClose} />
    {/if}
  </Dialog.Content>
</Dialog.Root>

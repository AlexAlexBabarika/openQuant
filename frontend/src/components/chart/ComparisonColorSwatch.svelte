<script lang="ts">
  import { Popover } from 'bits-ui';
  import ColourPicker from './ColourPicker.svelte';

  let {
    color,
    onchange,
    label,
  }: {
    color: string;
    onchange: (next: string) => void;
    label: string;
  } = $props();

  let local: string = $state('');

  // Sync inwards when the parent value changes.
  $effect(() => {
    local = color;
  });

  // Fire outwards when the picker mutates `local`.
  $effect(() => {
    if (local && local !== color) onchange(local);
  });
</script>

<Popover.Root>
  <Popover.Trigger
    class="block w-3 h-3 rounded-sm border border-border/60 hover:border-foreground transition-colors"
    style="background-color: {color};"
    aria-label={label}
  />
  <Popover.Portal>
    <Popover.Content
      sideOffset={8}
      class="z-(--z-popover) w-64 rounded-lg border border-border bg-card p-4 shadow-popover outline-none"
    >
      <ColourPicker bind:colour={local} />
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>

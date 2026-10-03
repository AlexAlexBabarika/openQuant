<script lang="ts">
  import { Popover } from 'bits-ui';
  import ColourPicker from './ColourPicker.svelte';

  let {
    colour = $bindable('#000000'),
    label,
    ariaLabel,
  }: {
    colour: string;
    label: string;
    ariaLabel?: string;
  } = $props();
</script>

<Popover.Root>
  <Popover.Trigger
    class="flex items-center gap-2 group focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground forced-colors:focus-visible:outline-[Highlight]"
    aria-label={ariaLabel ?? `Pick colour for ${label}`}
  >
    <span
      class="block w-6 h-6 rounded border border-border group-hover:border-foreground transition-colors cursor-pointer"
      style="background-color: {colour};"
    ></span>
    <span class="text-xs text-muted-foreground">{label}</span>
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content
      sideOffset={8}
      class="z-[80] w-64 rounded-lg border border-border bg-card p-4 shadow-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground forced-colors:focus-visible:outline-[Highlight]"
    >
      <ColourPicker bind:colour />
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>

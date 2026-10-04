<script lang="ts">
  import ColourSwatch from '../../../../components/chart/ColourSwatch.svelte';
  import Field from './Field.svelte';

  let {
    label,
    value = $bindable<string>('#000000'),
  }: {
    label: string;
    value: string;
  } = $props();
</script>

<Field {label}>
  <ColourSwatch bind:colour={value} label="" ariaLabel="Pick colour for {label}" />
</Field>

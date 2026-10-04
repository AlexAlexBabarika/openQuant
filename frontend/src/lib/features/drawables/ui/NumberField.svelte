<script lang="ts">
  import Field from './Field.svelte';

  let {
    label,
    value = $bindable<number>(0),
    min,
    max,
    step,
  }: {
    label: string;
    value: number;
    min?: number;
    max?: number;
    step?: number;
  } = $props();

  const inputId = `num-${crypto.randomUUID()}`;

  function updateValue(event: Event): void {
    const n = (event.currentTarget as HTMLInputElement).valueAsNumber;
    if (Number.isFinite(n)) value = n;
  }
</script>

<Field {label} id={inputId}>
  <input
    id={inputId}
    type="number"
    required
    class="h-7 w-20 rounded border border-border bg-transparent px-2 text-sm text-right outline-none focus:border-ring"
    {min}
    {max}
    {step}
    value={value}
    oninput={updateValue}
  />
</Field>

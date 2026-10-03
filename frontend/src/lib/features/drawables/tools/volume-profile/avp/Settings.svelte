<script lang="ts">
  import type { SettingsProps } from '../../../types';
  import type { AvpGeo, AvpParams, AvpStyle } from './compute';
  import ColorField from '../../../ui/ColorField.svelte';
  import CheckboxField from '../../../ui/CheckboxField.svelte';
  import NumberField from '../../../ui/NumberField.svelte';

  let { params, style }: SettingsProps<AvpGeo, AvpParams, AvpStyle> = $props();
</script>

<div class="flex flex-col">
  <p class="text-muted-foreground mb-2 text-xs">
    OHLCV estimate from the anchor to the latest cached candle. Volume is spread
    over each candle’s low–high span by row overlap. Up/down follows candle
    direction, not order-flow delta or trade/tick volume at price.
  </p>
  <NumberField label="Row size" bind:value={params.rowSize} min={0.01} step={0.01} />
  <NumberField
    label="Value area %"
    bind:value={params.vaPercent}
    min={0.01}
    max={1}
    step={0.01}
  />
  <NumberField
    label="Width %"
    bind:value={style.widthPct}
    min={1}
    max={100}
    step={1}
  />
  <CheckboxField label="Show profile" bind:checked={style.showProfile} />
  <ColorField label="Up candle colour" bind:value={style.upColor} />
  <ColorField label="Down candle colour" bind:value={style.downColor} />
  <CheckboxField label="Show POC" bind:checked={style.showPOC} />
  <ColorField label="POC colour" bind:value={style.pocColor} />
  <CheckboxField label="Show VAH" bind:checked={style.showVAH} />
  <ColorField label="VAH colour" bind:value={style.vahColor} />
  <CheckboxField label="Show VAL" bind:checked={style.showVAL} />
  <ColorField label="VAL colour" bind:value={style.valColor} />
</div>

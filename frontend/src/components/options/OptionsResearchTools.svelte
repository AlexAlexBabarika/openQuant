<script lang="ts">
  import type { OptionsResearchToolProps } from '$lib/features/options/optionsResearchTypes';
  import OptionsSkewEditor from './OptionsSkewEditor.svelte';
  import OptionsStressLab from './OptionsStressLab.svelte';
  import OptionsFinder from './OptionsFinder.svelte';
  import OptionsChainPicker from './OptionsChainPicker.svelte';
  import OptionsLifecycle from './OptionsLifecycle.svelte';
  import OptionsHedgeLab from './OptionsHedgeLab.svelte';
  import OptionsProbabilityLab from './OptionsProbabilityLab.svelte';

  let { draft, onEdit, documentKey, readOnly = false }: OptionsResearchToolProps = $props();
  let selected = $state('');
  const id = $props.id();
  const tools = [
    ['skew', 'Volatility skew'], ['stress', 'Hypothetical event stress'],
    ['finder', 'Constrained strategy finder'], ['chain', 'Read-only provider chain'],
    ['lifecycle', 'Multi-expiry lifecycle'], ['hedge', 'Delta-hedging path'],
    ['probability', 'Probability & tail risk'],
  ];
</script>

<section class="research-tools" aria-label="Research tools">
  <h3>Research tools</h3>
  <p>Drag-to-edit payoff is on the chart, with numeric and keyboard alternatives. Open one additional tool at a time; closing or switching cancels its pending work and clears local evidence. Recompute explicitly.</p>
  {#if readOnly}<p>Submitted Python request · read-only. No tool edits or runs replace custom source.</p>{/if}
  <label for={id}>Open research tool</label>
  <select id={id} bind:value={selected}>
    <option value="">Closed · select a tool</option>
    {#each tools as [value, label]}<option {value}>{label}</option>{/each}
  </select>
  {#key documentKey}
    {#if selected === 'skew'}<OptionsSkewEditor {draft} {onEdit} {documentKey} {readOnly} />
    {:else if selected === 'stress'}<OptionsStressLab {draft} {onEdit} {documentKey} {readOnly} />
    {:else if selected === 'finder'}<OptionsFinder {draft} {onEdit} {documentKey} {readOnly} />
    {:else if selected === 'chain'}<OptionsChainPicker {draft} {onEdit} {documentKey} {readOnly} />
    {:else if selected === 'lifecycle'}<OptionsLifecycle {draft} {onEdit} {documentKey} {readOnly} />
    {:else if selected === 'hedge'}<OptionsHedgeLab {draft} {onEdit} {documentKey} {readOnly} />
    {:else if selected === 'probability'}<OptionsProbabilityLab {draft} {documentKey} {readOnly} />{/if}
  {/key}
</section>

<style>
  .research-tools { display: grid; gap: 8px; min-width: 0; border: 1px solid oklch(var(--border)); border-radius: 4px; padding: 8px; }
  h3, p { margin: 0; font-size: 12px; }
  p { line-height: 1.5; color: oklch(var(--muted-foreground)); overflow-wrap: anywhere; }
  select { width: 100%; min-width: 0; min-height: 32px; border: 1px solid oklch(var(--input)); border-radius: 4px; padding: 5px; background: oklch(var(--background)); color: oklch(var(--foreground)); font: inherit; }
  select:focus-visible { outline: 2px solid oklch(var(--ring)); outline-offset: 2px; }
  @media (pointer: coarse) { select { min-height: var(--control-touch-height); } }
  @media (forced-colors: active) { select { border-color: ButtonText; } select:focus-visible { outline-color: Highlight; } }
</style>

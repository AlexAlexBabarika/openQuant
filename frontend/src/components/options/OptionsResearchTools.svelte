<script lang="ts">
  import type { OptionsResearchToolProps } from '$lib/features/options/optionsResearchTypes';
  import type { OptionsAnalysis } from '$lib/features/options/optionsTypes';
  import OptionsScenarioLab from './OptionsScenarioLab.svelte';
  import OptionsSkewEditor from './OptionsSkewEditor.svelte';
  import OptionsStressLab from './OptionsStressLab.svelte';
  import OptionsFinder from './OptionsFinder.svelte';
  import OptionsChainPicker from './OptionsChainPicker.svelte';
  import OptionsLifecycle from './OptionsLifecycle.svelte';
  import OptionsHedgeLab from './OptionsHedgeLab.svelte';
  import OptionsProbabilityLab from './OptionsProbabilityLab.svelte';

  let { draft, onEdit, documentKey, readOnly = false, result = null, analysisLabel = '' }: OptionsResearchToolProps & {
    /** The analysis shown in the chart; the Scenarios tab reads its evidence. */
    result?: OptionsAnalysis | null;
    /** The same "Analysis of …" line the chart uses, so every tool names the strategy it reads. */
    analysisLabel?: string;
  } = $props();
  const id = $props.id();
  const tools = [
    ['scenarios', 'Scenarios'], ['skew', 'Skew'], ['stress', 'Stress'], ['probability', 'Probability'],
    ['lifecycle', 'Lifecycle'], ['hedge', 'Hedging'], ['finder', 'Find a trade'], ['chain', 'Live chain'],
  ] as const;
  type Tool = (typeof tools)[number][0];
  let selected = $state<Tool>('scenarios');
  let tablist: HTMLElement;

  function keydown(event: KeyboardEvent, index: number) {
    const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1
      : event.key === 'Home' ? 0 : event.key === 'End' ? tools.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    const tool = tools[(next + tools.length) % tools.length][0];
    selected = tool;
    tablist.querySelector<HTMLButtonElement>(`[data-tool="${tool}"]`)?.focus();
  }
</script>

<section class="research-tools" aria-label="Research tools">
  <div class="tabs" role="tablist" aria-label="Analysis views" bind:this={tablist}>
    {#each tools as [value, label], index (value)}
      <button type="button" role="tab" id={`${id}-${value}`} data-tool={value} aria-selected={selected === value} aria-controls={`${id}-panel`}
        tabindex={selected === value ? 0 : -1} onclick={() => { selected = value; }} onkeydown={e => keydown(e, index)}>{label}</button>
    {/each}
  </div>
  <div class="panel" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${selected}`}>
    {#if analysisLabel}<p class="analysis">{analysisLabel}</p>{/if}
    {#if readOnly}<p>Read-only in Python mode. No tool edits or runs replace custom source.</p>{/if}
    {#key documentKey}
      {#if selected === 'scenarios'}<OptionsScenarioLab {draft} {result} {onEdit} {readOnly} />
      {:else if selected === 'skew'}<OptionsSkewEditor {draft} {onEdit} {documentKey} {readOnly} />
      {:else if selected === 'stress'}<OptionsStressLab {draft} {onEdit} {documentKey} {readOnly} />
      {:else if selected === 'finder'}<OptionsFinder {draft} {onEdit} {documentKey} {readOnly} />
      {:else if selected === 'chain'}<OptionsChainPicker {draft} {onEdit} {documentKey} {readOnly} />
      {:else if selected === 'lifecycle'}<OptionsLifecycle {draft} {onEdit} {documentKey} {readOnly} />
      {:else if selected === 'hedge'}<OptionsHedgeLab {draft} {onEdit} {documentKey} {readOnly} />
      {:else if selected === 'probability'}<OptionsProbabilityLab {draft} {documentKey} {readOnly} />{/if}
    {/key}
  </div>
</section>

<style>
  .research-tools { display: grid; grid-template-columns: minmax(0, 1fr); min-width: 0; margin-top: 12px; border: 1px solid oklch(var(--border)); border-radius: 4px; }
  .tabs { display: flex; gap: 2px; padding: 0 8px; border-bottom: 1px solid oklch(var(--border)); overflow-x: auto; }
  [role="tab"] { min-height: 36px; padding: 6px 10px; border: 0; background: none; color: oklch(var(--muted-foreground)); font: inherit; font-size: 12px; white-space: nowrap; cursor: pointer; box-shadow: inset 0 -2px transparent; }
  [role="tab"][aria-selected="true"] { color: oklch(var(--foreground)); box-shadow: inset 0 -2px oklch(var(--primary)); }
  [role="tab"]:hover { color: oklch(var(--foreground)); }
  [role="tab"]:focus-visible { outline: 2px solid oklch(var(--ring)); outline-offset: -2px; }
  .panel { display: grid; gap: 8px; min-width: 0; padding: 8px; }
  p { margin: 0; font-size: 12px; line-height: 1.5; color: oklch(var(--muted-foreground)); overflow-wrap: anywhere; }
  .analysis { color: oklch(var(--foreground)); font-weight: 700; }
  @media (pointer: coarse) { [role="tab"] { min-height: var(--control-touch-height); } }
  @media (forced-colors: active) { [role="tab"][aria-selected="true"] { outline: 2px solid Highlight; } [role="tab"]:focus-visible { outline-color: Highlight; } }
</style>

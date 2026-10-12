<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog';
  import StrategyTrial from '$lib/features/trial/StrategyTrial.svelte';

  let {
    open = $bindable(false),
    returnFocus = null,
  }: {
    open?: boolean;
    returnFocus?: HTMLElement | null;
  } = $props();

  const steps = [
    {
      title: 'Run a synthetic example',
      time: '0–2 minutes',
      instruction: 'Choose “Load and run synthetic example” below to load the curated catalog and run its first example. Then use Example strategy and Run checks to try another scenario. No sign-in, provider keys, saved scripts or chart data are needed.',
    },
    {
      title: 'Compare the three full-period results',
      time: '2–5 minutes',
      instruction: 'Compare frictionless with cost-adjusted output to see the effect of commission and slippage. Compare the cost-adjusted strategy with buy-and-hold over the same full period. Read return, drawdown and trade count together; a higher return alone is not a robustness verdict. If you change costs or the example, run checks again rather than treating previous results as current.',
    },
    {
      title: 'Inspect holdout and parameter evidence',
      time: '5–8 minutes',
      instruction: 'Find the chronological split and compare the strategy with its benchmark on the later holdout, not with full-period returns. Inspect neighboring parameter values: a single sharp peak can be fragile, not an invitation to optimize on the holdout. Read the report’s assumptions, limitations and warnings before drawing a conclusion.',
    },
    {
      title: 'Write a cautious research conclusion',
      time: '8–10 minutes',
      instruction: 'In your own notes, record the scenario and costs, the benchmark gap, drawdown, holdout behavior and parameter sensitivity. For example: “This synthetic scenario changed after costs; the later holdout and neighboring parameters do not establish an edge. I would next test an independent dataset with explicit assumptions.” Describe what the evidence shows and what remains unknown, not a buy/sell recommendation.',
    },
  ];
  let step = $state(0);
  let exampleStarted = $state(false);
  let heading: HTMLHeadingElement | null = $state(null);

  $effect(() => {
    if (!open) {
      step = 0;
      exampleStarted = false;
    }
  });

  function startExample() {
    if (open) exampleStarted = true;
  }

  function moveStep(direction: -1 | 1) {
    step = Math.max(0, Math.min(steps.length - 1, step + direction));
    heading?.focus();
  }

  function closeGuide() {
    open = false;
  }

  function focusGuide(event: Event) {
    event.preventDefault();
    heading?.focus();
  }

  function restoreFocus(event: Event) {
    if (returnFocus?.isConnected) {
      event.preventDefault();
      returnFocus.focus();
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content
    class="w-[1100px] max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-3 overflow-hidden rounded border border-border sm:max-w-[calc(100vw-2rem)]"
    onOpenAutoFocus={focusGuide}
    onCloseAutoFocus={restoreFocus}
  >
    <Dialog.Header class="min-w-0 pr-8">
      <Dialog.Title>Guided example · first ten minutes</Dialog.Title>
      <Dialog.Description>
        Educational synthetic scenarios, not evidence of alpha or account-owned saved runs.
        Open or leave this guide without changing your chart, drafts or Elements.
      </Dialog.Description>
    </Dialog.Header>

    <div class="guide-body">
      <section class="guide-step" aria-label="Walkthrough">
        <p class="step-progress" role="status">Step {step + 1} of {steps.length} · {steps[step].time}</p>
        <h3 bind:this={heading} tabindex="-1">{steps[step].title}</h3>
        <p>{steps[step].instruction}</p>
      </section>

      {#if open && exampleStarted}
        <div class="example-surface">
          <StrategyTrial embedded={true} onreturnworkspace={closeGuide} />
        </div>
      {:else}
        <section class="example-choice" aria-label="Synthetic example execution">
          <p>No example has been run. Starting loads deterministic built-in data, not a real provider snapshot.</p>
          <button type="button" class="ot-workbench-primary" onclick={startExample}>Load and run synthetic example</button>
        </section>
      {/if}

      <p class="guide-scope">Nothing is automatically saved to your notebook or account. Closing discards only this guide’s example session; reopening requires a new execution choice. Your existing research state stays in the workbench.</p>
    </div>

    <Dialog.Footer class="flex-wrap gap-2 border-t border-border pt-3">
      <button type="button" class="ot-workbench-ghost" onclick={() => moveStep(-1)} disabled={step === 0}>Previous</button>
      <button type="button" class="ot-workbench-ghost" onclick={() => moveStep(1)} disabled={step === steps.length - 1}>Next</button>
      <button type="button" class="ot-workbench-ghost" onclick={closeGuide}>Return to workbench</button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<style>
  .guide-body { min-height: 0; min-width: 0; overflow: auto; display: grid; gap: 12px; }
  .guide-step, .example-choice { display: grid; gap: 8px; min-width: 0; padding: 12px; border: 1px solid oklch(var(--border)); border-radius: 4px; }
  .guide-step h3 { font-weight: 600; }
  .guide-step h3:focus-visible { outline: 2px solid oklch(var(--ring)); outline-offset: 2px; }
  .step-progress { font: 11px var(--font-mono); color: oklch(var(--muted-foreground)); }
  .example-choice button { justify-self: start; height: auto; min-height: 28px; white-space: normal; }
  .example-surface { min-width: 0; }
  .guide-scope { color: oklch(var(--muted-foreground)); font-size: 12px; }
</style>

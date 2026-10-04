<script lang="ts">
  import { untrack } from 'svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import { runsHistory } from '$lib/features/runs/runsHistory.svelte';
  import { truncateRunId } from '$lib/features/runs/format';

  let {
    open = $bindable(false),
    onOpenRun,
    onCompare,
  }: {
    open?: boolean;
    onOpenRun: (id: string) => void;
    onCompare: (a: string, b: string) => void;
  } = $props();

  let selected = $state<string[]>([]);
  let query = $state('');
  const entries = $derived(runsHistory.entries.filter(e =>
    `${e.label} ${(e.tags ?? []).join(' ')} ${e.notes ?? ''}`.toLowerCase().includes(query.toLowerCase())));
  $effect(() => {
    const available = runsHistory.entries;
    selected = untrack(() => selected.filter(id => available.some(e => e.run_id === id && e.kind === 'single')));
  });

  function toggle(id: string): void {
    selected = selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id].slice(-2);
  }
  function compareSelected(): void {
    if (selected.length === 2) onCompare(selected[0], selected[1]);
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content portalProps={{ disabled: typeof window === 'undefined' }} class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
    <Dialog.Header>
      <Dialog.Title>Experiment notebook</Dialog.Title>
      <Dialog.Description>Run references, names, tags, and notes stay in this browser, separated by account. Stored snapshots are server-local and not account-scoped.</Dialog.Description>
    </Dialog.Header>
    {#if runsHistory.storageError}<p role="status">{runsHistory.storageError}</p>{/if}
    {#if runsHistory.guestReferenceCount}
      <button type="button" class="ot-workbench-ghost" onclick={() => { if (confirm('Copy guest/legacy references and notes into this account? Existing account notes stay unchanged. This copies notebook metadata, not stored snapshots.')) runsHistory.copyGuestReferences(); }}>Copy {runsHistory.guestReferenceCount} guest/legacy references into this account</button>
    {/if}
    <label class="grid gap-1 text-sm">Search experiments<input class="rounded border bg-background p-2" bind:value={query} /></label>
    <button class="ot-workbench-ghost" type="button" disabled={selected.length !== 2} onclick={compareSelected}>Compare selected ({selected.length}/2)</button>
    {#if !entries.length}<p class="text-sm text-muted-foreground">{query ? 'No matching experiments.' : 'No recorded runs yet. Run a strategy to start your notebook.'}</p>{/if}
    {#each entries as e (e.run_id)}
      <article class="min-w-0 rounded border border-border p-3">
        <div class="flex flex-wrap items-center gap-2">
          {#if e.kind === 'single'}<input type="checkbox" checked={selected.includes(e.run_id)} onchange={() => toggle(e.run_id)} aria-label={`Select ${e.label} for comparison`} />{/if}
          <button class="ot-workbench-ghost" type="button" onclick={() => onOpenRun(e.run_id)}>{e.label}</button>
          <span class="font-mono text-xs text-muted-foreground">{truncateRunId(e.run_id)} · {e.kind}{e.baseline ? ' · BASELINE' : ''}</span>
          {#if e.kind === 'single'}<button class="ot-workbench-ghost" type="button" aria-pressed={!!e.baseline} onclick={() => runsHistory.pin(e.baseline ? null : e.run_id)}>{e.baseline ? 'Unpin baseline' : 'Pin baseline'}</button>{/if}
          <button class="ot-workbench-ghost" type="button" onclick={() => { if (confirm(`Remove “${e.label}” and its local notes? The stored result is not deleted.`)) runsHistory.remove(e.run_id); }} aria-label={`Remove ${e.label} from notebook`}>Remove reference</button>
        </div>
        <details class="mt-2 text-sm">
          <summary>Edit name, tags, and research notes</summary>
          <form class="mt-2 grid gap-2" onsubmit={event => {
            event.preventDefault(); const data = new FormData(event.currentTarget);
            runsHistory.annotate(e.run_id, String(data.get('name')), String(data.get('tags')), String(data.get('notes')));
          }}>
            <label class="grid gap-1">Experiment name<input name="name" value={e.label} maxlength="120" required class="rounded border bg-background p-2" /></label>
            <label class="grid gap-1">Tags (comma-separated)<input name="tags" value={(e.tags ?? []).join(', ')} maxlength="600" class="rounded border bg-background p-2" /></label>
            <label class="grid gap-1">Hypothesis and observations<textarea name="notes" value={e.notes ?? ''} maxlength="10000" rows="3" class="rounded border bg-background p-2"></textarea></label>
            <button class="ot-workbench-primary justify-self-start" type="submit">Save notebook entry</button>
          </form>
        </details>
      </article>
    {/each}
  </Dialog.Content>
</Dialog.Root>

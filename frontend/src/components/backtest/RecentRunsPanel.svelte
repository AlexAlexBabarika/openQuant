<script lang="ts">
  import { untrack } from 'svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import { runsHistory } from '$lib/features/runs/runsHistory.svelte';
  import { truncateRunId } from '$lib/features/runs/format';
  import { isResearchDecision, MAX_NOTEBOOK_BYTES, MAX_TAG_LENGTH, RESEARCH_DECISIONS } from '$lib/features/runs/notebookMetadata';

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
  let importFile = $state<File | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);
  let importing = $state(false);
  let transferMessage = $state<string | null>(null);
  let transferError = $state(false);
  let transferGeneration = 0;
  const entries = $derived(runsHistory.entries.filter(e =>
    `${e.label} ${(e.tags ?? []).join(' ')} ${e.notes ?? ''}`.toLowerCase().includes(query.toLowerCase())));
  $effect(() => {
    const available = runsHistory.entries;
    selected = untrack(() => selected.filter(id => available.some(e => e.run_id === id && e.kind === 'single')));
  });
  $effect(() => {
    runsHistory.accountVersion;
    open;
    untrack(() => {
      selected = [];
      query = '';
      resetTransfers();
    });
    return () => untrack(resetTransfers);
  });

  function resetTransfers(): void {
    transferGeneration++;
    importFile = null;
    if (fileInput) fileInput.value = '';
    importing = false;
    transferMessage = null;
    transferError = false;
  }

  function chooseImport(event: Event): void {
    transferGeneration++;
    importFile = (event.currentTarget as HTMLInputElement).files?.[0] ?? null;
    importing = false;
    transferMessage = null;
    transferError = false;
  }

  async function importMetadata(): Promise<void> {
    if (!importFile || importing) return;
    const file = importFile;
    const owner = runsHistory.accountVersion;
    const generation = ++transferGeneration;
    const current = () => owner === runsHistory.accountVersion && generation === transferGeneration && open;
    importing = true;
    transferMessage = null;
    transferError = false;
    try {
      if (file.size > MAX_NOTEBOOK_BYTES) throw new Error('Notebook metadata must be no larger than 6 MiB.');
      const json = await file.text();
      if (!current()) return;
      const result = runsHistory.importMetadata(json, owner);
      transferMessage = `${result.imported ? `Saved ${result.imported} imported references in this browser.` : 'No new references imported.'} ${result.duplicates} existing references kept; ${result.capacitySkipped} skipped at the 50-reference limit.`;
    } catch (error) {
      if (!current()) return;
      transferError = true;
      transferMessage = error instanceof Error ? error.message : 'Could not read or import notebook metadata. Current entries are unchanged.';
    } finally {
      if (current()) importing = false;
    }
  }

  function exportMetadata(): void {
    transferMessage = null;
    transferError = false;
    let url: string | null = null;
    try {
      const json = runsHistory.exportMetadata();
      url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'openquant-notebook-metadata-v1.json';
      link.click();
      transferMessage = 'Metadata download requested. Check your browser downloads; result snapshots, data, and source code are not included.';
    } catch (error) {
      transferError = true;
      transferMessage = error instanceof Error ? error.message : 'Metadata download could not be started.';
    } finally {
      if (url) { const downloadUrl = url; setTimeout(() => URL.revokeObjectURL(downloadUrl), 0); }
    }
  }

  function saveEntry(event: SubmitEvent, id: string): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    const decision = data.get('decision');
    if (!isResearchDecision(decision)) return;
    runsHistory.annotate(id, String(data.get('name')), String(data.get('tags')), String(data.get('notes')), decision);
  }

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
      <Dialog.Description>Run references, names, tags, notes, and human research decisions stay in this browser, separated by account. Stored snapshots are server-local and not account-scoped.</Dialog.Description>
    </Dialog.Header>
    {#if runsHistory.storageError}<p role="status">{runsHistory.storageError}</p>{/if}
    {#if runsHistory.guestReferenceCount}
      <button type="button" class="ot-workbench-ghost" onclick={() => { if (confirm('Copy guest/legacy references and notes into this account? Existing account notes stay unchanged. This copies notebook metadata, not stored snapshots.')) runsHistory.copyGuestReferences(); }}>Copy {runsHistory.guestReferenceCount} guest/legacy references into this account</button>
    {/if}
    <details class="text-sm">
      <summary>Back up or import notebook metadata</summary>
      <div class="mt-2 grid min-w-0 gap-2">
        <p id="notebook-transfer-help" class="text-muted-foreground">JSON metadata only: names, tags, notes, decisions, baseline, and run references. No result snapshots, market data, or source code. Unencrypted local storage and backups; no cloud sync. Keep the file private. Version 1, at most 50 references and 6 MiB.</p>
        <button type="button" class="ot-workbench-ghost justify-self-start" disabled={importing} onclick={exportMetadata}>Export current notebook metadata</button>
        <form class="grid min-w-0 gap-2" onsubmit={event => { event.preventDefault(); void importMetadata(); }} aria-busy={importing}>
          <label class="grid min-w-0 gap-1">Notebook metadata JSON file<input bind:this={fileInput} type="file" accept=".json,application/json" class="min-w-0 max-w-full" aria-describedby="notebook-transfer-help notebook-import-policy" disabled={importing} onchange={chooseImport} /></label>
          <p id="notebook-import-policy" class="text-muted-foreground">Import explicitly into the current browser notebook only. Add missing references; keep existing names, notes, decisions, and baseline unchanged. No account or guest ownership is adopted from a file. Names: 120 characters; 12 tags of up to 600 characters; notes: 10000 characters.</p>
          <button type="submit" class="ot-workbench-ghost justify-self-start" disabled={!importFile || importing}>{importing ? 'Reading metadata…' : 'Import missing references'}</button>
        </form>
        {#if transferMessage}<p role={transferError ? 'alert' : 'status'}>{transferMessage}</p>{/if}
      </div>
    </details>
    <label class="grid gap-1 text-sm">Search experiments<input class="rounded border bg-background p-2" bind:value={query} /></label>
    <button class="ot-workbench-ghost" type="button" disabled={selected.length !== 2} onclick={compareSelected}>Compare selected ({selected.length}/2)</button>
    {#if !entries.length}<p class="text-sm text-muted-foreground">{query ? 'No matching experiments.' : 'No recorded runs yet. Run a strategy to start your notebook.'}</p>{/if}
    {#each entries as e (`${runsHistory.accountVersion}:${e.run_id}`)}
      <article class="min-w-0 rounded border border-border p-3">
        <div class="flex flex-wrap items-center gap-2">
          {#if e.kind === 'single'}<input type="checkbox" checked={selected.includes(e.run_id)} onchange={() => toggle(e.run_id)} aria-label={`Select ${e.label} for comparison`} />{/if}
          <button class="ot-workbench-ghost" type="button" onclick={() => onOpenRun(e.run_id)}>{e.label}</button>
          <span class="font-mono text-xs text-muted-foreground">{truncateRunId(e.run_id)} · {e.kind}{e.baseline ? ' · BASELINE' : ''}</span>
          <span class="text-xs">Human decision: {RESEARCH_DECISIONS[e.decision ?? 'unreviewed']}</span>
          {#if e.kind === 'single'}<button class="ot-workbench-ghost" type="button" aria-pressed={!!e.baseline} onclick={() => runsHistory.pin(e.baseline ? null : e.run_id)}>{e.baseline ? 'Unpin baseline' : 'Pin baseline'}</button>{/if}
          <button class="ot-workbench-ghost" type="button" onclick={() => { if (confirm(`Remove “${e.label}” and its local notes? The stored result is not deleted.`)) runsHistory.remove(e.run_id); }} aria-label={`Remove ${e.label} from notebook`}>Remove reference</button>
        </div>
        <details class="mt-2 text-sm">
          <summary>Edit name, tags, research notes, and decision</summary>
          <form class="mt-2 grid gap-2" onsubmit={event => saveEntry(event, e.run_id)}>
            <label class="grid gap-1">Experiment name<input name="name" value={e.label} maxlength="120" required class="rounded border bg-background p-2" /></label>
            <label class="grid gap-1">Tags (comma-separated; up to 12, 600 characters each)<input name="tags" value={(e.tags ?? []).join(', ')} maxlength={12 * MAX_TAG_LENGTH + 22} class="rounded border bg-background p-2" /></label>
            <label class="grid gap-1">Hypothesis and observations<textarea name="notes" value={e.notes ?? ''} maxlength="10000" rows="3" class="rounded border bg-background p-2"></textarea></label>
            <label class="grid gap-1">Human research decision<select name="decision" value={e.decision ?? 'unreviewed'} aria-describedby={`decision-help-${e.run_id}`} class="rounded border bg-background p-2">{#each Object.entries(RESEARCH_DECISIONS) as [value, label]}<option {value}>{label}</option>{/each}</select></label>
            <p id={`decision-help-${e.run_id}`} class="text-muted-foreground">Your research judgment only—not certification, a robustness pass, or investment advice.</p>
            <button class="ot-workbench-primary justify-self-start" type="submit">Save notebook entry</button>
          </form>
        </details>
      </article>
    {/each}
  </Dialog.Content>
</Dialog.Root>

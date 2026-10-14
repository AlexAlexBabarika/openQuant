<script lang="ts">
  import type { OptionsState } from '$lib/features/options/optionsState.svelte';
  import { downloadOptionsFile, MAX_OPTIONS_STORAGE } from '$lib/features/options/optionsPersistence';

  let { state: options }: { state: OptionsState } = $props();
  let name = $state('');
  let selected = $state('');
  let revision = $state('');
  let applyImport = $state(false);
  let importing = $state(false);
  let feedback = $state<string | null>(null);
  const item = $derived(selected === '' ? null : options.saved[Number(selected)] ?? null);
  $effect(() => {
    options.documentKey;
    name = ''; selected = ''; revision = ''; feedback = null; applyImport = false;
  });
  function download(get: () => string | null, suffix: string, mime: string) {
    try {
      const content = get();
      if (content === null) return;
      downloadOptionsFile(content, `openquant-options-${options.scopeLabel.startsWith('Guest') ? 'guest' : 'account'}-${suffix}`, mime);
      feedback = 'Export downloaded from this browser scope. Store it privately; it is not encrypted or covered by server backups.';
    } catch (e) { feedback = e instanceof Error ? e.message : 'Download failed; no records changed.'; }
  }
  async function importFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || importing) return;
    const documentKey = options.documentKey;
    const apply = applyImport;
    importing = true; feedback = null;
    try {
      if (file.size > MAX_OPTIONS_STORAGE * 4) throw new Error('Draft file is too large. Choose a bounded options JSON bundle.');
      const content = await file.text();
      if (documentKey !== options.documentKey) return;
      options.importBundle(content, apply);
    } catch (e) {
      if (documentKey === options.documentKey) feedback = e instanceof Error ? e.message : 'Import failed; existing records are unchanged.';
    } finally { importing = false; }
  }
</script>

<section class="library" aria-label="Options local draft library">
  <header><strong>Draft library & recovery</strong><span>{options.scopeLabel}</span></header>
  <p>Local inputs and Python only; not encrypted, cloud-synced or backed up by the server. Guest records are never adopted on sign-in. Recovery autosaves after 500 ms; restore is explicit and never executes Python.</p>
  {#if options.recovery}
    <div class="actions" role="group" aria-label="Working recovery">
      <span>Working recovery · {options.recovery.updatedAt}</span>
      <button type="button" class="ot-workbench-ghost" onclick={() => options.recover()}>Recover inputs & source</button>
      <button type="button" class="ot-workbench-ghost" onclick={() => options.discardRecovery()}>Discard recovery</button>
    </div>
  {:else}<p>No working recovery in this browser scope.</p>{/if}
  <div class="actions">
    <label>Draft name <input maxlength="120" value={name} oninput={e => name = e.currentTarget.value} /></label>
    <button type="button" class="ot-workbench-ghost" disabled={!name.trim()} onclick={() => options.save(name)}>Save new draft</button>
    <button type="button" class="ot-workbench-ghost" onclick={() => options.flushRecovery()}>Retry working save</button>
  </div>
  <p>Up to 10 named drafts; updates/renames retain the last 3 prior revisions. Named saves require valid canonical editor fields and Python up to 20,000 characters.</p>
  <div class="actions">
    <label>Saved draft
      <select value={selected} onchange={e => { selected = e.currentTarget.value; name = item?.name ?? ''; revision = ''; }}>
        <option value="">Select a draft</option>
        {#each options.saved as saved, i}<option value={String(i)}>{saved.name} · revision {saved.revision ?? 1}</option>{/each}
      </select>
    </label>
    <label>Revision
      <select value={revision} disabled={!item} onchange={e => revision = e.currentTarget.value}>
        <option value="">Current</option>
        {#each item?.revisions ?? [] as prior}<option value={String(prior.revision)}>{prior.revision} · {prior.name} · {prior.updatedAt}</option>{/each}
      </select>
    </label>
    <button type="button" class="ot-workbench-ghost" disabled={!item} onclick={() => options.restore(Number(selected), revision ? Number(revision) : undefined)}>Restore inputs & source</button>
    <button type="button" class="ot-workbench-ghost" disabled={!item} onclick={() => options.updateSaved(Number(selected))}>Update from working inputs</button>
    <button type="button" class="ot-workbench-ghost" disabled={!item || !name.trim()} onclick={() => options.renameSaved(Number(selected), name)}>Rename saved draft</button>
    <button type="button" class="ot-workbench-ghost" disabled={!item} onclick={() => { options.remove(Number(selected)); selected = ''; revision = ''; }}>Delete saved draft</button>
  </div>
  <div class="actions" role="group" aria-label="Portable draft files">
    <button type="button" class="ot-workbench-ghost" disabled={!options.saved.length} onclick={() => download(() => options.exportBundle(), 'drafts.json', 'application/json')}>Export named JSON bundle</button>
    <label>Import JSON bundle <input type="file" accept=".json,application/json" disabled={importing} onchange={importFile} /></label>
    <label class="checkbox"><input type="checkbox" bind:checked={applyImport} />Also restore first imported draft (replaces working inputs & source)</label>
  </div>
  <p>Import appends validated records into this scope; invalid imports never replace existing records. Back up before deleting. Exports may contain private strategy source and manual quote metadata.</p>
  <div class="actions" role="group" aria-label="Submitted evidence exports">
    <button type="button" class="ot-workbench-ghost" onclick={() => download(() => options.exportSource(), 'source.py', 'text/x-python')}>Export current Python .py</button>
    <button type="button" class="ot-workbench-ghost" disabled={!options.result} onclick={() => download(() => options.exportCsv(), 'submitted.csv', 'text/csv')}>Export submitted CSV</button>
    <button type="button" class="ot-workbench-ghost" disabled={!options.result} onclick={() => download(() => options.exportReport(), 'report.json', 'application/json')}>Export reproducible report</button>
    <button type="button" class="ot-workbench-ghost" disabled={!options.result || options.comparisons.length >= 3} onclick={() => options.pin()}>Pin submitted comparison</button>
  </div>
  <p>Python export is the retained current authoring source, not a silent editor conversion. CSV/report use canonical submitted inputs and outputs{options.stale ? ' (older than current edits)' : ''}; the report also includes submitted Python and stdout when present. Comparison pins are session-only (max 3).</p>
  {#if options.storageError}<p role="alert" class="error">{options.storageError}</p>{/if}
  {#if feedback}<p role="status">{feedback}</p>{/if}
</section>

<style>
  .library { display: grid; gap: 8px; min-width: 0; padding: 8px; border: 1px solid oklch(var(--border)); border-radius: 4px; }
  header, .actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; }
  header span, p { color: oklch(var(--muted-foreground)); }
  p { margin: 0; font-size: 12px; overflow-wrap: anywhere; }
  label { display: grid; gap: 4px; font-size: 12px; min-width: 0; max-width: 100%; }
  .checkbox { display: flex; align-items: center; }
  input, select { border: 1px solid oklch(var(--input)); background: oklch(var(--background)); color: oklch(var(--foreground)); border-radius: 4px; min-height: var(--control-height); min-width: 0; max-width: 100%; padding: 2px 6px; }
  input[type='file'] { width: 230px; }
  button { white-space: normal; height: auto; min-height: var(--control-height); }
  input:focus-visible, select:focus-visible, button:focus-visible { outline: 2px solid oklch(var(--ring)); outline-offset: 2px; }
  .error { color: oklch(var(--down-color)); }
  @media (pointer: coarse) { button, input:not([type='checkbox']), select, .checkbox { min-height: var(--control-touch-height); } }
  @media (forced-colors: active) { input, select, button { border: 1px solid ButtonText; } }
</style>

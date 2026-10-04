<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog';
  import type { ResearchShelf, DraftKind, ResearchWorkspace } from '$lib/features/workspace/researchShelf.svelte';
  let { open = $bindable(false), shelf, onSave, onRestore, onRecover, onKeep }: {
    open?: boolean; shelf: ResearchShelf; onSave: (name: string) => boolean;
    onRestore: (workspace: ResearchWorkspace) => boolean; onRecover: (kind: DraftKind) => void;
    onKeep: (kind: DraftKind) => void;
  } = $props();
  let name = $state('');
</script>
<Dialog.Root bind:open>
  <Dialog.Content portalProps={{ disabled: typeof window === 'undefined' }} class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
    <Dialog.Header>
      <Dialog.Title>Research workspaces and recovery</Dialog.Title>
      <Dialog.Description>Local to this browser and account—not cloud saves. Restoring never runs code. CSV data must be uploaded again; chart drawings remain in their existing symbol storage.</Dialog.Description>
    </Dialog.Header>
    {#if shelf.error}<p role="status">{shelf.error}</p>{/if}
    {#each ['strategy', 'indicator'] as kind}
      {@const draftKind = kind as DraftKind}
      {@const draft = shelf.pending[draftKind]}
      {#if draft}
        <section class="grid min-w-0 gap-2 rounded border p-3">
          <h3 class="font-semibold">Recover {kind}: {draft.name}</h3>
          <p class="text-xs text-muted-foreground">Local draft from {new Date(draft.updatedAt).toLocaleString()}</p>
          <pre class="max-h-36 overflow-auto text-xs">{draft.code.slice(0, 3000)}</pre>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="ot-workbench-primary" onclick={() => onRecover(draftKind)}>Restore {kind} draft</button>
            <button type="button" class="ot-workbench-ghost" onclick={() => onKeep(draftKind)}>Keep current editor instead</button>
          </div>
        </section>
      {:else if shelf.drafts[draftKind]}
        <p class="text-xs text-muted-foreground">{kind}: local draft saved {new Date(shelf.drafts[draftKind]!.updatedAt).toLocaleString()}</p>
      {/if}
    {/each}
    <form class="flex flex-wrap items-end gap-2" onsubmit={e => { e.preventDefault(); if (onSave(name)) name = ''; }}>
      <label class="grid flex-1 gap-1">Workspace name<input bind:value={name} required maxlength="120" class="min-w-0 rounded border bg-background p-2" /></label>
      <button type="submit" class="ot-workbench-primary">Save current workspace</button>
    </form>
    {#if !shelf.workspaces.length}<p class="text-muted-foreground">No workspace presets yet.</p>{/if}
    {#each shelf.workspaces as workspace (workspace.id)}
      <section class="grid min-w-0 gap-2 rounded border p-3">
        <h3 class="font-semibold break-words">{workspace.name}</h3>
        <p class="text-xs text-muted-foreground">{workspace.layout.symbol} · {workspace.layout.provider} · {workspace.layout.interval} / {workspace.layout.period} · {new Date(workspace.updatedAt).toLocaleString()}</p>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="ot-workbench-ghost" onclick={() => { if (onRestore(workspace)) open = false; }}>Restore workspace…</button>
          <button type="button" class="ot-workbench-ghost" onclick={() => { if (confirm(`Remove workspace “${workspace.name}”?`)) shelf.removeWorkspace(workspace.id); }}>Remove workspace</button>
        </div>
      </section>
    {/each}
  </Dialog.Content>
</Dialog.Root>

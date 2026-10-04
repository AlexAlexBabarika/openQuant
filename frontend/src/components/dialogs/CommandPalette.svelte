<script lang="ts">
  import { untrack } from 'svelte';
  import { Command } from 'bits-ui';
  import * as Dialog from '$lib/components/ui/dialog';
  import { filterCommands, type ResearchCommand } from '$lib/features/workspace/commands';
  import { searchSymbols, type SymbolSearchResult, type SymbolProviders } from '$lib/features/market/symbols';
  let { open = $bindable(false), commands, onSymbol, onLoadScripts, scriptStatus = '' }: {
    open?: boolean; commands: ResearchCommand[]; onSymbol: (symbol: string, providers: SymbolProviders | null) => void;
    onLoadScripts: () => void; scriptStatus?: string;
  } = $props();
  let query = $state('');
  let symbols = $state<SymbolSearchResult[]>([]);
  let searching = $state(false);
  let error = $state<string | null>(null);
  let pendingAction: (() => void) | null = null;
  const visible = $derived(filterCommands(commands, query));
  $effect(() => { if (open) { query = ''; untrack(onLoadScripts); } });
  $effect(() => {
    const q = query.trim();
    symbols = []; error = null; searching = false;
    if (!open || q.length < 2) return;
    const controller = new AbortController();
    searching = true;
    const timer = setTimeout(() => {
      void searchSymbols(q, 12, controller.signal).then(results => {
        if (!controller.signal.aborted) symbols = results;
      }).catch(reason => {
        if (!controller.signal.aborted) error = reason instanceof Error ? reason.message : 'Symbol search unavailable';
      }).finally(() => { if (!controller.signal.aborted) searching = false; });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  });
  function select(action: () => void) { pendingAction = action; open = false; }
  function closed(isOpen: boolean) {
    if (isOpen || !pendingAction) return;
    const action = pendingAction; pendingAction = null; action();
  }
</script>
<Dialog.Root bind:open onOpenChangeComplete={closed}>
  <Dialog.Content portalProps={{ disabled: typeof window === 'undefined' }} class="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-2xl" onCloseAutoFocus={event => { if (pendingAction) event.preventDefault(); }}>
    <Dialog.Header>
      <Dialog.Title>Research commands</Dialog.Title>
      <Dialog.Description>Ctrl/⌘ K to open. Search tools, symbols, account scripts, and local runs. Opening a script does not execute it.</Dialog.Description>
    </Dialog.Header>
    <Command.Root shouldFilter={false} loop class="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2">
      <Command.Input bind:value={query} aria-label="Search research commands" autofocus placeholder="Search commands or symbols…" class="w-full min-w-0 rounded border bg-background px-3 py-2 text-sm" />
      <Command.List class="max-h-[55dvh] min-h-0 overflow-y-auto rounded border">
        {#each visible as command (command.id)}
          <Command.Item value={command.id} onSelect={() => select(command.action)} class="grid cursor-pointer gap-1 px-3 py-2 text-sm outline-none data-[selected]:bg-accent data-[selected]:text-accent-foreground">
            <span class="break-words">{command.title}</span><span class="break-words text-xs text-muted-foreground">{command.group}{command.detail ? ` · ${command.detail}` : ''}</span>
          </Command.Item>
        {/each}
        {#each symbols as symbol (symbol.symbol)}
          <Command.Item value={`symbol-directory:${symbol.symbol}`} onSelect={() => select(() => onSymbol(symbol.symbol, symbol.providers))} class="grid cursor-pointer gap-1 px-3 py-2 text-sm outline-none data-[selected]:bg-accent data-[selected]:text-accent-foreground">
            <span class="break-words">{symbol.symbol} · {symbol.name}</span><span class="text-xs text-muted-foreground">Symbol · {symbol.exchange ?? 'exchange not reported'}</span>
          </Command.Item>
        {/each}
        {#if !visible.length && !symbols.length && !searching}<p class="px-3 py-4 text-sm text-muted-foreground">No matching commands. Try a tool name or a different symbol.</p>{/if}
      </Command.List>
    </Command.Root>
    <div class="grid gap-1 text-xs text-muted-foreground" role="status">
      {#if searching}<p>Searching the symbol directory…</p>{/if}
      {#if error}<p>{error}. Local commands remain available.</p>{/if}
      {#if scriptStatus}<p>{scriptStatus}</p>{/if}
      <p>↑ ↓ to navigate · Enter to select · Escape to close</p>
    </div>
  </Dialog.Content>
</Dialog.Root>

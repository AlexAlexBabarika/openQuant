<script lang="ts">
  import { onDestroy } from 'svelte';
  import { keymap } from '@codemirror/view';
  import ScriptEditor from '../indicators/ScriptEditor.svelte';
  import {
    boundedOptionsStdout,
    optionsPythonExtensions,
    optionsPythonSourceError,
    OPTIONS_SOURCE_LIMIT,
  } from '$lib/features/options/optionsPython';

  let {
    source,
    onChange,
    onRun,
    pending = false,
    stdout = '',
    error = null,
    documentKey = 0,
  }: {
    source: string;
    onChange: (source: string) => void;
    onRun: () => void;
    pending?: boolean;
    stdout?: string;
    error?: string | null;
    documentKey?: string | number;
  } = $props();

  const id = $props.id();
  let limitError = $state<string | null>(null);
  let actionNotice = $state('');
  let alive = true;
  const extensions = [...optionsPythonExtensions(() => {
    limitError = 'Edit rejected: Python is limited to 20,000 characters. The whole edit was rejected; existing source is unchanged.';
  }), keymap.of([{
    key: 'Mod-Enter',
    stopPropagation: true,
    run: () => { run(); return true; },
  }])];
  const sourceError = $derived(optionsPythonSourceError(source));
  const output = $derived(boundedOptionsStdout(stdout));
  const canRun = $derived(!pending && !sourceError);

  $effect(() => {
    source;
    documentKey;
    limitError = null;
    actionNotice = '';
  });
  onDestroy(() => { alive = false; });

  function change(value: string) {
    limitError = null;
    actionNotice = '';
    onChange(value);
  }

  function run() {
    if (canRun) onRun();
  }

  async function copy(text: string, label: string) {
    const key = documentKey;
    const original = source;
    const submitted = stdout;
    try {
      await navigator.clipboard.writeText(text);
      if (alive && key === documentKey && original === source && submitted === stdout)
        actionNotice = `${label} copied.`;
    } catch {
      if (alive && key === documentKey && original === source && submitted === stdout)
        actionNotice = 'Copy unavailable. Use Export to save a local file.';
    }
  }

  function download(text: string, filename: string) {
    try {
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      actionNotice = 'Local export requested. Source is unchanged.';
    } catch {
      actionNotice = 'Local export unavailable. Source is unchanged.';
    }
  }
</script>

<section class="options-python" aria-label="Options Python editor" aria-busy={pending}>
  <div class="actions">
    <span class="heading">Options Python</span>
    <button type="button" class="ot-workbench-primary" disabled={!canRun} onclick={run}>
      {pending ? 'Running…' : 'Run'}
    </button>
    <button type="button" class="ot-workbench-ghost" onclick={() => copy(source, 'Python')}>Copy Python</button>
    <button type="button" class="ot-workbench-ghost" onclick={() => download(source, 'options-research.py')}>Export .py</button>
  </div>
  <p id={`${id}-help`} class="hint">
    Ctrl/⌘+Enter runs only this source while the editor is focused. Ctrl/⌘+Z undo, Ctrl/⌘+Shift+Z redo,
    Ctrl/⌘+F search, Ctrl+Space completions. {source.length.toLocaleString()}/{OPTIONS_SOURCE_LIMIT.toLocaleString()} characters.
  </p>
  <div class="code-region">
    <ScriptEditor value={source} onChange={change} onRun={run} {documentKey} {extensions}
      ariaLabel="Options Python source" ariaDescribedby={`${id}-help ${id}-boundary`} />
  </div>
  {#if limitError || sourceError}
    <p class="editor-error" role="alert">{limitError || sourceError}</p>
  {/if}
  <p id={`${id}-boundary`} class="hint">
    Set <code>result = analyze_options(request)</code>. Injected <code>OptionLeg</code> and <code>OptionStrategy</code>
    return validated dictionaries; no imports needed. Manual/synthetic European cash-settled USD research,
     with per-leg expiry overrides. No arbitrary imports, live quotes, brokerage or historical option execution.
    Switching modes does not replace source; replacing from editor fields is a separate confirmed action.
  </p>
  {#if error}<p class="editor-error" role="alert">{error}</p>{/if}
  <div class="console">
    <div class="actions">
      <span class="heading">Python stdout · submitted output</span>
      <button type="button" class="ot-workbench-ghost" disabled={!output.text}
        onclick={() => copy(output.text, 'stdout')}>Copy stdout</button>
      <button type="button" class="ot-workbench-ghost" disabled={!output.text}
        onclick={() => download(output.text, 'options-stdout.txt')}>Export stdout</button>
    </div>
    {#if pending}<p class="hint" role="status">Analysis pending; any output below belongs to the previous submission.</p>{/if}
    {#if output.text}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex (The bounded stdout region must be keyboard-scrollable.) -->
      <pre tabindex="0" role="region" aria-label="Submitted Python stdout">{output.text}</pre>
    {:else}
      <p class="hint">No Python stdout for this submission. Use <code>print(...)</code> for diagnostics; canonical results remain in the results view.</p>
    {/if}
    {#if output.truncated}<p class="editor-error" role="alert">stdout display and downloads limited to the first 16,384 UTF-8 bytes; additional text is omitted.</p>{/if}
  </div>
  {#if actionNotice}<p class="hint" role="status">{actionNotice}</p>{/if}
</section>

<style>
  .options-python { display: grid; gap: 8px; min-width: 0; color: oklch(var(--foreground)); }
  .actions { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; min-width: 0; }
  .heading { font-family: var(--font-mono); font-size: 11px; overflow-wrap: anywhere; }
  .code-region { height: 360px; min-height: 240px; min-width: 0; border: 1px solid oklch(var(--border)); border-radius: 4px; overflow: hidden; }
  .code-region :global(.cm-tooltip) { background: oklch(var(--popover)); color: oklch(var(--popover-foreground)); border-color: oklch(var(--border)); }
  .code-region :global(.cm-tooltip-autocomplete ul li[aria-selected="true"]) { background: oklch(var(--accent)); color: oklch(var(--accent-foreground)); }
  .code-region :global(.cm-completionInfo) { font-family: var(--font-family-lato); font-size: 12px; line-height: 1.5; }
  .hint { font-size: 12px; line-height: 1.5; margin: 0; overflow-wrap: anywhere; }
  code, pre { font-family: var(--font-mono); }
  .editor-error { color: oklch(var(--down-color)); font-size: 12px; line-height: 1.5; margin: 0; overflow-wrap: anywhere; }
  .console { display: grid; gap: 8px; min-width: 0; border-top: 1px solid oklch(var(--border)); padding-top: 8px; }
  pre { max-height: 200px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; border: 1px solid oklch(var(--border)); border-radius: 4px; padding: 8px; background: oklch(var(--background)); font-size: 12px; line-height: 1.6; }
  pre:focus-visible { outline: 2px solid oklch(var(--ring)); outline-offset: 2px; }
  @media (forced-colors: active) { .code-region, pre { border-color: CanvasText; } pre:focus-visible { outline-color: Highlight; } .editor-error { color: CanvasText; } }
</style>

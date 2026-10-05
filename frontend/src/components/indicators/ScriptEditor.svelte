<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { python } from '@codemirror/lang-python';
  import { EditorState } from '@codemirror/state';
  import {
    EditorView,
    keymap,
    lineNumbers,
    highlightActiveLineGutter,
    highlightActiveLine,
    drawSelection,
  } from '@codemirror/view';
  import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
  import { searchKeymap } from '@codemirror/search';
  import {
    bracketMatching,
    indentOnInput,
    syntaxHighlighting,
    HighlightStyle,
  } from '@codemirror/language';
  import { tags as t } from '@lezer/highlight';
  import { syncEditorDocument } from '$lib/features/indicators/editorDocument';

  let {
    value = $bindable(''),
    documentKey = 0,
    onRun,
    onSave,
  }: {
    value: string;
    documentKey?: number;
    onRun?: () => void;
    onSave?: () => void;
  } = $props();

  let host = $state<HTMLDivElement | null>(null);
  let view: EditorView | null = null;
  let syncedKey: number | undefined;

  // Class-based highlighter so the palette can swap with the app theme via
  // CSS. Dark theme keeps a Tokyo-Night-ish palette; light theme uses a
  // GitHub-Light-inspired set tuned for legibility on a near-white panel.
  const highlight = HighlightStyle.define([
    { tag: t.keyword, class: 'tok-kw' },
    { tag: [t.name, t.deleted, t.character, t.macroName], class: 'tok-name' },
    { tag: [t.function(t.variableName), t.labelName], class: 'tok-fn' },
    {
      tag: [t.color, t.constant(t.name), t.standard(t.name)],
      class: 'tok-const',
    },
    { tag: [t.definition(t.name), t.separator], class: 'tok-name' },
    {
      tag: [t.typeName, t.className, t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace],
      class: 'tok-type',
    },
    {
      tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.link, t.special(t.string)],
      class: 'tok-op',
    },
    { tag: [t.meta, t.comment], class: 'tok-comment' },
    { tag: t.strong, class: 'tok-strong' },
    { tag: t.emphasis, class: 'tok-em' },
    { tag: t.link, class: 'tok-link' },
    { tag: t.heading, class: 'tok-heading' },
    { tag: [t.atom, t.bool, t.special(t.variableName)], class: 'tok-atom' },
    { tag: [t.processingInstruction, t.string, t.inserted], class: 'tok-string' },
    { tag: t.invalid, class: 'tok-invalid' },
  ]);

  const editorTheme = EditorView.theme(
    {
      '&': {
        height: '100%',
        background: 'transparent',
        color: 'oklch(var(--foreground))',
        fontSize: '13px',
        fontFamily: '"Space Mono", ui-monospace, SFMono-Regular, monospace',
      },
      '.cm-scroller': {
        fontFamily: 'inherit',
        lineHeight: '21px',
        padding: '14px 0 60px',
      },
      '.cm-content': {
        caretColor: 'oklch(var(--ring))',
        padding: '0',
      },
      '.cm-cursor, .cm-dropCursor': {
        borderLeft: '2px solid oklch(var(--ring))',
      },
      '&.cm-focused': { outline: '2px solid oklch(var(--ring))', outlineOffset: '-2px' },
      '&.cm-focused .cm-selectionBackground, ::selection, .cm-selectionBackground':
        {
          background:
            'oklch(var(--accent)) !important',
        },
      '.cm-gutters': {
        background: 'oklch(var(--background))',
        color: 'oklch(var(--muted-foreground))',
        border: 'none',
        borderRight: '1px solid oklch(var(--border))',
        paddingRight: '10px',
        paddingLeft: '14px',
        fontVariantNumeric: 'tabular-nums',
        userSelect: 'none',
        fontWeight: '400',
      },
      '.cm-activeLineGutter': {
        background: 'oklch(var(--accent))',
        color: 'oklch(var(--foreground))',
      },
      '.cm-activeLine': {
        background: 'oklch(var(--accent) / 0.4)',
      },
      '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 0' },
      '.cm-matchingBracket': {
        background:
          'color-mix(in oklab, oklch(var(--primary)) 18%, transparent)',
        outline:
          '1px solid color-mix(in oklab, oklch(var(--primary)) 55%, transparent)',
      },
    },
  );

  const updateListener = EditorView.updateListener.of(u => {
    if (u.docChanged) {
      value = u.state.doc.toString();
    }
  });

  function makeState(doc: string): EditorState {
    return EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        drawSelection(),
        bracketMatching(),
        indentOnInput(),
        syntaxHighlighting(highlight),
        python(),
        editorTheme,
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              onRun?.();
              return true;
            },
          },
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              onSave?.();
              return true;
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
        ]),
        updateListener,
      ],
    });
  }

  onMount(() => {
    if (!host) return;
    view = new EditorView({ state: makeState(value), parent: host });
    syncedKey = documentKey;
  });

  onDestroy(() => {
    view?.destroy();
    view = null;
  });

  // Sync external value changes (e.g. opening a different script) into the editor.
  $effect(() => {
    const v = value;
    const key = documentKey;
    if (!view) return;
    syncEditorDocument(view, v, makeState, key !== syncedKey);
    syncedKey = key;
  });
</script>

<div class="editor-shell">
  <div bind:this={host} class="editor-host"></div>
</div>

<style>
  .editor-shell {
    position: relative;
    height: 100%;
    width: 100%;
    overflow: hidden;
    background: oklch(var(--card));
  }
  .editor-host {
    position: absolute;
    inset: 0;
  }
  .editor-host :global(.cm-editor) { height: 100%; }
  .editor-host :global(.cm-content),
  .editor-host :global(.cm-line),
  .editor-host :global(.tok-name) { color: oklch(var(--foreground)); }
  .editor-host :global(.tok-kw),
  .editor-host :global(.tok-fn) { color: oklch(var(--chart-2)); }
  .editor-host :global(.tok-const),
  .editor-host :global(.tok-type),
  .editor-host :global(.tok-atom) { color: oklch(var(--risk)); }
  .editor-host :global(.tok-op),
  .editor-host :global(.tok-link),
  .editor-host :global(.tok-heading) { color: oklch(var(--ring)); }
  .editor-host :global(.tok-comment) { color: oklch(var(--muted-foreground)); font-style: italic; }
  .editor-host :global(.tok-strong),
  .editor-host :global(.tok-heading) { font-weight: 700; }
  .editor-host :global(.tok-em) { font-style: italic; }
  .editor-host :global(.tok-link) { text-decoration: underline; }
  .editor-host :global(.tok-string) { color: oklch(var(--up-color)); }
  .editor-host :global(.tok-invalid) { color: oklch(var(--down-color)); text-decoration: underline wavy; }
</style>

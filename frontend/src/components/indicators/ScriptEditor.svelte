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
        lineHeight: '1.55',
        padding: '14px 0 60px',
      },
      '.cm-content': {
        caretColor: 'oklch(var(--primary))',
        padding: '0',
      },
      '.cm-cursor, .cm-dropCursor': {
        borderLeft: '2px solid oklch(var(--primary))',
      },
      '&.cm-focused': { outline: 'none' },
      '&.cm-focused .cm-selectionBackground, ::selection, .cm-selectionBackground':
        {
          background:
            'color-mix(in oklab, oklch(var(--primary)) 22%, transparent) !important',
        },
      '.cm-gutters': {
        background: 'transparent',
        color: '#000',
        border: 'none',
        borderRight: '1px dashed #000',
        paddingRight: '10px',
        paddingLeft: '14px',
        fontVariantNumeric: 'tabular-nums',
        userSelect: 'none',
        fontWeight: '700',
      },
      '.cm-activeLineGutter': {
        background: '#000',
        color: '#fff',
      },
      '.cm-activeLine': {
        background: 'transparent',
        boxShadow: 'inset 2px 0 0 #000',
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
  <div class="editor-grid" aria-hidden="true"></div>
  <div bind:this={host} class="editor-host"></div>
</div>

<style>
  .editor-shell {
    position: relative;
    height: 100%;
    width: 100%;
    overflow: hidden;
    /* Light theme: pure white. Dark theme override below. */
    background: #ffffff;
  }
  :global(html.dark) .editor-shell {
    background: color-mix(in oklab, oklch(var(--background)) 92%, black 8%);
  }
  /* Engineering-paper dot grid — only in dark mode. Light mode is clean white. */
  .editor-grid {
    position: absolute;
    inset: 0;
    pointer-events: none;
    display: none;
  }
  :global(html.dark) .editor-grid {
    display: block;
    background-image: radial-gradient(
      color-mix(in oklab, oklch(var(--foreground)) 8%, transparent) 1px,
      transparent 1px
    );
    background-size: 22px 22px;
    background-position: 14px 14px;
    opacity: 0.45;
    mask-image: linear-gradient(180deg, black 0, black 70%, transparent);
  }
  .editor-host {
    position: absolute;
    inset: 0;
  }
  .editor-host :global(.cm-editor) {
    height: 100%;
  }

  /* Dark-mode chrome — restore the soft greys that read well on dark bg. */
  :global(html.dark) .editor-host :global(.cm-gutters) {
    color: color-mix(in oklab, oklch(var(--foreground)) 28%, transparent);
    border-right: 1px dashed
      color-mix(in oklab, oklch(var(--border)) 90%, transparent);
    font-weight: 400;
  }
  :global(html.dark) .editor-host :global(.cm-activeLineGutter) {
    background: transparent;
    color: oklch(var(--foreground));
  }
  :global(html.dark) .editor-host :global(.cm-activeLine) {
    background: color-mix(in oklab, oklch(var(--foreground)) 4%, transparent);
    box-shadow: none;
  }

  /* Light palette (default) — colorful syntax on pure white. */
  .editor-host :global(.cm-content),
  .editor-host :global(.cm-line) {
    color: #1f2328;
  }
  .editor-host :global(.tok-kw)      { color: #cf222e; font-style: italic; }
  .editor-host :global(.tok-name)    { color: #1f2328; }
  .editor-host :global(.tok-fn)      { color: #6639ba; font-weight: 600; }
  .editor-host :global(.tok-const)   { color: #953800; }
  .editor-host :global(.tok-type)    { color: #953800; }
  .editor-host :global(.tok-op)      { color: #0550ae; }
  .editor-host :global(.tok-comment) { color: #57606a; font-style: italic; }
  .editor-host :global(.tok-strong)  { font-weight: 700; }
  .editor-host :global(.tok-em)      { font-style: italic; }
  .editor-host :global(.tok-link)    { color: #0969da; text-decoration: underline; }
  .editor-host :global(.tok-heading) { color: #0969da; font-weight: 700; }
  .editor-host :global(.tok-atom)    { color: #953800; font-weight: 600; }
  .editor-host :global(.tok-string)  { color: #0a3069; }
  .editor-host :global(.tok-invalid) { color: #cf222e; text-decoration: underline wavy; }

  /* Dark palette — Tokyo-Night-ish, kept from previous design. */
  :global(html.dark) .editor-host :global(.cm-content),
  :global(html.dark) .editor-host :global(.cm-line) {
    color: #e8e6f0;
  }
  :global(html.dark) .editor-host :global(.tok-kw)      { color: #c792ea; font-style: italic; font-weight: 400; text-decoration: none; background: transparent; }
  :global(html.dark) .editor-host :global(.tok-name)    { color: #e8e6f0; font-weight: 400; }
  :global(html.dark) .editor-host :global(.tok-fn)      { color: #82aaff; font-weight: 400; }
  :global(html.dark) .editor-host :global(.tok-const)   { color: #f78c6c; font-weight: 400; }
  :global(html.dark) .editor-host :global(.tok-type)    { color: #ffcb6b; font-weight: 400; }
  :global(html.dark) .editor-host :global(.tok-op)      { color: #89ddff; }
  :global(html.dark) .editor-host :global(.tok-comment) {
    color: #637085;
    font-style: italic;
    text-decoration: none;
  }
  :global(html.dark) .editor-host :global(.tok-link)    { color: #82aaff; text-decoration: underline; }
  :global(html.dark) .editor-host :global(.tok-heading) { color: #82aaff; font-weight: bold; }
  :global(html.dark) .editor-host :global(.tok-atom)    { color: #f78c6c; font-weight: 400; font-style: normal; }
  :global(html.dark) .editor-host :global(.tok-string)  {
    color: #c3e88d;
    font-style: normal;
    background: transparent;
    padding: 0;
  }
  :global(html.dark) .editor-host :global(.tok-invalid) {
    color: #ff5370;
    background: transparent;
    text-decoration: none;
  }
</style>

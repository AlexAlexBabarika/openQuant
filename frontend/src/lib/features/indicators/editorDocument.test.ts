import { describe, expect, it, vi } from 'vitest';
import { EditorState, type TransactionSpec } from '@codemirror/state';
import { history, undo, undoDepth } from '@codemirror/commands';
import { syncEditorDocument } from './editorDocument';
import { readFileSync } from 'node:fs';
import { parse } from 'svelte/compiler';
import ts from 'typescript';
import * as stateModule from '@codemirror/state';
import * as viewModule from '@codemirror/view';
import * as commands from '@codemirror/commands';
import * as search from '@codemirror/search';
import * as language from '@codemirror/language';
import { python } from '@codemirror/lang-python';
import { tags } from '@lezer/highlight';
import { optionsPythonExtensions } from '../options/optionsPython';

function makeState(code: string) {
  return EditorState.create({ doc: code, extensions: [history()] });
}

function fakeView(code: string) {
  const view = {
    state: makeState(code),
    dispatch: (spec: TransactionSpec) => {
      view.state = view.state.update(spec).state;
    },
    setState: vi.fn((state: EditorState) => {
      view.state = state;
    }),
  };
  return view;
}

describe('editor document synchronization', () => {
  it('does not undo back into the previous script after selecting another script', () => {
    const view = fakeView('first saved code');
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: 'first draft edits',
      },
    });
    expect(undoDepth(view.state)).toBe(1);
    syncEditorDocument(view, 'second saved code', makeState);
    expect(view.state.doc.toString()).toBe('second saved code');
    expect(undoDepth(view.state)).toBe(0);
    expect(
      undo({
        state: view.state,
        dispatch: transaction => {
          view.state = transaction.state;
        },
      }),
    ).toBe(false);
    expect(view.state.doc.toString()).toBe('second saved code');
  });

  it('keeps the current script undo history when its binding echoes a local edit', () => {
    const view = fakeView('original');
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: 'typed edit' },
    });
    syncEditorDocument(view, 'typed edit', makeState);
    expect(view.setState).not.toHaveBeenCalled();
    expect(undoDepth(view.state)).toBe(1);
    expect(
      undo({
        state: view.state,
        dispatch: transaction => {
          view.state = transaction.state;
        },
      }),
    ).toBe(true);
    expect(view.state.doc.toString()).toBe('original');
  });

  it('resets history when a different draft has identical text', () => {
    const view = fakeView('original');
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: 'same code' },
    });
    syncEditorDocument(view, 'same code', makeState, true);
    expect(view.setState).toHaveBeenCalledOnce();
    expect(undoDepth(view.state)).toBe(0);
    expect(view.state.doc.toString()).toBe('same code');
  });
});

describe('ScriptEditor opt-in extensions', () => {
  function configuredEditor(extra: stateModule.Extension[] = []) {
    const source = readFileSync(
      new URL(
        '../../../components/indicators/ScriptEditor.svelte',
        import.meta.url,
      ),
      'utf8',
    );
    const ast = parse(source, { modern: true });
    const declarations = ast.instance!.content.body.filter(
      node =>
        (node.type === 'VariableDeclaration' &&
          node.declarations.some(
            d =>
              d.id.type === 'Identifier' &&
              ['highlight', 'editorTheme', 'updateListener'].includes(
                d.id.name,
              ),
          )) ||
        (node.type === 'FunctionDeclaration' && node.id?.name === 'makeState'),
    );
    const script = declarations
      .map(node => {
        const span = node as typeof node & { start: number; end: number };
        return source.slice(span.start, span.end);
      })
      .join('\n');
    const code = ts.transpileModule(script, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const onRun = vi.fn();
    const onSave = vi.fn();
    const onChange = vi.fn();
    const dependencies = {
      ...stateModule,
      ...viewModule,
      ...commands,
      ...search,
      ...language,
      python,
      t: tags,
      extensions: extra,
      ariaLabel: 'Test source',
      ariaDescribedby: 'test-help',
      onRun,
      onSave,
      onChange,
    };
    const makeState = new Function(
      ...Object.keys(dependencies),
      `let value = ''; ${code}; return makeState;`,
    )(...Object.values(dependencies)) as (doc: string) => EditorState;
    return { makeState, onRun, onSave, onChange };
  }

  it('retains stock/indicator highlighting, undo/redo/search and scoped run/save defaults', () => {
    const { makeState, onRun, onSave } = configuredEditor();
    const state = makeState('original');
    const bindings = state.facet(viewModule.keymap).flat();
    const run = bindings.find(binding => binding.key === 'Mod-Enter')!;
    const save = bindings.find(binding => binding.key === 'Mod-s')!;
    expect(run.run!({} as viewModule.EditorView)).toBe(true);
    expect(save.run!({} as viewModule.EditorView)).toBe(true);
    expect(onRun).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledOnce();
    expect(
      bindings.some(binding => binding.run === search.openSearchPanel),
    ).toBe(true);
    expect(bindings.some(binding => binding.run === commands.undo)).toBe(true);
    expect(bindings.some(binding => binding.run === commands.redo)).toBe(true);
    expect(language.syntaxTree(state).toString()).toContain('VariableName');
    expect(state.facet(viewModule.EditorView.contentAttributes)).toContainEqual(
      { 'aria-label': 'Test source', 'aria-describedby': 'test-help' },
    );
    const long = state.update({
      changes: { from: 0, insert: 'x'.repeat(20001) },
    }).state;
    expect(long.doc.length).toBe(20009);
    expect(undoDepth(long)).toBe(1);
  });

  it('uses extensions and local-only onChange without leaking previous document history or search', () => {
    const { makeState, onChange } = configuredEditor([
      search.search(),
      ...optionsPythonExtensions(vi.fn()),
    ]);
    const view = {
      state: makeState('private source'),
      setState: vi.fn((state: EditorState) => {
        view.state = state;
      }),
    };
    view.state = view.state.update({
      changes: { from: 0, to: view.state.doc.length, insert: 'same text' },
    }).state;
    view.state = view.state.update({
      effects: search.setSearchQuery.of(
        new search.SearchQuery({ search: 'private' }),
      ),
    }).state;
    expect(search.getSearchQuery(view.state).search).toBe('private');
    expect(undoDepth(view.state)).toBe(1);
    syncEditorDocument(view, 'same text', makeState, true);
    expect(undoDepth(view.state)).toBe(0);
    expect(search.getSearchQuery(view.state).search).toBe('');
    expect(onChange).not.toHaveBeenCalled();
    expect(
      view.state
        .update({ changes: { from: 0, insert: 'a'.repeat(20001) } })
        .state.doc.toString(),
    ).toBe('same text');
    for (const listener of view.state.facet(
      viewModule.EditorView.updateListener,
    ))
      listener({
        docChanged: true,
        state: makeState('local edit'),
      } as viewModule.ViewUpdate);
    expect(onChange).toHaveBeenCalledWith('local edit');
  });
});

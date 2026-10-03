import { describe, expect, it, vi } from 'vitest';
import { EditorState, type TransactionSpec } from '@codemirror/state';
import { history, undo, undoDepth } from '@codemirror/commands';
import { syncEditorDocument } from './editorDocument';

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

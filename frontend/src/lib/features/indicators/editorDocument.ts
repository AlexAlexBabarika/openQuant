import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

export function syncEditorDocument(
  view: Pick<EditorView, 'state' | 'setState'>,
  code: string,
  makeState: (code: string) => EditorState,
  reset = false,
): void {
  if (!reset && view.state.doc.toString() === code) return;
  view.setState(makeState(code));
}

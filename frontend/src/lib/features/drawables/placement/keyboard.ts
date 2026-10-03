export function chartKeyAction(
  event: Pick<KeyboardEvent, 'key' | 'target'>,
  placing: boolean,
  visibleSelection: boolean,
): 'cancel' | 'deselect' | 'delete' | null {
  const target = event.target as HTMLElement | null;
  if (
    target?.closest?.(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
    )
  )
    return null;
  if (event.key === 'Escape') return placing ? 'cancel' : 'deselect';
  if ((event.key === 'Delete' || event.key === 'Backspace') && visibleSelection)
    return 'delete';
  return null;
}

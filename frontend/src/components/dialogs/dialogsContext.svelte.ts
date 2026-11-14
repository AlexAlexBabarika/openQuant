import { getContext, setContext } from 'svelte';
import type { FlagConflict } from '$lib/features/market/watchlist.svelte';
import type { TickerNote } from '$lib/features/notes/notes';

export type GroupDialogMode = 'add' | 'rename';

export type NoteDialogState = {
  mode: 'create' | 'edit';
  symbol: string;
  note?: TickerNote;
};

export type FlagConflictState = FlagConflict;

export class AppDialogsState {
  groupDialogMode = $state<GroupDialogMode | null>(null);
  addSymbolDialogOpen = $state(false);
  noteDialogState = $state<NoteDialogState | null>(null);
  flagConflict = $state<FlagConflictState | null>(null);

  openAddGroup = (): void => {
    this.groupDialogMode = 'add';
  };
  openRenameGroup = (): void => {
    this.groupDialogMode = 'rename';
  };
  closeGroupDialog = (): void => {
    this.groupDialogMode = null;
  };

  openAddSymbol = (): void => {
    this.addSymbolDialogOpen = true;
  };
  setAddSymbolOpen = (v: boolean): void => {
    this.addSymbolDialogOpen = v;
  };

  openAddNote = (symbol: string): void => {
    this.noteDialogState = { mode: 'create', symbol };
  };
  openEditNote = (note: TickerNote): void => {
    this.noteDialogState = { mode: 'edit', symbol: note.symbol, note };
  };
  closeNoteDialog = (): void => {
    this.noteDialogState = null;
  };

  showFlagConflict = (state: FlagConflictState): void => {
    this.flagConflict = state;
  };
  clearFlagConflict = (): void => {
    this.flagConflict = null;
  };
}

const KEY = Symbol('appDialogs');

export function provideAppDialogs(state: AppDialogsState): void {
  setContext(KEY, state);
}

export function useAppDialogs(): AppDialogsState {
  const ctx = getContext<AppDialogsState | undefined>(KEY);
  if (!ctx) throw new Error('AppDialogs context not provided');
  return ctx;
}

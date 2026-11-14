import { describe, expect, it, vi } from 'vitest';
import {
  SavedScriptDraft,
  type SavedScript,
  type ScriptStore,
} from './savedScriptDraft.svelte';

const STARTER = 'starter code';

function script(over: Partial<SavedScript> = {}): SavedScript {
  return { id: 's1', name: 'First', code: 'saved code', ...over };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function memoryStore(over: Partial<ScriptStore<SavedScript>> = {}) {
  return {
    list: vi.fn(async () => [script()]),
    create: vi.fn(async (name: string, code: string) =>
      script({ id: 'new1', name, code }),
    ),
    update: vi.fn(async (id: string, patch: { name: string; code: string }) =>
      script({ id, ...patch }),
    ),
    remove: vi.fn(async () => undefined),
    ...over,
  };
}

class Draft extends SavedScriptDraft<SavedScript> {
  replaced = 0;
  removed: string[] = [];
  protected override draftReplaced(): void {
    this.replaced++;
  }
  protected override scriptRemoved(id: string): void {
    this.removed.push(id);
  }
}

function draft(over: Partial<ScriptStore<SavedScript>> = {}) {
  const store = memoryStore(over);
  const state = new Draft({
    store,
    untitled: 'Untitled',
    starterCode: STARTER,
    loadFailed: 'Failed to load',
  });
  return { state, store };
}

describe('saved-script draft: loading and selecting', () => {
  it('starts as an untitled, clean starter draft', () => {
    const { state } = draft();
    expect(state.draftName).toBe('Untitled');
    expect(state.draftCode).toBe(STARTER);
    expect(state.dirty).toBe(false);
    expect(state.active).toBeNull();
  });

  it('loads the saved list, and records why a load failed', async () => {
    const { state } = draft();
    await state.load();
    expect(state.scripts).toHaveLength(1);
    expect(state.loadError).toBeNull();
    expect(state.loading).toBe(false);

    const failing = draft({
      list: vi.fn(async () => {
        throw new Error('nope');
      }),
    }).state;
    await failing.load();
    expect(failing.loadError).toBe('nope');

    const opaque = draft({
      list: vi.fn(async () => {
        throw 'not an error';
      }),
    }).state;
    await opaque.load();
    expect(opaque.loadError).toBe('Failed to load');
  });

  it('selecting copies the saved script into a clean draft', async () => {
    const { state } = draft();
    await state.load();
    state.select('s1');
    expect(state.activeId).toBe('s1');
    expect(state.active?.name).toBe('First');
    expect(state.draftName).toBe('First');
    expect(state.draftCode).toBe('saved code');
    expect(state.dirty).toBe(false);
  });

  it('editing the name or code marks the draft dirty, once it really changes', () => {
    const { state } = draft();
    state.setCode(STARTER);
    state.setName('Untitled');
    expect(state.dirty).toBe(false);
    state.setCode('changed');
    expect(state.dirty).toBe(true);
    expect(state.draftCode).toBe('changed');
  });

  it('keeps a dirty draft unless the caller agrees to discard it', () => {
    const { state } = draft();
    state.scripts = [script(), script({ id: 's2' })];
    state.select('s1');
    state.setCode('unsaved');
    const cancel = vi.fn(() => false);
    state.select('s1', cancel);
    expect(cancel).not.toHaveBeenCalled();
    state.select('s2', cancel);
    state.newDraft(cancel);
    expect(cancel).toHaveBeenCalledTimes(2);
    state.select('s2');
    state.newDraft();
    expect(state.activeId).toBe('s1');
    expect(state.draftCode).toBe('unsaved');
    state.select('s2', () => true);
    expect(state.activeId).toBe('s2');
  });

  it('bumps the draft version whenever the editor shows a different document', () => {
    const { state } = draft();
    state.scripts = [script()];
    const start = state.draftVersion;
    state.setCode('typing does not count');
    expect(state.draftVersion).toBe(start);
    state.select('s1', () => true);
    state.newDraft();
    expect(state.draftVersion).toBe(start + 2);
  });
});

describe('saved-script draft: saving', () => {
  it('creates an unsaved draft and updates a saved one', async () => {
    const { state, store } = draft();
    state.setName('Fresh');
    const created = await state.save();
    expect(store.create).toHaveBeenCalledWith('Fresh', STARTER);
    expect(created?.id).toBe('new1');
    expect(state.activeId).toBe('new1');
    expect(state.dirty).toBe(false);
    state.setCode('v2');
    await state.save();
    expect(store.update).toHaveBeenCalledWith('new1', {
      name: 'Fresh',
      code: 'v2',
    });
  });

  it('refuses a blank name without calling the store', async () => {
    const { state, store } = draft();
    state.setName('   ');
    expect(await state.save()).toBeNull();
    expect(state.saveError).toBe('Name is required');
    expect(store.create).not.toHaveBeenCalled();
  });

  it('keeps edits typed during a create dirty and updates the created id next time', async () => {
    const pending = deferred<SavedScript>();
    const { state, store } = draft({ create: vi.fn(() => pending.promise) });
    state.setCode('submitted');
    const saving = state.save();
    state.setCode('newer code');
    state.setName('newer name');
    pending.resolve(script({ id: 'new1', code: 'submitted' }));
    await saving;
    expect(state.activeId).toBe('new1');
    expect(state.dirty).toBe(true);
    expect(state.draftCode).toBe('newer code');
    expect(state.draftName).toBe('newer name');
    await state.save();
    expect(store.update).toHaveBeenCalledWith('new1', {
      name: 'newer name',
      code: 'newer code',
    });
  });

  it('does not steal selection or clear newer edits when a save resolves', async () => {
    const pending = deferred<SavedScript>();
    const { state } = draft({ update: vi.fn(() => pending.promise) });
    state.scripts = [script(), script({ id: 's2' })];
    state.select('s1');
    state.setCode('submitted');
    const saving = state.save();
    state.select('s2', () => true);
    state.setCode('second edited');
    pending.resolve(script({ code: 'submitted' }));
    await saving;
    expect(state.activeId).toBe('s2');
    expect(state.draftCode).toBe('second edited');
    expect(state.dirty).toBe(true);
    expect(state.scripts.find(s => s.id === 's1')?.code).toBe('submitted');
  });

  it('does not attach an old create to an identical new draft', async () => {
    const pending = deferred<SavedScript>();
    const { state } = draft({ create: vi.fn(() => pending.promise) });
    const saving = state.save();
    state.newDraft();
    pending.resolve(script());
    await saving;
    expect(state.activeId).toBeNull();
    expect(state.draftCode).toBe(STARTER);
  });

  it('protects the earlier source reopened before an in-flight update finishes', async () => {
    const pending = deferred<SavedScript>();
    const { state } = draft({ update: vi.fn(() => pending.promise) });
    state.scripts = [script({ code: 'original' }), script({ id: 's2' })];
    state.select('s1');
    state.setCode('submitted');
    const saving = state.save();
    state.select('s2', () => true);
    state.select('s1');
    pending.resolve(script({ code: 'submitted' }));
    await saving;
    expect(state.draftCode).toBe('original');
    expect(state.dirty).toBe(true);
  });

  it('does not duplicate creates from repeated save shortcuts', async () => {
    const pending = deferred<SavedScript>();
    const { state, store } = draft({ create: vi.fn(() => pending.promise) });
    const first = state.save();
    expect(await state.save()).toBeNull();
    expect(state.isSaving).toBe(true);
    expect(store.create).toHaveBeenCalledTimes(1);
    pending.resolve(script());
    await first;
    expect(state.isSaving).toBe(false);
  });

  it('shows a save failure on its own draft, never on the draft that replaced it', async () => {
    const failing = draft({
      create: vi.fn(async () => {
        throw new Error('disk full');
      }),
    }).state;
    expect(await failing.save()).toBeNull();
    expect(failing.saveError).toBe('disk full');

    const pending = deferred<SavedScript>();
    const { state } = draft({ create: vi.fn(() => pending.promise) });
    const saving = state.save();
    state.newDraft();
    pending.reject(new Error('old save failed'));
    expect(await saving).toBeNull();
    expect(state.saveError).toBeNull();
  });

  it('does not let a late list reply erase a newly saved script', async () => {
    const pending = deferred<SavedScript[]>();
    const { state } = draft({ list: vi.fn(() => pending.promise) });
    const loading = state.load();
    await state.save();
    pending.resolve([]);
    await loading;
    expect(state.scripts.map(s => s.id)).toEqual(['new1']);
    expect(state.loading).toBe(false);
  });
});

describe('saved-script draft: deleting', () => {
  it('deletes a script and resets the draft when it was showing', async () => {
    const { state, store } = draft();
    await state.load();
    state.select('s1');
    await state.remove('s1');
    expect(store.remove).toHaveBeenCalledWith('s1');
    expect(state.scripts).toHaveLength(0);
    expect(state.activeId).toBeNull();
    expect(state.draftCode).toBe(STARTER);
    expect(state.dirty).toBe(false);
  });

  it('keeps text typed while deleting as a new unsaved draft', async () => {
    const pending = deferred<void>();
    const { state } = draft({ remove: vi.fn(() => pending.promise) });
    state.scripts = [script()];
    state.select('s1');
    const deleting = state.remove('s1');
    state.setCode('typed during delete');
    pending.resolve();
    await deleting;
    expect(state.scripts).toHaveLength(0);
    expect(state.activeId).toBeNull();
    expect(state.draftCode).toBe('typed during delete');
    expect(state.dirty).toBe(true);
  });

  it('prevents conflicting saves and deletes of the same script', async () => {
    const saving = deferred<SavedScript>();
    const deleting = deferred<void>();
    const { state, store } = draft({
      update: vi.fn(() => saving.promise),
      remove: vi.fn(() => deleting.promise),
    });
    state.scripts = [script()];
    state.select('s1');
    const save = state.save();
    await expect(state.remove('s1')).rejects.toThrow('save');
    expect(store.remove).not.toHaveBeenCalled();
    saving.resolve(script());
    await save;
    const remove = state.remove('s1');
    expect(await state.save()).toBeNull();
    expect(state.saveError).toContain('delet');
    deleting.resolve();
    await remove;
  });

  it('leaves the draft alone when a delete fails, and allows a retry', async () => {
    const remove = vi
      .fn()
      .mockRejectedValueOnce(new Error('delete failed'))
      .mockResolvedValueOnce(undefined);
    const { state } = draft({ remove });
    state.scripts = [script()];
    state.select('s1');
    await expect(state.remove('s1')).rejects.toThrow('delete failed');
    expect(state.activeId).toBe('s1');
    expect(state.scripts).toHaveLength(1);
    await state.remove('s1');
    expect(state.scripts).toHaveLength(0);
  });
});

describe('saved-script draft: account changes', () => {
  it('forgets the saved scripts but keeps the editor text as an unsaved draft', () => {
    const { state } = draft();
    state.scripts = [script()];
    state.select('s1');
    state.setCode('draft work');
    state.clearSaved();
    expect(state.scripts).toEqual([]);
    expect(state.activeId).toBeNull();
    expect(state.draftCode).toBe('draft work');
    expect(state.dirty).toBe(true);
  });

  it('ignores a saved list arriving after the account changes', async () => {
    const pending = deferred<SavedScript[]>();
    const { state } = draft({ list: vi.fn(() => pending.promise) });
    const loading = state.load();
    state.clearSaved();
    pending.resolve([script()]);
    await loading;
    expect(state.scripts).toEqual([]);
    expect(state.loading).toBe(false);
  });

  it('ignores a save arriving after the account changes', async () => {
    const pending = deferred<SavedScript>();
    const { state } = draft({ create: vi.fn(() => pending.promise) });
    const saving = state.save();
    state.clearSaved();
    pending.resolve(script());
    expect(await saving).toBeNull();
    expect(state.scripts).toEqual([]);
    expect(state.activeId).toBeNull();
    expect(state.isSaving).toBe(false);
  });

  it.each(['resolve', 'reject'] as const)(
    'does not let an old save %s unlock a new owner save',
    async outcome => {
      const old = deferred<SavedScript>();
      const latest = deferred<SavedScript>();
      const { state } = draft({
        create: vi
          .fn()
          .mockReturnValueOnce(old.promise)
          .mockReturnValueOnce(latest.promise),
      });
      const first = state.save();
      state.clearSaved();
      state.setCode('new owner draft');
      const second = state.save();
      expect(state.isSaving).toBe(true);
      if (outcome === 'resolve') old.resolve(script({ id: 'old' }));
      else old.reject(new Error('old failure'));
      expect(await first).toBeNull();
      expect(state.isSaving).toBe(true);
      expect(state.saveError).toBeNull();
      expect(state.scripts).toEqual([]);
      latest.resolve(script({ id: 'new', code: 'new owner draft' }));
      expect((await second)?.id).toBe('new');
      expect(state.isSaving).toBe(false);
      expect(state.activeId).toBe('new');
    },
  );

  it.each(['resolve', 'reject'] as const)(
    'does not leak an old delete %s or unlock the current delete',
    async outcome => {
      const old = deferred<void>();
      const latest = deferred<void>();
      const remove = vi
        .fn()
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(latest.promise);
      const { state } = draft({ remove });
      state.scripts = [script()];
      const first = state.remove('s1');
      state.clearSaved();
      state.scripts = [script({ name: 'new owner' })];
      const second = state.remove('s1');
      if (outcome === 'resolve') old.resolve();
      else old.reject(new Error('old owner error'));
      await expect(first).resolves.toBeUndefined();
      expect(state.scripts[0]?.name).toBe('new owner');
      await state.remove('s1');
      expect(remove).toHaveBeenCalledTimes(2);
      latest.resolve();
      await second;
      expect(state.scripts).toEqual([]);
    },
  );
});

describe('saved-script draft: what its owner is told', () => {
  it('reports when the unsaved draft is replaced or becomes a saved script', async () => {
    const { state } = draft();
    state.scripts = [script()];
    state.newDraft();
    state.select('s1');
    expect(state.replaced).toBe(2);
    state.newDraft();
    await state.save();
    expect(state.replaced).toBe(4);
    state.setCode('v2');
    await state.save();
    expect(state.replaced).toBe(4);
  });

  it('reports each deleted script, and a replaced draft when edits survive the delete', async () => {
    const pending = deferred<void>();
    const { state } = draft({ remove: vi.fn(() => pending.promise) });
    state.scripts = [script()];
    state.select('s1');
    const before = state.replaced;
    const deleting = state.remove('s1');
    state.setCode('typed during delete');
    pending.resolve();
    await deleting;
    expect(state.removed).toEqual(['s1']);
    expect(state.replaced).toBe(before + 1);
  });
});

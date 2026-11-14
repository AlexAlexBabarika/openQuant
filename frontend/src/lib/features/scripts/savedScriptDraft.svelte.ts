export interface SavedScript {
  id: string;
  name: string;
  code: string;
}

/** Where saved scripts live. HTTP in the app; an in-memory fake in tests. */
export interface ScriptStore<T extends SavedScript> {
  list(): Promise<T[]>;
  create(name: string, code: string): Promise<T>;
  update(id: string, patch: { name: string; code: string }): Promise<T>;
  remove(id: string): Promise<void>;
}

export interface SavedScriptDraftOptions<T extends SavedScript> {
  store: ScriptStore<T>;
  untitled: string;
  starterCode: string;
  loadFailed: string;
}

/**
 * One editor draft over a list of saved scripts. Owns the races between editing,
 * saving, deleting, list refreshes and account switches: a reply only lands if
 * the draft, the list and the account it was issued for are still current.
 */
export class SavedScriptDraft<T extends SavedScript> {
  scripts = $state<T[]>([]);
  loading = $state(false);
  loadError = $state<string | null>(null);

  activeId = $state<string | null>(null);
  draftName = $state('');
  draftCode = $state('');
  dirty = $state(false);

  isSaving = $state(false);
  saveError = $state<string | null>(null);

  #options: SavedScriptDraftOptions<T>;
  #draftVersion = $state(0);
  #revision = 0;
  #listRequest = 0;
  #scriptsRevision = 0;
  #savingId: string | null = null;
  #deleting = new Set<string>();
  #accountVersion = 0;

  constructor(options: SavedScriptDraftOptions<T>) {
    this.#options = options;
    this.draftName = options.untitled;
    this.draftCode = options.starterCode;
  }

  /** Bumps whenever the editor shows a different document. */
  get draftVersion(): number {
    return this.#draftVersion;
  }

  /** Bumps at every account boundary; work started before it must not land. */
  protected get accountVersion(): number {
    return this.#accountVersion;
  }

  /** A delete for this script is in flight. */
  protected isRemoving(id: string): boolean {
    return this.#deleting.has(id);
  }

  /** The unsaved draft was replaced or became a saved script. */
  protected draftReplaced(): void {}

  /** A saved script was deleted. */
  protected scriptRemoved(_id: string): void {}

  active = $derived.by(() =>
    this.activeId
      ? (this.scripts.find(s => s.id === this.activeId) ?? null)
      : null,
  );

  /** Forget the account's saved scripts; the editor text stays as an unsaved draft. */
  clearSaved(): void {
    this.#accountVersion++;
    this.#listRequest++;
    this.#scriptsRevision++;
    this.#draftVersion++;
    this.scripts = [];
    this.loading = false;
    this.loadError = null;
    this.saveError = null;
    this.isSaving = false;
    this.#savingId = null;
    this.#deleting.clear();
    if (this.activeId) this.dirty = true;
    this.activeId = null;
  }

  dispose(): void {
    this.clearSaved();
  }

  async load(): Promise<void> {
    const request = ++this.#listRequest;
    const revision = this.#scriptsRevision;
    this.loading = true;
    this.loadError = null;
    try {
      const scripts = await this.#options.store.list();
      if (request === this.#listRequest && revision === this.#scriptsRevision)
        this.scripts = scripts;
    } catch (err) {
      if (request === this.#listRequest && revision === this.#scriptsRevision)
        this.loadError =
          err instanceof Error ? err.message : this.#options.loadFailed;
    } finally {
      if (request === this.#listRequest) this.loading = false;
    }
  }

  /** `discard` decides whether unsaved changes may be dropped; the default keeps them. */
  newDraft(discard = () => false): void {
    if (this.dirty && !discard()) return;
    this.#draftVersion++;
    this.draftReplaced();
    this.activeId = null;
    this.draftName = this.#options.untitled;
    this.draftCode = this.#options.starterCode;
    this.dirty = false;
    this.saveError = null;
  }

  select(id: string, discard = () => false): void {
    if (id === this.activeId) return;
    const s = this.scripts.find(x => x.id === id);
    if (!s) return;
    if (this.dirty && !discard()) return;
    this.#draftVersion++;
    this.draftReplaced();
    this.activeId = id;
    this.draftName = s.name;
    this.draftCode = s.code;
    this.dirty = false;
    this.saveError = null;
  }

  setName(name: string): void {
    if (this.draftName === name) return;
    this.draftName = name;
    this.#revision++;
    this.dirty = true;
  }

  setCode(code: string): void {
    if (this.draftCode === code) return;
    this.draftCode = code;
    this.#revision++;
    this.dirty = true;
  }

  async save(): Promise<T | null> {
    if (this.isSaving) return null;
    const id = this.activeId;
    if (id && this.#deleting.has(id)) {
      this.saveError = 'Wait for deletion to finish before saving';
      return null;
    }
    const name = this.draftName.trim();
    if (!name) {
      this.saveError = 'Name is required';
      return null;
    }
    this.isSaving = true;
    this.#savingId = id;
    this.saveError = null;
    const version = this.#draftVersion;
    const revision = this.#revision;
    const code = this.draftCode;
    const accountVersion = this.#accountVersion;
    try {
      const store = this.#options.store;
      const saved = id
        ? await store.update(id, { name, code })
        : await store.create(name, code);
      if (accountVersion !== this.#accountVersion) return null;
      this.#scriptsRevision++;
      const idx = this.scripts.findIndex(s => s.id === saved.id);
      if (idx >= 0) this.scripts[idx] = saved;
      else this.scripts = [saved, ...this.scripts];
      if (version === this.#draftVersion) {
        if (!id) this.draftReplaced();
        this.activeId = saved.id;
        if (revision === this.#revision) {
          this.draftName = saved.name;
          this.dirty = false;
        }
      } else if (
        this.activeId === saved.id &&
        (this.draftCode !== saved.code || this.draftName !== saved.name)
      ) {
        this.dirty = true;
      }
      return saved;
    } catch (err) {
      if (
        accountVersion === this.#accountVersion &&
        version === this.#draftVersion
      )
        this.saveError = err instanceof Error ? err.message : 'Failed to save';
      return null;
    } finally {
      if (accountVersion === this.#accountVersion) {
        this.isSaving = false;
        this.#savingId = null;
      }
    }
  }

  async remove(id: string): Promise<void> {
    if (this.isSaving && this.#savingId === id)
      throw new Error('Wait for the save to finish before deleting');
    if (this.#deleting.has(id)) return;
    this.#deleting.add(id);
    const version = this.#draftVersion;
    const revision = this.#revision;
    const accountVersion = this.#accountVersion;
    try {
      await this.#options.store.remove(id);
      if (accountVersion !== this.#accountVersion) return;
      this.#scriptsRevision++;
      this.scripts = this.scripts.filter(s => s.id !== id);
      this.scriptRemoved(id);
      if (this.activeId === id) {
        if (version === this.#draftVersion && revision === this.#revision)
          this.newDraft(() => true);
        else {
          this.#draftVersion++;
          this.draftReplaced();
          this.activeId = null;
          this.dirty = true;
        }
      }
    } catch (err) {
      if (accountVersion === this.#accountVersion) throw err;
    } finally {
      if (accountVersion === this.#accountVersion) this.#deleting.delete(id);
    }
  }
}

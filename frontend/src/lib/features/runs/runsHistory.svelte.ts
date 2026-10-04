export interface RunHistoryEntry {
  run_id: string;
  kind: 'single' | 'portfolio';
  label: string;
  created_at: string;
  tags?: string[];
  notes?: string;
  baseline?: boolean;
}

export const MAX_RUNS = 50;
export const HISTORY_KEY = 'openquant.runs.history';

function safeStorage(s?: Storage): Storage | null {
  if (s) return s;
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export class RunsHistory {
  entries = $state<RunHistoryEntry[]>([]);
  storageError = $state<string | null>(null);
  #storage: Storage | null;
  #key = HISTORY_KEY;
  #accountVersion = 0;
  #readFailed = false;
  #guestEntries: RunHistoryEntry[] = [];

  get accountVersion(): number {
    return this.#accountVersion;
  }

  constructor(storage?: Storage) {
    this.#storage = safeStorage(storage);
    this.#load();
  }

  #load(): void {
    this.entries = [];
    this.#readFailed = false;
    this.#guestEntries = [];
    try {
      const raw = this.#storage?.getItem(this.#key);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) throw new Error('Invalid notebook history');
      let pinned = false;
      this.entries = parsed
        .filter(
          (e): e is RunHistoryEntry =>
            e &&
            typeof e.run_id === 'string' &&
            typeof e.label === 'string' &&
            typeof e.created_at === 'string' &&
            (e.kind === 'single' || e.kind === 'portfolio'),
        )
        .slice(0, MAX_RUNS)
        .map(e => {
          const baseline =
            !pinned && e.kind === 'single' && e.baseline === true;
          if (baseline) pinned = true;
          return {
            ...e,
            tags: Array.isArray(e.tags)
              ? e.tags.filter(t => typeof t === 'string').slice(0, 12)
              : [],
            notes: typeof e.notes === 'string' ? e.notes.slice(0, 10000) : '',
            baseline,
          };
        });
      if (this.#key !== HISTORY_KEY && this.#storage) {
        this.#guestEntries = new RunsHistory(this.#storage).entries.filter(
          guest => !this.entries.some(entry => entry.run_id === guest.run_id),
        );
      }
    } catch {
      this.entries = [];
      this.#readFailed = true;
      this.storageError =
        'Notebook references could not be read. Existing browser data has not been overwritten; new changes remain in memory until storage is repaired.';
    }
  }

  #persist(): void {
    if (this.#readFailed) return;
    try {
      if (!this.#storage) throw new Error('Storage unavailable');
      this.#storage.setItem(this.#key, JSON.stringify(this.entries));
      this.storageError = null;
    } catch {
      this.storageError =
        'Browser storage is unavailable. Notebook changes last only until this page closes.';
    }
  }

  setAccount(id: string | null): void {
    const key = id
      ? `${HISTORY_KEY}:account:${encodeURIComponent(id)}`
      : HISTORY_KEY;
    if (key === this.#key) return;
    this.#accountVersion++;
    this.#key = key;
    this.storageError = null;
    this.#load();
  }

  get baseline(): RunHistoryEntry | null {
    return this.entries.find(e => e.baseline && e.kind === 'single') ?? null;
  }

  get guestReferenceCount(): number {
    const entries = this.entries;
    return this.#guestEntries.filter(
      guest => !entries.some(entry => entry.run_id === guest.run_id),
    ).length;
  }

  copyGuestReferences(): void {
    if (this.#key === HISTORY_KEY) return;
    this.entries = [
      ...this.entries,
      ...this.#guestEntries
        .filter(
          guest => !this.entries.some(entry => entry.run_id === guest.run_id),
        )
        .map(guest => ({ ...guest, baseline: false })),
    ].slice(0, MAX_RUNS);
    this.#persist();
  }

  annotate(id: string, label: string, tags: string, notes: string): void {
    this.entries = this.entries.map(e =>
      e.run_id === id
        ? {
            ...e,
            label: label.trim().slice(0, 120) || e.label,
            tags: [
              ...new Set(
                tags
                  .split(',')
                  .map(t => t.trim())
                  .filter(Boolean),
              ),
            ].slice(0, 12),
            notes: notes.slice(0, 10000),
          }
        : e,
    );
    this.#persist();
  }

  pin(id: string | null): void {
    this.entries = this.entries.map(e => ({
      ...e,
      baseline: e.kind === 'single' && e.run_id === id,
    }));
    this.#persist();
  }

  record(entry: RunHistoryEntry): void {
    const previous = this.entries.find(e => e.run_id === entry.run_id);
    const baseline = this.baseline;
    const next = [
      previous
        ? {
            ...entry,
            label: previous.label,
            tags: previous.tags,
            notes: previous.notes,
            baseline: previous.baseline,
          }
        : entry,
      ...this.entries.filter(e => e.run_id !== entry.run_id),
    ].slice(0, MAX_RUNS);
    if (baseline && !next.some(e => e.run_id === baseline.run_id))
      next[MAX_RUNS - 1] = baseline;
    this.entries = next;
    this.#persist();
  }

  remove(run_id: string): void {
    this.entries = this.entries.filter(e => e.run_id !== run_id);
    this.#persist();
  }
}

export const runsHistory = new RunsHistory();

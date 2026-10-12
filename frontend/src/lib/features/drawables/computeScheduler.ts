interface ComputeWork {
  key: string;
  /** Context/geometry/params/style identity, excluding candle publication. */
  cancelKey: string;
  run: (signal: AbortSignal) => unknown;
}

interface ActiveWork {
  work: ComputeWork;
  controller: AbortController;
}

interface Entry {
  key?: string;
  latest?: ComputeWork;
  active?: ActiveWork;
}

interface ComputeEvents {
  pending: (id: string, key: string) => void;
  success: (id: string, key: string, value: unknown) => void;
  error: (id: string, key: string, error: unknown) => void;
  removed: (id: string) => void;
}

/** One active computation and one replaceable latest work item per Element. */
export function createDrawableComputeScheduler(events: ComputeEvents) {
  const entries = new Map<string, Entry>();
  let destroyed = false;

  function launch(id: string, entry: Entry, work: ComputeWork) {
    const active = { work, controller: new AbortController() };
    entry.active = active;
    const settle = (value: unknown, failed: boolean, error?: unknown) => {
      if (destroyed || entries.get(id) !== entry || entry.active !== active)
        return;
      entry.active = undefined;
      if (entry.latest === work && !active.controller.signal.aborted) {
        entry.latest = undefined;
        if (failed) events.error(id, work.key, error);
        else events.success(id, work.key, value);
      } else if (entry.latest) {
        launch(id, entry, entry.latest);
      } else {
        entries.delete(id);
      }
    };
    try {
      const result = work.run(active.controller.signal);
      if (result instanceof Promise) {
        result.then(
          value => settle(value, false),
          error => settle(undefined, true, error),
        );
      } else {
        settle(result, false);
      }
    } catch (error) {
      settle(undefined, true, error);
    }
  }

  function remove(id: string, entry: Entry) {
    entry.key = undefined;
    entry.latest = undefined;
    entry.active?.controller.abort();
    if (!entry.active) entries.delete(id);
    events.removed(id);
  }

  return {
    submit(id: string, work: ComputeWork) {
      if (destroyed) return;
      let entry = entries.get(id);
      if (entry?.key === work.key) return;
      if (!entry) {
        entry = {};
        entries.set(id, entry);
      }
      entry.key = work.key;
      entry.latest = work;
      events.pending(id, work.key);
      if (entry.active) {
        if (entry.active.work.cancelKey !== work.cancelKey)
          entry.active.controller.abort();
      } else {
        launch(id, entry, work);
      }
    },
    retain(ids: ReadonlySet<string>) {
      for (const [id, entry] of entries) {
        if (!ids.has(id) && entry.key !== undefined) remove(id, entry);
      }
    },
    destroy() {
      destroyed = true;
      for (const [id, entry] of entries) remove(id, entry);
      entries.clear();
    },
  };
}

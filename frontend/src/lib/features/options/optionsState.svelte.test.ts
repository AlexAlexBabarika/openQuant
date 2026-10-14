import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiJson } from '$lib/core/api';
import { OptionsState, optionsErrors } from './optionsState.svelte';
import { createOptionsDraft } from './optionsTemplates';
import type { OptionsAnalysis, OptionsDraft } from './optionsTypes';
import {
  exportOptionsBundle,
  decodeOptionsStorage,
} from './optionsPersistence';

vi.mock('$lib/core/api', () => ({ apiJson: vi.fn() }));

function storage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: k => values.get(k) ?? null,
    setItem: (k, v) => {
      values.set(k, v);
    },
  } as Storage;
}
function response(draft = createOptionsDraft()): OptionsAnalysis {
  const greeks = { delta: 50, gamma: 0.1, theta: -1, vega: 3, rho: 0.2 };
  return {
    request: structuredClone(draft),
    model: {
      name: 'black_scholes_merton',
      version: '1',
      input_source: 'manual',
      exercise_style: 'european',
      settlement: 'cash',
      day_basis: 'ACT/365',
    },
    summary: {
      gross_entry_cost: 500,
      entry_fees: 0,
      net_entry_cost: 500,
      entry_debit: 500,
      entry_credit: 0,
      theoretical_value_today: 520,
      pnl_today: 20,
      max_profit: null,
      max_loss: 500,
      profit_unbounded: true,
      loss_unbounded: false,
      breakevens: [105],
      zero_intervals: [],
    },
    spot_grid: [...draft.spot_grid],
    today_pnl: draft.spot_grid.map(() => 20),
    expiry_pnl: draft.spot_grid.map(() => 0),
    scenarios: [],
    greeks,
    greeks_grid: draft.spot_grid.map(() => ({ ...greeks })),
    greek_units: {
      delta: 'USD per USD spot (equivalent shares)',
      gamma: 'delta per USD spot',
      theta: 'USD per calendar day elapsed',
      vega: 'USD per 1 volatility percentage point',
      rho: 'USD per 1 rate percentage point',
    },
    warnings: [
      'Manual inputs, not a provider snapshot or historical options execution.',
    ],
  };
}
function deferred() {
  let resolve!: (v: OptionsAnalysis) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<OptionsAnalysis>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('bounded options inputs', () => {
  it.each([
    [
      'zero quantity',
      (d: OptionsDraft) => {
        d.strategy.legs[0].quantity = 0;
      },
      'legs.0.quantity',
    ],
    [
      'fractional contracts',
      (d: OptionsDraft) => {
        d.strategy.legs[0].quantity = 0.5;
      },
      'legs.0.quantity',
    ],
    [
      'excess contracts',
      (d: OptionsDraft) => {
        d.strategy.legs[0].quantity = 10001;
      },
      'legs.0.quantity',
    ],
    [
      'empty strike',
      (d: OptionsDraft) => {
        d.strategy.legs[0].strike = null;
      },
      'legs.0.strike',
    ],
    [
      'nonfinite spot',
      (d: OptionsDraft) => {
        d.spot = NaN;
      },
      'spot',
    ],
    [
      'nonfinite premium',
      (d: OptionsDraft) => {
        d.strategy.legs[0].entry_premium = Infinity;
      },
      'legs.0.entry_premium',
    ],
    [
      'disabled invalid strike',
      (d: OptionsDraft) => {
        d.strategy.legs[0].enabled = false;
        d.strategy.legs[0].strike = -1;
      },
      'legs.0.strike',
    ],
    [
      'no active legs',
      (d: OptionsDraft) => {
        d.strategy.legs[0].enabled = false;
      },
      'legs',
    ],
    [
      'excess legs',
      (d: OptionsDraft) => {
        d.strategy.legs = Array.from({ length: 17 }, () => d.strategy.legs[0]);
      },
      'legs',
    ],
    [
      'negative fee',
      (d: OptionsDraft) => {
        d.strategy.entry_fee_per_contract = -1;
      },
      'strategy.entry_fee_per_contract',
    ],
    [
      'noninteger multiplier',
      (d: OptionsDraft) => {
        d.strategy.legs[0].multiplier = 1.5;
      },
      'legs.0.multiplier',
    ],
    [
      'stock multiplier',
      (d: OptionsDraft) => {
        d.strategy.legs[0].kind = 'underlying';
        d.strategy.legs[0].strike = null;
      },
      'legs.0.multiplier',
    ],
    [
      'unsorted grid',
      (d: OptionsDraft) => {
        d.spot_grid = [100, 99];
      },
      'spot_grid',
    ],
    [
      'repeated grid',
      (d: OptionsDraft) => {
        d.spot_grid = [100, 100];
      },
      'spot_grid',
    ],
    [
      'excess grid',
      (d: OptionsDraft) => {
        d.spot_grid = Array.from({ length: 202 }, (_, i) => i);
      },
      'spot_grid',
    ],
    [
      'cross expiry',
      (d: OptionsDraft) => {
        d.scenarios = [{ name: 'x', elapsed_days: 31, iv_shift_pp: 0 }];
      },
      'scenarios.0.elapsed_days',
    ],
    [
      'negative shifted IV',
      (d: OptionsDraft) => {
        d.scenarios = [{ name: 'x', elapsed_days: 0, iv_shift_pp: -21 }];
      },
      'scenarios.0.iv_shift_pp',
    ],
    [
      'duplicate scenario',
      (d: OptionsDraft) => {
        d.scenarios = [
          { name: 'x', elapsed_days: 0, iv_shift_pp: 0 },
          { name: 'x', elapsed_days: 1, iv_shift_pp: 0 },
        ];
      },
      'scenarios.1.name',
    ],
  ])('rejects %s', (_, update, key) => {
    const d = createOptionsDraft();
    update(d);
    expect(optionsErrors(d)[key]).toBeTruthy();
  });
  it('allows stock-only exposure, zero IV, expiry and negative rates', () => {
    const d = createOptionsDraft();
    d.strategy.legs = [
      {
        kind: 'underlying',
        quantity: -1000000,
        strike: null,
        entry_premium: 0,
        multiplier: 1,
        enabled: true,
      },
    ];
    d.strategy.days_to_expiry = 0;
    d.volatility = 0;
    d.rate = -1;
    d.dividend_yield = -1;
    d.scenarios = [{ name: 'Expiry', elapsed_days: 0, iv_shift_pp: 0 }];
    expect(optionsErrors(d)).toEqual({});
  });
});

describe('options explicit request lifecycle', () => {
  it('sends only bounded manual inputs with no auth, preserves returned context and marks edits stale', async () => {
    const analyze = vi.fn().mockResolvedValue(response());
    const s = new OptionsState(storage(), analyze);
    s.setAccount(null);
    expect(analyze).not.toHaveBeenCalled();
    await s.run();
    expect(analyze.mock.calls[0][0]).toBe('/options/analyze');
    expect(JSON.parse(analyze.mock.calls[0][1].body)).toEqual(
      createOptionsDraft(),
    );
    expect(s.stale).toBe(false);
    s.editDraft(d => {
      d.spot = 120;
    });
    expect(s.stale).toBe(true);
    expect(s.result?.request.spot).toBe(100);
    expect(s.result?.greeks_grid).toHaveLength(s.result!.spot_grid.length);
    expect(analyze).toHaveBeenCalledTimes(1);
  });
  it('uses the default apiJson without authentication arguments', async () => {
    vi.mocked(apiJson).mockResolvedValue(response());
    const s = new OptionsState(storage());
    s.setAccount(null);
    await s.run();
    expect(apiJson).toHaveBeenCalledWith(
      '/options/analyze',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(vi.mocked(apiJson).mock.calls[0]).toHaveLength(2);
  });
  it('retains inputs and old evidence after errors and retries only explicitly', async () => {
    const analyze = vi
      .fn()
      .mockResolvedValueOnce(response())
      .mockRejectedValueOnce(new Error('Worker rejected input'))
      .mockResolvedValueOnce(response());
    const s = new OptionsState(storage(), analyze);
    s.setAccount(null);
    await s.run();
    const evidence = s.result;
    s.editDraft(d => {
      d.strategy.name = 'My draft';
    });
    await s.run();
    expect(s.error).toBe('Worker rejected input');
    expect(s.draft.strategy.name).toBe('My draft');
    expect(s.result).toBe(evidence);
    expect(s.loading).toBe(false);
    expect(s.stale).toBe(true);
    await s.run();
    expect(s.error).toBeNull();
    expect(analyze).toHaveBeenCalledTimes(3);
  });
  it('rejects invalid inputs locally and preserves their entered values', async () => {
    const analyze = vi.fn();
    const s = new OptionsState(storage(), analyze);
    s.setAccount(null);
    s.editDraft(d => {
      d.strategy.legs[0].quantity = 0;
    });
    await s.run();
    expect(analyze).not.toHaveBeenCalled();
    expect(s.draft.strategy.legs[0].quantity).toBe(0);
    expect(s.fieldErrors['legs.0.quantity']).toContain('zero');
  });
  it('prevents duplicate submissions and aborts/discards completion after editing', async () => {
    const pending = deferred();
    const analyze = vi.fn().mockReturnValue(pending.promise);
    const s = new OptionsState(storage(), analyze);
    s.setAccount(null);
    const run = s.run();
    await s.run();
    expect(analyze).toHaveBeenCalledTimes(1);
    s.editDraft(d => {
      d.spot = 101;
    });
    expect(analyze.mock.calls[0][1].signal.aborted).toBe(true);
    pending.resolve(response());
    await run;
    expect(s.result).toBeNull();
    expect(s.loading).toBe(false);
  });
  it('does not let old success or error replace a newer run', async () => {
    for (const fail of [true, false]) {
      const old = deferred();
      const current = deferred();
      const analyze = vi
        .fn()
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(current.promise);
      const s = new OptionsState(storage(), analyze);
      s.setAccount(null);
      const first = s.run();
      s.cancel();
      const second = s.run();
      current.resolve(response());
      await second;
      if (fail) old.reject(new Error('Old failure'));
      else old.resolve({ ...response(), warnings: ['obsolete'] });
      await first;
      expect(s.error).toBeNull();
      expect(s.result?.warnings).not.toContain('obsolete');
    }
  });
  it('clears private results, sources, drafts and pending responses when accounts change', async () => {
    const pending = deferred();
    const analyze = vi.fn().mockReturnValue(pending.promise);
    const s = new OptionsState(storage(), analyze);
    s.setAccount('a');
    s.setSource('private source');
    s.save('Private');
    const run = s.run();
    s.setAccount('b');
    expect(s.saved).toEqual([]);
    expect(s.source).not.toContain('private source');
    pending.resolve(response());
    await run;
    expect(s.result).toBeNull();
    expect(s.submittedSource).toBeNull();
    s.setAccount('a');
    expect(s.saved[0].source).toBe('private source');
    expect(s.source).not.toContain('private source');
  });
  it('clears completed results on logout while keeping same-account edits on auth refresh', async () => {
    const s = new OptionsState(
      storage(),
      vi.fn().mockResolvedValue(response()),
    );
    s.setAccount('a');
    await s.run();
    s.editDraft(d => {
      d.spot = 110;
    });
    s.setAccount('a');
    expect(s.draft.spot).toBe(110);
    expect(s.result).not.toBeNull();
    s.setAccount(null);
    expect(s.result).toBeNull();
    expect(s.draft.spot).toBe(100);
  });
  it('keeps custom Python across editor changes/mode switches until explicit export', async () => {
    const analyze = vi.fn().mockResolvedValue(response());
    const s = new OptionsState(storage(), analyze);
    s.setAccount(null);
    s.setSource('result = analyze_options(custom_request)');
    s.setMode('python');
    s.setMode('editor');
    s.editDraft(d => {
      d.spot = 110;
    });
    expect(s.source).toBe('result = analyze_options(custom_request)');
    s.setMode('python');
    await s.run();
    expect(analyze.mock.calls[0][0]).toBe('/options/python');
    expect(JSON.parse(analyze.mock.calls[0][1].body)).toEqual({
      source: 'result = analyze_options(custom_request)',
    });
    expect(s.submittedSource).toBe('result = analyze_options(custom_request)');
    s.setSource('different source');
    expect(s.stale).toBe(true);
    expect(s.exportPython()).toBe(true);
    expect(s.source).toContain('"spot": 110');
  });
  it('rejects blank/oversize Python and invalid export without replacing custom code', async () => {
    const analyze = vi.fn();
    const s = new OptionsState(storage(), analyze);
    s.setAccount(null);
    s.setMode('python');
    for (const source of ['', 'x'.repeat(20001)]) {
      s.setSource(source);
      await s.run();
      expect(s.error).toContain('20,000');
    }
    expect(analyze).not.toHaveBeenCalled();
    s.setSource('custom');
    s.editDraft(d => {
      d.spot = NaN;
    });
    expect(s.exportPython()).toBe(false);
    expect(s.source).toBe('custom');
  });
  it('aborts timed-out requests and exposes retry without erasing inputs', async () => {
    vi.useFakeTimers();
    const analyze = vi.fn(
      (_path: string, init: RequestInit) =>
        new Promise<OptionsAnalysis>((_, reject) => {
          init.signal!.addEventListener('abort', () =>
            reject(new Error('AbortError')),
          );
        }),
    );
    const s = new OptionsState(storage(), analyze);
    s.setAccount(null);
    const run = s.run();
    await vi.advanceTimersByTimeAsync(15000);
    await run;
    expect(s.error).toContain('timed out');
    expect(s.loading).toBe(false);
    expect(s.draft).toEqual(createOptionsDraft());
  });
  it('discards completion on disposal', async () => {
    const pending = deferred();
    const s = new OptionsState(storage(), () => pending.promise);
    s.setAccount(null);
    const run = s.run();
    s.dispose();
    pending.resolve(response());
    await run;
    expect(s.result).toBeNull();
    expect(s.loading).toBe(false);
  });
});

describe('bounded account-scoped named drafts', () => {
  it('never adopts guest records and restores only after explicit action', () => {
    const db = storage();
    const s = new OptionsState(db);
    s.setAccount(null);
    s.editDraft(d => {
      d.spot = 123;
    });
    expect(s.save('Guest')).toBe(true);
    s.setAccount('a');
    expect(s.saved).toEqual([]);
    expect(s.draft.spot).toBe(100);
    s.save('A');
    s.setAccount('b');
    expect(s.saved).toEqual([]);
    s.setAccount(null);
    expect(s.saved[0].name).toBe('Guest');
    expect(s.draft.spot).toBe(100);
    s.restore(0);
    expect(s.draft.spot).toBe(123);
    expect(s.result).toBeNull();
    const reload = new OptionsState(db);
    reload.setAccount(null);
    expect(reload.saved).toHaveLength(1);
    expect(reload.draft.spot).toBe(100);
  });
  it('saves detached snapshots, never overwrites previous same-name records and bounds storage', () => {
    const s = new OptionsState(storage());
    s.setAccount('a');
    expect(s.save('Copy')).toBe(true);
    s.editDraft(d => {
      d.spot = 120;
    });
    expect(s.saved[0].draft.spot).toBe(100);
    for (let i = 1; i < 10; i++) expect(s.save('Copy')).toBe(true);
    expect(s.save('Overflow')).toBe(false);
    expect(s.storageError).toContain('10');
    expect(s.remove(0)).toBe(true);
    expect(s.saved).toHaveLength(9);
  });
  it('reports storage failures without claiming a save or losing current edits', () => {
    const db = storage();
    db.setItem = () => {
      throw new Error('Quota');
    };
    const s = new OptionsState(db);
    s.setAccount(null);
    s.editDraft(d => {
      d.spot = 120;
    });
    expect(s.save('Draft')).toBe(false);
    expect(s.saved).toEqual([]);
    expect(s.draft.spot).toBe(120);
    expect(s.storageError).toContain('not saved');
    const absent = new OptionsState(null);
    absent.setAccount(null);
    expect(absent.storageError).toContain('could not be read');
  });
  it.each([
    'broken json',
    '{"version":2,"drafts":[]}',
    '{"version":1,"drafts":[{}]}',
    'x'.repeat(300001),
  ])('does not overwrite unreadable/unsupported saved data', raw => {
    const db = storage();
    db.setItem('openquant.options.v1:guest', raw);
    const s = new OptionsState(db);
    s.setAccount(null);
    expect(s.storageError).toContain('unchanged');
    expect(s.save('New')).toBe(false);
    expect(db.getItem('openquant.options.v1:guest')).toBe(raw);
  });
  it('rejects invalid save names, request inputs and oversize source', () => {
    const s = new OptionsState(storage());
    s.setAccount(null);
    expect(s.save(' ')).toBe(false);
    expect(s.save('x'.repeat(121))).toBe(false);
    s.setSource('x'.repeat(20001));
    expect(s.save('Too long')).toBe(false);
    s.setSource('valid');
    s.editDraft(d => {
      d.spot = -1;
    });
    expect(s.save('Bad request')).toBe(false);
    expect(s.saved).toEqual([]);
  });
});

describe('editable history and explicit source document fencing', () => {
  it('undoes/redoes editor inputs only, keeping evidence and native Python history untouched', async () => {
    const s = new OptionsState(
      storage(),
      vi.fn().mockResolvedValue(response()),
    );
    s.setAccount('a');
    s.setSource('user-authored Python');
    const documentKey = s.documentKey;
    await s.run();
    const result = s.result;
    s.editDraft(d => (d.spot = 110));
    expect(s.canUndo).toBe(true);
    expect(s.canRedo).toBe(false);
    expect(s.stale).toBe(true);
    s.setMode('python');
    s.setMode('editor');
    expect(s.documentKey).toBe(documentKey);
    expect(s.undo()).toBe(true);
    expect(s.draft.spot).toBe(100);
    expect(s.canRedo).toBe(true);
    expect(s.redo()).toBe(true);
    expect(s.draft.spot).toBe(110);
    expect(s.result).toBe(result);
    expect(s.source).toBe('user-authored Python');
    expect(s.documentKey).toBe(documentKey);
    s.undo();
    s.editDraft(d => (d.spot = 120));
    expect(s.canRedo).toBe(false);
    expect(s.redo()).toBe(false);
    s.dispose();
  });
  it('bounds history to 50 drafts and clears it on account switches, not auth refresh', () => {
    const s = new OptionsState(storage());
    s.setAccount('a');
    for (let i = 0; i < 60; i++) s.editDraft(d => (d.spot = i + 101));
    let count = 0;
    while (s.undo()) count++;
    expect(count).toBe(50);
    expect(s.draft.spot).toBe(110);
    s.setAccount('a');
    expect(s.canRedo).toBe(true);
    s.setAccount('b');
    expect(s.canRedo).toBe(false);
    expect(s.canUndo).toBe(false);
    s.dispose();
  });
  it('increments documentKey for identical explicit replacements but not keystrokes/mode toggles', () => {
    const s = new OptionsState(storage());
    s.setAccount('a');
    let key = s.documentKey;
    s.setSource(s.source);
    s.setMode('python');
    s.setMode('editor');
    s.setAccount('a');
    expect(s.documentKey).toBe(key);
    expect(s.exportPython()).toBe(true);
    expect(s.documentKey).toBe(++key);
    expect(s.exportPython()).toBe(true);
    expect(s.documentKey).toBe(++key);
    s.save('Same');
    expect(s.restore(0)).toBe(true);
    expect(s.documentKey).toBe(++key);
    s.renameSaved(0, 'Renamed');
    expect(s.restore(0, 1)).toBe(true);
    expect(s.documentKey).toBe(++key);
    s.flushRecovery();
    s.recover();
    expect(s.documentKey).toBe(++key);
    const bundle = s.exportBundle();
    s.importBundle(bundle);
    expect(s.documentKey).toBe(key);
    s.importBundle(bundle, true);
    expect(s.documentKey).toBe(++key);
    s.setAccount('b');
    expect(s.documentKey).toBe(++key);
    s.dispose();
  });
  it('cancels a pending request when undoing and ignores obsolete success', async () => {
    const pending = deferred();
    const s = new OptionsState(storage(), () => pending.promise);
    s.setAccount(null);
    s.editDraft(d => (d.spot = 120));
    const run = s.run();
    expect(s.loading).toBe(true);
    s.undo();
    expect(s.loading).toBe(false);
    pending.resolve(response());
    await run;
    expect(s.result).toBeNull();
    s.dispose();
  });
});

describe('explicit working recovery and scoped migration', () => {
  it('debounces incomplete field/source saves, restores only explicitly and never persists results', async () => {
    vi.useFakeTimers();
    const db = storage();
    const set = vi.spyOn(db, 'setItem');
    const analyze = vi.fn().mockResolvedValue(response());
    const s = new OptionsState(db, analyze);
    s.setAccount('a');
    await s.run();
    s.editDraft(d => {
      d.spot = NaN;
      d.strategy.name = '';
      d.strategy.legs[0].strike = null;
    });
    s.setSource('# incomplete source');
    s.setMode('python');
    vi.advanceTimersByTime(499);
    expect(set).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(set).toHaveBeenCalledOnce();
    const raw = db.getItem('openquant.options.v2:account:a')!;
    expect(raw).not.toContain('today_pnl');
    expect(raw).not.toContain('greeks');
    const recovered = new OptionsState(db, analyze);
    recovered.setAccount('a');
    expect(recovered.draft.spot).toBe(100);
    expect(recovered.result).toBeNull();
    const key = recovered.documentKey;
    expect(recovered.recover()).toBe(true);
    expect(recovered.documentKey).toBe(key + 1);
    expect(recovered.draft.spot).toBeNaN();
    expect(recovered.draft.strategy.legs[0].strike).toBeNull();
    expect(recovered.source).toBe('# incomplete source');
    expect(recovered.mode).toBe('python');
    expect(analyze).toHaveBeenCalledTimes(1);
    recovered.dispose();
    s.dispose();
  });
  it('flushes pending recovery into the old scope, never adopts guest edits and clears pins/history/stdout', async () => {
    vi.useFakeTimers();
    const db = storage();
    const s = new OptionsState(
      db,
      vi.fn().mockResolvedValue({ ...response(), stdout: 'private stdout' }),
    );
    s.setAccount(null);
    s.setMode('python');
    s.setSource('private guest');
    await s.run();
    s.pin();
    s.editDraft(d => (d.spot = 123));
    s.setAccount('a');
    expect(s.source).not.toContain('private guest');
    expect(s.recovery).toBeNull();
    expect(s.saved).toEqual([]);
    expect(s.comparisons).toEqual([]);
    expect(s.stdout).toBeNull();
    expect(s.canUndo).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(db.getItem('openquant.options.v2:account:a')).toBeNull();
    expect(
      decodeOptionsStorage(db.getItem('openquant.options.v2:guest')!).recovery!
        .source,
    ).toBe('private guest');
    s.setAccount(null);
    expect(s.source).not.toContain('private guest');
    expect(s.recovery!.source).toBe('private guest');
    s.dispose();
  });
  it('discards working recovery without deleting named records or automatically resaving it', () => {
    vi.useFakeTimers();
    const db = storage();
    const s = new OptionsState(db);
    s.setAccount('a');
    s.save('Named');
    s.setSource('working');
    s.flushRecovery();
    expect(s.recovery).not.toBeNull();
    s.setSource('new unsaved');
    expect(s.discardRecovery()).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(s.recovery).toBeNull();
    expect(s.source).toBe('new unsaved');
    expect(s.saved).toHaveLength(1);
    const data = decodeOptionsStorage(
      db.getItem('openquant.options.v2:account:a')!,
    );
    expect(data.recovery).toBeNull();
    expect(data.drafts).toHaveLength(1);
    s.dispose();
  });
  it('retains matching-scope legacy records unchanged and lazily migrates writes to v2', () => {
    const db = storage();
    const legacy = JSON.stringify({
      version: 1,
      drafts: [
        {
          name: 'Legacy',
          updatedAt: '2026-01-01T00:00:00Z',
          draft: createOptionsDraft(),
          mode: 'python',
          source: 'legacy Python',
        },
      ],
    });
    db.setItem('openquant.options.v1:account:a', legacy);
    const s = new OptionsState(db);
    s.setAccount('a');
    expect(s.saved[0].source).toBe('legacy Python');
    expect(s.source).not.toBe('legacy Python');
    expect(s.renameSaved(0, 'Migrated')).toBe(true);
    expect(db.getItem('openquant.options.v1:account:a')).toBe(legacy);
    expect(
      decodeOptionsStorage(db.getItem('openquant.options.v2:account:a')!)
        .drafts[0].revisions![0].source,
    ).toBe('legacy Python');
    s.setAccount('b');
    expect(s.saved).toEqual([]);
    expect(s.recovery).toBeNull();
    s.dispose();
  });
  it('leaves corrupt v2 and quota-failed named/working records unchanged with retryable errors', () => {
    vi.useFakeTimers();
    const db = storage();
    const s = new OptionsState(db);
    s.setAccount(null);
    s.save('Existing');
    const previous = db.getItem('openquant.options.v2:guest');
    const write = db.setItem;
    db.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    s.editDraft(d => (d.spot = 120));
    vi.advanceTimersByTime(500);
    expect(s.storageError).toContain('full');
    expect(s.draft.spot).toBe(120);
    expect(s.saved[0].draft.spot).toBe(100);
    expect(db.getItem('openquant.options.v2:guest')).toBe(previous);
    expect(s.updateSaved(0)).toBe(false);
    expect(s.saved[0].revision).toBe(1);
    db.setItem = write;
    expect(s.flushRecovery()).toBe(true);
    expect(s.storageError).toBeNull();
    db.setItem(
      'openquant.options.v2:account:a',
      '{"version":2,"drafts":[{}],"recovery":null}',
    );
    s.setAccount('a');
    s.setSource('keep in memory');
    vi.advanceTimersByTime(500);
    expect(s.storageError).toContain('paused');
    expect(s.source).toBe('keep in memory');
    expect(db.getItem('openquant.options.v2:account:a')).toContain(
      '"drafts":[{}]',
    );
    s.dispose();
  });
});

describe('named revisions, validated additive imports and submitted exports', () => {
  it('updates detached snapshots, renames the saved source rather than current edits and restores exact revisions', () => {
    const s = new OptionsState(storage());
    s.setAccount('a');
    s.setSource('original Python');
    s.save('Original');
    s.setSource('new Python');
    s.editDraft(d => (d.spot = 110));
    expect(s.updateSaved(0)).toBe(true);
    s.setSource('unsaved Python');
    s.editDraft(d => (d.spot = 120));
    expect(s.renameSaved(0, 'Renamed')).toBe(true);
    expect(s.saved[0].source).toBe('new Python');
    expect(s.saved[0].draft.spot).toBe(110);
    expect(s.restore(0, 1)).toBe(true);
    expect(s.source).toBe('original Python');
    expect(s.draft.spot).toBe(100);
    expect(s.saved[0].name).toBe('Renamed');
    expect(s.saved[0].revision).toBe(3);
    for (let i = 0; i < 5; i++) s.updateSaved(0);
    expect(s.saved[0].revisions).toHaveLength(3);
    expect(s.restore(0, 1)).toBe(false);
    s.dispose();
  });
  it('imports source-preserving drafts additively, applies only explicitly, and never loses records after bad/capacity imports', () => {
    const analyze = vi.fn();
    const db = storage();
    const s = new OptionsState(db, analyze);
    s.setAccount('a');
    s.setSource('custom imported Python');
    s.setMode('python');
    s.save('Portable');
    const bundle = s.exportBundle();
    s.setSource('working source');
    const key = s.documentKey;
    expect(s.importBundle(bundle)).toBe(true);
    expect(s.saved).toHaveLength(2);
    expect(s.source).toBe('working source');
    expect(s.documentKey).toBe(key);
    expect(s.saved[0].id).not.toBe(s.saved[1].id);
    expect(s.importBundle(bundle, true)).toBe(true);
    expect(s.source).toBe('custom imported Python');
    expect(s.documentKey).toBe(key + 1);
    const raw = db.getItem('openquant.options.v2:account:a');
    for (const bad of [
      'broken',
      '{"format":"openquant-options-drafts","version":3,"drafts":[]}',
      exportOptionsBundle([{ ...s.saved[0], name: 'Valid' }]).replace(
        '"spot": 100',
        '"spot": -1',
      ),
    ]) {
      expect(s.importBundle(bad, true)).toBe(false);
      expect(s.saved).toHaveLength(3);
      expect(db.getItem('openquant.options.v2:account:a')).toBe(raw);
    }
    for (let i = 3; i < 10; i++) s.save('Another');
    const capped = db.getItem('openquant.options.v2:account:a');
    expect(s.importBundle(bundle)).toBe(false);
    expect(s.saved).toHaveLength(10);
    expect(db.getItem('openquant.options.v2:account:a')).toBe(capped);
    expect(analyze).not.toHaveBeenCalled();
    s.dispose();
  });
  it('exports current authored source separately from older canonical submitted report/CSV/source/stdout', async () => {
    const canonical = response();
    canonical.request.strategy.underlying = '=PRIVATE()';
    canonical.expiry_curve = [
      { spot: 50, pnl: -500 },
      { spot: 100, pnl: -500 },
      { spot: 105, pnl: 0 },
      { spot: 150, pnl: 4500 },
    ];
    const s = new OptionsState(
      storage(),
      vi.fn().mockResolvedValue({ ...canonical, stdout: 'submitted stdout' }),
    );
    s.setAccount('a');
    s.setSource('submitted Python');
    s.setMode('python');
    await s.run();
    expect(s.stdout).toBe('submitted stdout');
    s.setSource('working Python');
    s.editDraft(d => (d.spot = 200));
    expect(s.exportSource()).toBe('working Python');
    const report = JSON.parse(s.exportReport()!);
    expect(report.submittedSource).toBe('submitted Python');
    expect(report.stdout).toBe('submitted stdout');
    expect(report.result.request.spot).toBe(100);
    expect(report.result.expiry_curve).toEqual(canonical.expiry_curve);
    const csv = s.exportCsv()!;
    expect(csv).toContain('request.strategy.underlying');
    expect(csv).toContain('""=PRIVATE()');
    expect(csv).toContain('expiry_curve.2.spot');
    s.setAccount('b');
    expect(s.exportCsv()).toBeNull();
    expect(s.exportReport()).toBeNull();
    expect(s.stdout).toBeNull();
    s.dispose();
  });
  it('preserves old evidence as stale after identical restore/recovery and never runs a saved Python draft', async () => {
    const analyze = vi.fn().mockResolvedValue(response());
    const s = new OptionsState(storage(), analyze);
    s.setAccount('a');
    await s.run();
    s.save('Identical');
    expect(s.stale).toBe(false);
    s.restore(0);
    expect(s.stale).toBe(true);
    expect(s.result).not.toBeNull();
    s.flushRecovery();
    s.recover();
    expect(s.stale).toBe(true);
    expect(analyze).toHaveBeenCalledOnce();
    s.dispose();
  });
});

describe('session-only immutable canonical comparison pins', () => {
  it('pins submitted assumptions/source rather than current edits without mutating current result', async () => {
    const r = response();
    r.expiry_curve = [
      { spot: 50, pnl: -500 },
      { spot: 105, pnl: 0 },
      { spot: 150, pnl: 4500 },
    ];
    r.greeks.theta = null;
    const db = storage();
    const s = new OptionsState(db, vi.fn().mockResolvedValue(r));
    s.setAccount('a');
    expect(s.pin()).toBe(false);
    await s.run();
    const result = s.result;
    s.editDraft(d => (d.spot = 120));
    expect(s.pin()).toBe(true);
    expect(s.result).toBe(result);
    expect(s.draft.spot).toBe(120);
    const pinned = s.comparisons[0];
    expect(pinned.result.request.spot).toBe(100);
    expect(pinned.result.greeks.theta).toBeNull();
    expect(Object.isFrozen(pinned.result.request.strategy.legs[0])).toBe(true);
    expect(() => {
      pinned.result.request.spot = 200;
    }).toThrow();
    s.result!.request.spot = 300;
    expect(pinned.result.request.spot).toBe(100);
    expect(s.pin()).toBe(true);
    expect(s.pin()).toBe(true);
    expect(s.pin()).toBe(false);
    expect(s.comparisons).toHaveLength(3);
    s.unpin(pinned.id);
    expect(s.comparisons).toHaveLength(2);
    s.flushRecovery();
    expect(db.getItem('openquant.options.v2:account:a')).not.toContain(
      'options-pin',
    );
    const reload = new OptionsState(db);
    reload.setAccount('a');
    expect(reload.comparisons).toEqual([]);
    s.setAccount('b');
    expect(s.comparisons).toEqual([]);
    s.dispose();
    reload.dispose();
  });
});

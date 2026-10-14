import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiJson } from '$lib/core/api';
import { OptionsState, optionsErrors } from './optionsState.svelte';
import { createOptionsDraft } from './optionsTemplates';
import type { OptionsAnalysis, OptionsDraft } from './optionsTypes';

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

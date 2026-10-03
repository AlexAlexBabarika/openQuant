import { describe, it, expect, vi } from 'vitest';
import { StrategyState, SEED_CODE } from './strategyState.svelte';
import type {
  BacktestRunResponse,
  StrategyClient,
  StrategyInfo,
} from './strategies';

function info(over: Partial<StrategyInfo> = {}): StrategyInfo {
  return {
    id: 's1',
    name: 'My strategy',
    code: 'params = {}\n\ndef on_bar(ctx):\n    pass\n',
    created_at: '2026-06-10T00:00:00Z',
    updated_at: '2026-06-10T00:00:00Z',
    ...over,
  };
}

function okRun(over: Partial<BacktestRunResponse> = {}): BacktestRunResponse {
  return {
    status: 'ok',
    meta: {},
    bars: [],
    orders: [],
    fills: [],
    equity: [],
    trades: [],
    metrics: {},
    stdout: '',
    stderr: '',
    elapsed_ms: 1,
    ...over,
  } as BacktestRunResponse;
}

function fakeClient(over: Partial<StrategyClient> = {}): StrategyClient {
  return {
    list: vi.fn(async () => [info()]),
    create: vi.fn(async (name: string, code: string) =>
      info({ id: 'new1', name, code }),
    ),
    update: vi.fn(async (id: string, patch) => info({ id, ...patch })),
    remove: vi.fn(async () => undefined),
    runBacktest: vi.fn(async () => okRun()),
    ...over,
  };
}

const CTX = {
  symbol: 'TEST',
  provider: 'yfinance',
  period: '1y',
  interval: '1d',
} as const;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('strategy account changes', () => {
  it('detaches saved resources while retaining unsaved editor work', () => {
    const state = new StrategyState(fakeClient());
    state.scripts = [info()];
    state.select('s1');
    state.setCode('draft work');
    state.clearSaved();
    expect(state.scripts).toEqual([]);
    expect(state.activeId).toBeNull();
    expect(state.draftCode).toBe('draft work');
    expect(state.dirty).toBe(true);
  });

  it('ignores a saved list arriving after the account changes', async () => {
    const pending = deferred<StrategyInfo[]>();
    const state = new StrategyState(
      fakeClient({ list: () => pending.promise }),
    );
    const loading = state.load();
    state.clearSaved();
    pending.resolve([info()]);
    await loading;
    expect(state.scripts).toEqual([]);
    expect(state.loading).toBe(false);
  });

  it('ignores a save arriving after the account changes', async () => {
    const pending = deferred<StrategyInfo>();
    const state = new StrategyState(
      fakeClient({ create: () => pending.promise }),
    );
    const saving = state.save();
    state.clearSaved();
    pending.resolve(info());
    expect(await saving).toBeNull();
    expect(state.scripts).toEqual([]);
    expect(state.activeId).toBeNull();
    expect(state.isSaving).toBe(false);
  });
});

describe('StrategyState', () => {
  it('ships a parameterized seed strategy as the initial draft', () => {
    const state = new StrategyState(fakeClient());
    expect(state.draftCode).toBe(SEED_CODE);
    expect(SEED_CODE).toContain('params = {');
    expect(SEED_CODE).toContain('def on_bar(ctx):');
  });

  it('load() populates scripts; failure records loadError', async () => {
    const state = new StrategyState(fakeClient());
    await state.load();
    expect(state.scripts).toHaveLength(1);
    expect(state.loadError).toBeNull();

    const failing = new StrategyState(
      fakeClient({
        list: vi.fn(async () => {
          throw new Error('nope');
        }),
      }),
    );
    await failing.load();
    expect(failing.loadError).toBe('nope');
  });

  it('select() copies the saved strategy into the draft', async () => {
    const state = new StrategyState(fakeClient());
    await state.load();
    state.select('s1');
    expect(state.activeId).toBe('s1');
    expect(state.draftName).toBe('My strategy');
    expect(state.draftCode).toContain('on_bar');
    expect(state.dirty).toBe(false);
  });

  it('setCode/setName mark the draft dirty', () => {
    const state = new StrategyState(fakeClient());
    state.setCode('changed');
    expect(state.dirty).toBe(true);
    expect(state.draftCode).toBe('changed');
  });

  it('save() creates when no active id, updates when active', async () => {
    const client = fakeClient();
    const state = new StrategyState(client);
    state.setName('Fresh');
    const created = await state.save();
    expect(client.create).toHaveBeenCalledWith('Fresh', state.draftCode);
    expect(created?.id).toBe('new1');
    expect(state.activeId).toBe('new1');
    expect(state.dirty).toBe(false);

    state.setCode('v2');
    await state.save();
    expect(client.update).toHaveBeenCalledWith('new1', {
      name: 'Fresh',
      code: 'v2',
    });
  });

  it('save() without a name records saveError', async () => {
    const client = fakeClient();
    const state = new StrategyState(client);
    state.setName('   ');
    const saved = await state.save();
    expect(saved).toBeNull();
    expect(state.saveError).toBe('Name is required');
    expect(client.create).not.toHaveBeenCalled();
  });

  it('keeps edits made while creating a strategy dirty and updates the created id next time', async () => {
    const pending = deferred<StrategyInfo>();
    const client = fakeClient({ create: vi.fn(() => pending.promise) });
    const state = new StrategyState(client);
    state.setCode('submitted');
    const saving = state.save();
    state.setCode('newer code');
    state.setName('newer name');
    pending.resolve(info({ id: 'new1', code: 'submitted' }));
    await saving;
    expect(state.activeId).toBe('new1');
    expect(state.draftCode).toBe('newer code');
    expect(state.draftName).toBe('newer name');
    expect(state.dirty).toBe(true);
    await state.save();
    expect(client.update).toHaveBeenCalledWith('new1', {
      name: 'newer name',
      code: 'newer code',
    });
  });

  it('does not steal selection or clear a newer draft after a delayed save', async () => {
    const pending = deferred<StrategyInfo>();
    const state = new StrategyState(
      fakeClient({ update: vi.fn(() => pending.promise) }),
    );
    state.scripts = [info(), info({ id: 's2', code: 'second' })];
    state.select('s1');
    state.setCode('submitted');
    const saving = state.save();
    state.select('s2', () => true);
    state.setCode('second edited');
    pending.resolve(info({ code: 'submitted' }));
    await saving;
    expect(state.activeId).toBe('s2');
    expect(state.draftCode).toBe('second edited');
    expect(state.dirty).toBe(true);
    expect(state.scripts.find(s => s.id === 's1')?.code).toBe('submitted');
  });

  it('ignores a save completion after resetting to a new draft, even with identical text', async () => {
    const pending = deferred<StrategyInfo>();
    const state = new StrategyState(
      fakeClient({ create: vi.fn(() => pending.promise) }),
    );
    const saving = state.save();
    state.newDraft();
    pending.resolve(info());
    await saving;
    expect(state.activeId).toBeNull();
    expect(state.draftCode).toBe(SEED_CODE);
  });

  it('does not duplicate creates from repeated save shortcuts', async () => {
    const pending = deferred<StrategyInfo>();
    const client = fakeClient({ create: vi.fn(() => pending.promise) });
    const state = new StrategyState(client);
    const first = state.save();
    expect(await state.save()).toBeNull();
    expect(state.isSaving).toBe(true);
    expect(client.create).toHaveBeenCalledTimes(1);
    pending.resolve(info());
    await first;
  });

  it('does not show a previous draft save failure in the current draft', async () => {
    const pending = deferred<StrategyInfo>();
    const state = new StrategyState(
      fakeClient({ create: vi.fn(() => pending.promise) }),
    );
    const saving = state.save();
    state.newDraft();
    pending.reject(new Error('old save failed'));
    expect(await saving).toBeNull();
    expect(state.saveError).toBeNull();
  });

  it('protects the earlier source reopened before an in-flight update finishes', async () => {
    const pending = deferred<StrategyInfo>();
    const state = new StrategyState(
      fakeClient({ update: vi.fn(() => pending.promise) }),
    );
    state.scripts = [info({ code: 'original' }), info({ id: 's2' })];
    state.select('s1');
    state.setCode('submitted');
    const saving = state.save();
    state.select('s2', () => true);
    state.select('s1');
    pending.resolve(info({ code: 'submitted' }));
    await saving;
    expect(state.draftCode).toBe('original');
    expect(state.dirty).toBe(true);
  });

  it('requires confirmation before replacing dirty drafts and preserves same-id edits', () => {
    const state = new StrategyState(fakeClient());
    state.scripts = [info(), info({ id: 's2' })];
    state.select('s1');
    state.setCode('unsaved');
    const cancel = vi.fn(() => false);
    state.select('s1', cancel);
    expect(cancel).not.toHaveBeenCalled();
    state.select('s2', cancel);
    state.newDraft(cancel);
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(state.activeId).toBe('s1');
    expect(state.draftCode).toBe('unsaved');
    state.select('s2', () => true);
    expect(state.activeId).toBe('s2');
  });

  it('preserves edits made while deleting the active strategy as an unsaved draft', async () => {
    const pending = deferred<void>();
    const state = new StrategyState(
      fakeClient({ remove: vi.fn(() => pending.promise) }),
    );
    state.scripts = [info()];
    state.select('s1');
    const removing = state.remove('s1');
    state.setCode('typed during delete');
    pending.resolve();
    await removing;
    expect(state.scripts).toHaveLength(0);
    expect(state.activeId).toBeNull();
    expect(state.draftCode).toBe('typed during delete');
    expect(state.dirty).toBe(true);
  });

  it('prevents conflicting saves and deletes of the same strategy', async () => {
    const saving = deferred<StrategyInfo>();
    const deleting = deferred<void>();
    const client = fakeClient({
      update: vi.fn(() => saving.promise),
      remove: vi.fn(() => deleting.promise),
    });
    const state = new StrategyState(client);
    state.scripts = [info()];
    state.select('s1');
    const save = state.save();
    await expect(state.remove('s1')).rejects.toThrow('save');
    expect(client.remove).not.toHaveBeenCalled();
    saving.resolve(info());
    await save;
    const remove = state.remove('s1');
    expect(await state.save()).toBeNull();
    expect(state.saveError).toContain('delet');
    deleting.resolve();
    await remove;
  });

  it('does not let an old list response erase a newly saved strategy', async () => {
    const pending = deferred<StrategyInfo[]>();
    const state = new StrategyState(
      fakeClient({ list: vi.fn(() => pending.promise) }),
    );
    const loading = state.load();
    await state.save();
    pending.resolve([]);
    await loading;
    expect(state.scripts.map(s => s.id)).toEqual(['new1']);
  });

  it('remove() deletes and resets the draft when it was active', async () => {
    const client = fakeClient();
    const state = new StrategyState(client);
    await state.load();
    state.select('s1');
    await state.remove('s1');
    expect(client.remove).toHaveBeenCalledWith('s1');
    expect(state.scripts).toHaveLength(0);
    expect(state.activeId).toBeNull();
    expect(state.draftCode).toBe(SEED_CODE);
  });

  it('runBacktest() loads the canonical blob into a fresh BacktestState', async () => {
    const client = fakeClient();
    const state = new StrategyState(client);
    state.setCode('params = {}\n\ndef on_bar(ctx):\n    ctx.buy(1)\n');
    const bt = await state.runBacktest(CTX);
    expect(client.runBacktest).toHaveBeenCalledWith({
      code: state.draftCode,
      ...CTX,
    });
    expect(bt).toBe(state.backtest);
    expect(state.backtest?.result).not.toBeNull();
    expect(state.isRunning).toBe(false);
    expect(state.runError).toBeNull();
  });

  it('runBacktest() surfaces a failed run via runError', async () => {
    const client = fakeClient({
      runBacktest: vi.fn(async () =>
        okRun({ status: 'error', stderr: 'NameError: boom' }),
      ),
    });
    const state = new StrategyState(client);
    await state.runBacktest(CTX);
    expect(state.runError).toContain('NameError: boom');
    expect(state.isRunning).toBe(false);
  });

  it('does not let a superseded backtest clear the current loading state or error', async () => {
    const old = deferred<BacktestRunResponse>();
    const latest = deferred<BacktestRunResponse>();
    const client = fakeClient({
      runBacktest: vi
        .fn()
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(latest.promise),
    });
    const state = new StrategyState(client);
    const first = state.runBacktest(CTX);
    const second = state.runBacktest({ ...CTX, symbol: 'NEW' });
    old.resolve(okRun({ status: 'error', stderr: 'old failure' }));
    await first;
    expect(state.isRunning).toBe(true);
    expect(state.runError).toBeNull();
    latest.resolve(okRun());
    const bt = await second;
    expect(state.backtest).toBe(bt);
    expect(state.isRunning).toBe(false);
    expect(state.runError).toBeNull();
  });

  it('does not clear the latest failed backtest error when an older run finishes', async () => {
    const old = deferred<BacktestRunResponse>();
    const client = fakeClient({
      runBacktest: vi
        .fn()
        .mockReturnValueOnce(old.promise)
        .mockResolvedValueOnce(
          okRun({ status: 'error', stderr: 'latest failure' }),
        ),
    });
    const state = new StrategyState(client);
    const first = state.runBacktest(CTX);
    await state.runBacktest(CTX);
    old.resolve(okRun());
    await first;
    expect(state.runError).toBe('latest failure');
  });
});

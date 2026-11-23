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
});

describe('StrategyState', () => {
  it('ships a parameterized seed strategy as the initial draft', () => {
    const state = new StrategyState(fakeClient());
    expect(state.draftCode).toBe(SEED_CODE);
    expect(SEED_CODE).toContain('params = {');
    expect(SEED_CODE).toContain('def on_bar(ctx):');
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
    expect(client.runBacktest).toHaveBeenCalledWith(
      {
        code: state.draftCode,
        ...CTX,
      },
      expect.any(Function),
    );
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

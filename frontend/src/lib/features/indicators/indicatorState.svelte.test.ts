import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IndicatorState } from './indicatorState.svelte';
import {
  createScript,
  deleteScript,
  executeScript,
  listScripts,
  updateScript,
  type RunResult,
  type ScriptInfo,
} from './scripts';

vi.mock('./scripts', () => ({
  createScript: vi.fn(),
  deleteScript: vi.fn(),
  executeScript: vi.fn(),
  listScripts: vi.fn(),
  updateScript: vi.fn(),
}));

function info(over: Partial<ScriptInfo> = {}): ScriptInfo {
  return {
    id: 's1',
    name: 'First',
    code: 'saved code',
    created_at: '2026-06-10T00:00:00Z',
    updated_at: '2026-06-10T00:00:00Z',
    ...over,
  };
}

function result(stdout = ''): RunResult {
  return { status: 'ok', outputs: [], stdout, stderr: '', elapsed_ms: 1 };
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

const CTX = {
  symbol: 'TEST',
  provider: 'yfinance',
  period: '1y',
  interval: '1d',
} as const;

describe('indicator account changes', () => {
  it('detaches saved scripts and stops runners while retaining editor work', async () => {
    const state = new IndicatorState();
    state.scripts = [info()];
    state.select('s1');
    state.setCode('draft work');
    await state.run(CTX);
    state.clearSaved();
    expect(state.scripts).toEqual([]);
    expect(state.runners).toEqual({});
    expect(state.activeId).toBeNull();
    expect(state.draftCode).toBe('draft work');
    expect(state.dirty).toBe(true);
  });

  it('does not start a saved runner if the account changed during save', async () => {
    const pending = deferred<ScriptInfo>();
    vi.mocked(createScript).mockReturnValue(pending.promise);
    const state = new IndicatorState();
    const saving = state.saveAndRun(CTX);
    state.clearSaved();
    pending.resolve(info());
    expect(await saving).toBeNull();
    expect(executeScript).not.toHaveBeenCalled();
    expect(state.scripts).toEqual([]);
    expect(state.activeId).toBeNull();
    expect(state.isSaving).toBe(false);
  });
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(createScript).mockImplementation(async (name, code) =>
    info({ id: 'new1', name, code }),
  );
  vi.mocked(updateScript).mockImplementation(async (id, patch) =>
    info({ id, ...patch }),
  );
  vi.mocked(deleteScript).mockResolvedValue(undefined);
  vi.mocked(listScripts).mockResolvedValue([info()]);
  vi.mocked(executeScript).mockResolvedValue(result());
});

describe('IndicatorState persistence', () => {
  it('keeps edits typed during create dirty and updates the created id on the next save', async () => {
    const pending = deferred<ScriptInfo>();
    vi.mocked(createScript).mockReturnValue(pending.promise);
    const state = new IndicatorState();
    state.setCode('submitted');
    const saving = state.save();
    state.setCode('newer code');
    state.setName('newer name');
    pending.resolve(info({ id: 'new1', code: 'submitted' }));
    await saving;
    expect(state.activeId).toBe('new1');
    expect(state.dirty).toBe(true);
    expect(state.draftCode).toBe('newer code');
    expect(state.draftName).toBe('newer name');
    await state.save();
    expect(updateScript).toHaveBeenCalledWith('new1', {
      name: 'newer name',
      code: 'newer code',
    });
  });

  it('preserves the active draft and runner if deletion fails', async () => {
    vi.mocked(deleteScript).mockRejectedValue(new Error('delete failed'));
    const state = new IndicatorState();
    state.scripts = [info()];
    state.select('s1');
    await state.run(CTX);
    await expect(state.remove('s1')).rejects.toThrow('delete failed');
    expect(state.activeId).toBe('s1');
    expect(state.runners.s1.lastResult).toEqual(result());
  });

  it('save-and-run executes the saved script, not the script selected during the save', async () => {
    const pending = deferred<ScriptInfo>();
    vi.mocked(updateScript).mockReturnValue(pending.promise);
    const state = new IndicatorState();
    state.scripts = [info(), info({ id: 's2' })];
    state.select('s1');
    state.setCode('submitted');
    const running = state.saveAndRun(CTX);
    state.select('s2', () => true);
    pending.resolve(info({ code: 'submitted' }));
    await running;
    expect(executeScript).toHaveBeenCalledWith(
      { ...CTX, script_id: 's1' },
      expect.any(AbortSignal),
    );
    expect(state.activeId).toBe('s2');
  });
});

describe('IndicatorState execution', () => {
  it('ignores a superseded result even when the transport resolves after abort', async () => {
    const old = deferred<RunResult>();
    const latest = deferred<RunResult>();
    vi.mocked(executeScript)
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(latest.promise);
    const state = new IndicatorState();
    state.scripts = [info()];
    state.select('s1');
    const first = state.run(CTX);
    const second = state.run({ ...CTX, symbol: 'NEW' });
    expect(vi.mocked(executeScript).mock.calls[0][1]?.aborted).toBe(true);
    old.resolve(result('old'));
    expect(await first).toBeNull();
    expect(state.runners.s1.isRunning).toBe(true);
    expect(state.runners.s1.lastResult).toBeNull();
    latest.resolve(result('latest'));
    await second;
    expect(state.runners.s1.lastResult?.stdout).toBe('latest');
  });

  it('does not overwrite a finished newer run with a delayed older result', async () => {
    const old = deferred<RunResult>();
    vi.mocked(executeScript)
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(result('latest'));
    const state = new IndicatorState();
    const first = state.run(CTX);
    await state.run(CTX);
    old.resolve(result('old'));
    expect(await first).toBeNull();
    expect(state.lastResult?.stdout).toBe('latest');
  });

  it('does not apply a stopped run to a restarted runner', async () => {
    const old = deferred<RunResult>();
    vi.mocked(executeScript)
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(result('restarted'));
    const state = new IndicatorState();
    const first = state.start('s1', CTX);
    state.stop('s1');
    await state.start('s1', CTX);
    old.resolve(result('stopped'));
    expect(await first).toBeNull();
    expect(state.runners.s1.lastResult?.stdout).toBe('restarted');
  });

  it('contains delayed aborted rejection without changing the current runner', async () => {
    const old = deferred<RunResult>();
    vi.mocked(executeScript)
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(result('latest'));
    const state = new IndicatorState();
    const first = state.start('s1', CTX);
    await state.start('s1', CTX);
    old.reject(new Error('aborted transport'));
    expect(await first).toBeNull();
    expect(state.runners.s1.runError).toBeNull();
    expect(state.runners.s1.lastResult?.stdout).toBe('latest');
  });

  it('clears the previous draft runner when starting a new draft', async () => {
    const old = deferred<RunResult>();
    vi.mocked(executeScript).mockReturnValue(old.promise);
    const state = new IndicatorState();
    const first = state.run(CTX);
    state.newDraft();
    old.resolve(result('previous draft'));
    expect(await first).toBeNull();
    expect(state.lastResult).toBeNull();
    expect(state.isRunning).toBe(false);
  });

  it('executes unsaved editor code without modifying the saved source', async () => {
    const state = new IndicatorState();
    state.scripts = [info()];
    state.select('s1');
    state.setCode('unsaved code');
    await state.run(CTX);
    expect(executeScript).toHaveBeenCalledWith(
      { ...CTX, code: 'unsaved code' },
      expect.any(AbortSignal),
    );
    expect(state.scripts[0].code).toBe('saved code');
    expect(state.dirty).toBe(true);
  });
});

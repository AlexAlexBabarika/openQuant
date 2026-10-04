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
    state.openScript('s1');
    state.setCode('draft work');
    await state.run(CTX);
    state.clearSaved();
    expect(state.scripts).toEqual([]);
    expect(state.runners).toEqual({});
    expect(state.activeId).toBeNull();
    expect(state.draftCode).toBe('draft work');
    expect(state.dirty).toBe(true);
  });

  it('ignores a saved list arriving after the account changes', async () => {
    const pending = deferred<ScriptInfo[]>();
    vi.mocked(listScripts).mockReturnValue(pending.promise);
    const state = new IndicatorState();
    const loading = state.refresh();
    state.clearSaved();
    pending.resolve([info()]);
    await loading;
    expect(state.scripts).toEqual([]);
    expect(state.loading).toBe(false);
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

  it('does not steal selection or clear newer edits when a save resolves', async () => {
    const pending = deferred<ScriptInfo>();
    vi.mocked(updateScript).mockReturnValue(pending.promise);
    const state = new IndicatorState();
    state.scripts = [info(), info({ id: 's2' })];
    state.openScript('s1');
    state.setCode('submitted');
    const saving = state.save();
    state.openScript('s2', () => true);
    state.setCode('second edited');
    pending.resolve(info({ code: 'submitted' }));
    await saving;
    expect(state.activeId).toBe('s2');
    expect(state.draftCode).toBe('second edited');
    expect(state.dirty).toBe(true);
    expect(state.scripts.find(s => s.id === 's1')?.code).toBe('submitted');
  });

  it('does not attach an old create to an identical new draft', async () => {
    const pending = deferred<ScriptInfo>();
    vi.mocked(createScript).mockReturnValue(pending.promise);
    const state = new IndicatorState();
    const code = state.draftCode;
    const saving = state.save();
    state.newDraft();
    pending.resolve(info());
    await saving;
    expect(state.activeId).toBeNull();
    expect(state.draftCode).toBe(code);
  });

  it('protects the earlier source reopened before an in-flight update finishes', async () => {
    const pending = deferred<ScriptInfo>();
    vi.mocked(updateScript).mockReturnValue(pending.promise);
    const state = new IndicatorState();
    state.scripts = [info({ code: 'original' }), info({ id: 's2' })];
    state.openScript('s1');
    state.setCode('submitted');
    const saving = state.save();
    state.openScript('s2', () => true);
    state.openScript('s1');
    pending.resolve(info({ code: 'submitted' }));
    await saving;
    expect(state.draftCode).toBe('original');
    expect(state.dirty).toBe(true);
  });

  it('does not duplicate creates from repeated save shortcuts', async () => {
    const pending = deferred<ScriptInfo>();
    vi.mocked(createScript).mockReturnValue(pending.promise);
    const state = new IndicatorState();
    const first = state.save();
    expect(await state.save()).toBeNull();
    expect(state.isSaving).toBe(true);
    expect(createScript).toHaveBeenCalledTimes(1);
    pending.resolve(info());
    await first;
  });

  it('contains save errors and does not display a previous draft error on a new draft', async () => {
    const pending = deferred<ScriptInfo>();
    vi.mocked(createScript).mockReturnValue(pending.promise);
    const state = new IndicatorState();
    const saving = state.save();
    state.newDraft();
    pending.reject(new Error('old save failed'));
    expect(await saving).toBeNull();
    expect(state.saveError).toBeNull();
    state.setName('');
    expect(await state.save()).toBeNull();
    expect(state.saveError).toBe('Name is required');
  });

  it('requires confirmation before switching or resetting dirty drafts and ignores same-id clicks', () => {
    const state = new IndicatorState();
    state.scripts = [info(), info({ id: 's2' })];
    state.openScript('s1');
    state.setCode('unsaved');
    const cancel = vi.fn(() => false);
    state.openScript('s1', cancel);
    expect(cancel).not.toHaveBeenCalled();
    state.openScript('s2', cancel);
    state.newDraft(cancel);
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(state.activeId).toBe('s1');
    expect(state.draftCode).toBe('unsaved');
    state.openScript('s2', () => true);
    expect(state.activeId).toBe('s2');
  });

  it('keeps text typed while deleting as a new unsaved draft', async () => {
    const pending = deferred<void>();
    vi.mocked(deleteScript).mockReturnValue(pending.promise);
    const state = new IndicatorState();
    state.scripts = [info()];
    state.openScript('s1');
    const deleting = state.delete('s1');
    state.setCode('typed during delete');
    pending.resolve();
    await deleting;
    expect(state.scripts).toHaveLength(0);
    expect(state.activeId).toBeNull();
    expect(state.draftCode).toBe('typed during delete');
    expect(state.dirty).toBe(true);
  });

  it('prevents conflicting saves and deletes', async () => {
    const saving = deferred<ScriptInfo>();
    const deleting = deferred<void>();
    vi.mocked(updateScript).mockReturnValue(saving.promise);
    vi.mocked(deleteScript).mockReturnValue(deleting.promise);
    const state = new IndicatorState();
    state.scripts = [info()];
    state.openScript('s1');
    const save = state.save();
    await expect(state.delete('s1')).rejects.toThrow('save');
    expect(deleteScript).not.toHaveBeenCalled();
    saving.resolve(info());
    await save;
    const remove = state.delete('s1');
    expect(await state.save()).toBeNull();
    expect(state.saveError).toContain('delet');
    deleting.resolve();
    await remove;
  });

  it('preserves the active draft and runner if deletion fails', async () => {
    vi.mocked(deleteScript).mockRejectedValue(new Error('delete failed'));
    const state = new IndicatorState();
    state.scripts = [info()];
    state.openScript('s1');
    await state.run(CTX);
    await expect(state.delete('s1')).rejects.toThrow('delete failed');
    expect(state.activeId).toBe('s1');
    expect(state.runners.s1.lastResult).toEqual(result());
  });

  it('does not let a late refresh erase a newly saved script', async () => {
    const pending = deferred<ScriptInfo[]>();
    vi.mocked(listScripts).mockReturnValue(pending.promise);
    const state = new IndicatorState();
    const refreshing = state.refresh();
    await state.save();
    pending.resolve([]);
    await refreshing;
    expect(state.scripts.map(s => s.id)).toEqual(['new1']);
  });

  it('save-and-run executes the saved script, not the script selected during the save', async () => {
    const pending = deferred<ScriptInfo>();
    vi.mocked(updateScript).mockReturnValue(pending.promise);
    const state = new IndicatorState();
    state.scripts = [info(), info({ id: 's2' })];
    state.openScript('s1');
    state.setCode('submitted');
    const running = state.saveAndRun(CTX);
    state.openScript('s2', () => true);
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
    state.openScript('s1');
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
    state.openScript('s1');
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

import { describe, it, expect } from 'vitest';
import sampleRun from './fixtures/sample-run.json';
import { BacktestState } from './backtestState.svelte';
import { deferred } from '$lib/features/chart/reactiveTestSupport';

function makeState() {
  return new BacktestState(async () => sampleRun);
}

describe('BacktestState.load', () => {
  it.each(['resolve', 'reject'] as const)(
    'ignores late %s after disposal and cannot restart',
    async outcome => {
      const pending = deferred<unknown>();
      let loads = 0;
      const state = new BacktestState(() => {
        loads++;
        return pending.promise;
      });
      const loading = state.load();
      state.dispose();
      if (outcome === 'resolve') pending.resolve(sampleRun);
      else pending.reject(new Error('obsolete'));
      await loading;
      await state.load();
      expect(loads).toBe(1);
      expect(state.result).toBeNull();
      expect(state.status).toBeNull();
      expect(state.error).toBeNull();
      expect(state.loading).toBe(false);
    },
  );

  it('loads and parses the blob through the injected loader', async () => {
    const s = makeState();
    await s.load();
    expect(s.loading).toBe(false);
    expect(s.error).toBeNull();
    expect(s.result?.trades.length).toBeGreaterThan(0);
  });

  it('is idempotent — a second load does not refetch', async () => {
    let calls = 0;
    const s = new BacktestState(async () => {
      calls++;
      return sampleRun;
    });
    await s.load();
    await s.load();
    expect(calls).toBe(1);
  });

  it('captures loader errors', async () => {
    const s = new BacktestState(async () => {
      throw new Error('boom');
    });
    await s.load();
    expect(s.result).toBeNull();
    expect(s.error).toBe('boom');
  });

  it('surfaces a structurally invalid blob as an error', async () => {
    const s = new BacktestState(async () => ({ nope: true }));
    await s.load();
    expect(s.result).toBeNull();
    expect(s.error).toMatch(/array "bars"/);
  });
});

describe('BacktestState interaction', () => {
  it('switches tabs', () => {
    const s = makeState();
    expect(s.activeTab).toBe('equity');
    s.setTab('trades');
    expect(s.activeTab).toBe('trades');
  });

  it('tracks the hovered trade for the marker↔row link', () => {
    const s = makeState();
    expect(s.hoveredTrade).toBeNull();
    s.hoverTrade(3);
    expect(s.hoveredTrade).toBe(3);
    s.hoverTrade(null);
    expect(s.hoveredTrade).toBeNull();
  });
});

import { describe as describe2, it as it2, expect as expect2 } from 'vitest';

describe2('BacktestState.status', () => {
  it2('captures status from a stored-run blob', async () => {
    const { BacktestState } = await import('./backtestState.svelte');
    const blob = {
      ...(await import('./fixtures/sample-run.json')).default,
      status: { stale: true, recorded: '1.0.0', current: '1.1.0' },
    };
    const s = new BacktestState(async () => blob);
    await s.load();
    expect2(s.status).toEqual({
      stale: true,
      recorded: '1.0.0',
      current: '1.1.0',
    });
  });

  it2('leaves status null for a blob without it (live run)', async () => {
    const { BacktestState } = await import('./backtestState.svelte');
    const blob = (await import('./fixtures/sample-run.json')).default;
    const s = new BacktestState(async () => blob);
    await s.load();
    expect2(s.status).toBeNull();
  });
});

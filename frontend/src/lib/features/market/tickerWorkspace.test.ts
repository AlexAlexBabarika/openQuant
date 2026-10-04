import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAccessToken, setAccessToken } from '$lib/core/api';
import { TickerPriority, TickerStance } from './tickers';
import {
  TickerWorkspaceSync,
  syncWorkspaceOnSignIn,
  type TickerWorkspaceState,
} from './tickerWorkspace';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

function state(name: string): TickerWorkspaceState {
  return {
    groups: [{ name, tickers: [] }],
    selectedGroupName: name,
    selectedPriority: null,
    selectedStance: null,
  };
}

function response(name: string, from_database = true) {
  const { selectedGroupName, ...rest } = state(name);
  return new Response(
    JSON.stringify({
      workspace: { ...rest, selectedGroup: selectedGroupName },
      from_database,
      updated_at: null,
    }),
  );
}

function fixture(initial = 'local') {
  let account: string | null = 'a';
  let workspace = state(initial);
  const apply = vi.fn((next: TickerWorkspaceState) => {
    workspace = next;
  });
  const onHydrated = vi.fn();
  const onError = vi.fn();
  const sync = new TickerWorkspaceSync({
    userId: () => account,
    read: () => workspace,
    apply,
    onHydrated,
    onError,
  });
  const select = (id: string | null) => {
    account = id;
    sync.setUser(id);
  };
  const edit = (name: string) => {
    workspace = state(name);
    sync.save({
      groups: workspace.groups,
      selectedGroup: name,
      selectedPriority: null,
      selectedStance: null,
    });
  };
  return {
    sync,
    select,
    edit,
    apply,
    onHydrated,
    onError,
    read: () => workspace,
  };
}

function pendingStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  return (account = 'a') =>
    JSON.parse(
      values.get(`openQuant.tickerWorkspace.pending.v1.${account}`) ?? 'null',
    );
}

beforeEach(() => {
  vi.useFakeTimers();
  setAccessToken('account-a');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  clearAccessToken();
});
const settle = () => vi.advanceTimersByTimeAsync(0);

describe('ticker workspace hydration', () => {
  it('ignores an older account load settling after the newer account load', async () => {
    const old = deferred<Response>();
    const fetch = vi
      .fn()
      .mockImplementationOnce(() => old.promise)
      .mockResolvedValueOnce(response('account-b'));
    vi.stubGlobal('fetch', fetch);
    const f = fixture();
    f.select('a');
    await settle();
    setAccessToken('account-b');
    f.select('b');
    await settle();
    expect(f.read().selectedGroupName).toBe('account-b');
    old.resolve(response('account-a'));
    await settle();
    expect(f.read().selectedGroupName).toBe('account-b');
    expect(f.apply).toHaveBeenCalledTimes(1);
    expect(f.onHydrated).toHaveBeenCalledTimes(1);
    f.sync.destroy();
  });

  it('never applies or migrates a delayed load after logout, even before its effect runs', async () => {
    const pending = deferred<Response>();
    const fetch = vi.fn(async () => pending.promise);
    vi.stubGlobal('fetch', fetch);
    const f = fixture();
    f.select('a');
    await settle();
    clearAccessToken();
    pending.resolve(response('All', false));
    await settle();
    expect(f.apply).not.toHaveBeenCalled();
    expect(f.onHydrated).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    f.select(null);
    f.edit('anonymous');
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.read().selectedGroupName).toBe('anonymous');
    expect(fetch).toHaveBeenCalledTimes(1);
    f.sync.destroy();
  });

  it('does not let a delayed load overwrite edits made during hydration', async () => {
    const pending = deferred<Response>();
    const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'PUT' ? response('edited') : pending.promise,
    );
    vi.stubGlobal('fetch', fetch);
    const f = fixture();
    f.select('a');
    await settle();
    f.edit('edited');
    pending.resolve(response('remote'));
    await settle();
    expect(f.apply).not.toHaveBeenCalled();
    expect(f.read().selectedGroupName).toBe('edited');
    await vi.advanceTimersByTimeAsync(500);
    expect(
      JSON.parse(fetch.mock.calls[1][1]!.body as string).selectedGroup,
    ).toBe('edited');
    f.sync.destroy();
  });

  it('migrates a non-default anonymous workspace once and keeps defaults anonymous without writes', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
      response('All', false),
    );
    vi.stubGlobal('fetch', fetch);
    const f = fixture('anonymous-draft');
    f.select('a');
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(fetch.mock.calls[1][1]!.body as string).selectedGroup,
    ).toBe('anonymous-draft');
    expect(f.read().selectedGroupName).toBe('anonymous-draft');
    expect(f.onHydrated).toHaveBeenCalledTimes(1);
    f.sync.destroy();
    fetch.mockClear();
    const defaults = fixture('All');
    defaults.select('a');
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetch).toHaveBeenCalledTimes(1);
    defaults.sync.destroy();
  });

  it('does not clear local state or overwrite a remote workspace when hydration fails', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    const f = fixture();
    f.select('a');
    await settle();
    f.edit('edited');
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.read().selectedGroupName).toBe('edited');
    expect(f.onError).toHaveBeenCalledTimes(1);
    expect(f.onHydrated).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    f.sync.destroy();
  });

  it('does not rehydrate on incidental same-account updates', async () => {
    const fetch = vi.fn(async () => response('remote'));
    vi.stubGlobal('fetch', fetch);
    const f = fixture();
    f.select('a');
    await settle();
    f.select('a');
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(f.apply).toHaveBeenCalledTimes(1);
    f.sync.destroy();
  });

  it('guards the sign-in migration before issuing a write after an account change', async () => {
    const pending = deferred<Response>();
    const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'PUT' ? response('anonymous') : pending.promise,
    );
    vi.stubGlobal('fetch', fetch);
    let current = true;
    const loading = syncWorkspaceOnSignIn(state('anonymous'), () => current);
    current = false;
    pending.resolve(response('All', false));
    expect(await loading).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('ticker workspace writes', () => {
  it.each(['priority', 'deletion'])(
    'retains %s edits after pending restoration fails',
    async operation => {
      const pending = pendingStorage();
      const fetch = vi.fn().mockResolvedValueOnce(response('remote'));
      vi.stubGlobal('fetch', fetch);
      const old = fixture();
      old.select('a');
      await settle();
      old.sync.save({
        groups: [
          {
            name: 'unsent',
            tickers: [
              {
                symbol: 'SPY',
                priority: TickerPriority.High,
                stance: TickerStance.Watch,
                providers: {
                  yfinance: true,
                  binance: false,
                  twelvedata: false,
                },
              },
            ],
          },
        ],
        selectedGroup: 'unsent',
        selectedPriority: null,
        selectedStance: null,
      });
      old.sync.destroy();
      fetch.mockResolvedValueOnce(new Response('', { status: 503 }));
      const fresh = fixture();
      fresh.select('a');
      await settle();
      expect(fresh.onError).toHaveBeenCalledTimes(1);
      expect(fresh.read().selectedGroupName).toBe('unsent');
      const group = fresh.read().groups.find(g => g.name === 'unsent')!;
      expect(group.tickers[0].priority).toBe(TickerPriority.High);
      if (operation === 'deletion') group.tickers = [];
      else group.tickers[0].priority = TickerPriority.Critical;
      const payload = {
        groups: fresh.read().groups,
        selectedGroup: 'unsent',
        selectedPriority: null,
        selectedStance: null,
      };
      fetch.mockResolvedValue(response('unsent'));
      fresh.sync.save(payload);
      expect(pending()).toEqual(payload);
      await vi.advanceTimersByTimeAsync(500);
      expect(
        JSON.parse(fetch.mock.calls[fetch.mock.calls.length - 1][1].body),
      ).toEqual(payload);
      expect(pending()).toBeNull();
      fresh.sync.destroy();
    },
  );

  it('captures newer edits made while a pending restoration is still failing', async () => {
    const pending = pendingStorage();
    const held = deferred<Response>();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response('remote'))
      .mockImplementationOnce(() => held.promise)
      .mockResolvedValue(response('during-restore'));
    vi.stubGlobal('fetch', fetch);
    const old = fixture();
    old.select('a');
    await settle();
    old.edit('unsent');
    old.sync.destroy();
    const fresh = fixture();
    fresh.select('a');
    await settle();
    fresh.edit('during-restore');
    held.resolve(new Response('', { status: 503 }));
    await settle();
    expect(pending().selectedGroup).toBe('during-restore');
    fresh.sync.destroy();
    const reloaded = fixture();
    reloaded.select('a');
    await settle();
    expect(reloaded.read().selectedGroupName).toBe('during-restore');
    expect(pending()).toBeNull();
    reloaded.sync.destroy();
  });

  it('keeps a restored account editable when its write succeeds but the following fetch fails', async () => {
    const pending = pendingStorage();
    const fetch = vi.fn().mockResolvedValueOnce(response('remote'));
    vi.stubGlobal('fetch', fetch);
    const old = fixture();
    old.select('a');
    await settle();
    old.edit('unsent');
    old.sync.destroy();
    fetch
      .mockResolvedValueOnce(response('unsent'))
      .mockResolvedValueOnce(new Response('', { status: 503 }));
    const fresh = fixture();
    fresh.select('a');
    await settle();
    expect(fresh.onError).toHaveBeenCalledTimes(1);
    fresh.edit('after-failed-fetch');
    expect(pending().selectedGroup).toBe('after-failed-fetch');
    fresh.sync.destroy();
  });

  it('does not upload unhydrated guest state after a first account fetch failure', async () => {
    const pending = pendingStorage();
    const fetch = vi.fn(async () => new Response('', { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    const f = fixture('guest');
    f.select('a');
    await settle();
    f.edit('still-unhydrated');
    await vi.advanceTimersByTimeAsync(500);
    expect(pending()).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    f.sync.destroy();
  });

  it('does not clear another tab pending record on an unchanged save', async () => {
    const pending = pendingStorage();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response('remote')),
    );
    const f = fixture();
    f.select('a');
    await settle();
    const payload = {
      groups: f.read().groups,
      selectedGroup: f.read().selectedGroupName,
      selectedPriority: null,
      selectedStance: null,
    };
    localStorage.setItem(
      'openQuant.tickerWorkspace.pending.v1.a',
      JSON.stringify({ ...payload, selectedGroup: 'other-tab' }),
    );
    f.sync.save(payload);
    expect(pending().selectedGroup).toBe('other-tab');
    f.sync.destroy();
  });

  it('replays an unsent edit for the same account after immediate destruction and reload', async () => {
    const pending = pendingStorage();
    let server = 'remote';
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT')
        server = JSON.parse(init.body as string).selectedGroup;
      return response(server);
    });
    vi.stubGlobal('fetch', fetch);
    const old = fixture();
    old.select('a');
    await settle();
    old.edit('unsent');
    old.sync.destroy();
    expect(server).toBe('remote');
    expect(pending().selectedGroup).toBe('unsent');
    const fresh = fixture();
    fresh.select('a');
    await settle();
    expect(fresh.read().selectedGroupName).toBe('unsent');
    expect(server).toBe('unsent');
    expect(pending()).toBeNull();
    fresh.sync.destroy();
  });

  it('does not replay another account draft and retains it through logout', async () => {
    const pending = pendingStorage();
    const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      response(init?.method === 'PUT' ? 'saved' : 'remote'),
    );
    vi.stubGlobal('fetch', fetch);
    const f = fixture();
    f.select('a');
    await settle();
    f.edit('a-unsent');
    f.select(null);
    expect(pending().selectedGroup).toBe('a-unsent');
    setAccessToken('account-b');
    f.select('b');
    await settle();
    await vi.advanceTimersByTimeAsync(500);
    expect(f.read().selectedGroupName).toBe('remote');
    expect(
      fetch.mock.calls.filter(([, init]) => init?.method === 'PUT'),
    ).toHaveLength(0);
    expect(pending().selectedGroup).toBe('a-unsent');
    expect(pending('b')).toBeNull();
    f.sync.destroy();
  });

  it('keeps newer pending edits when an older write acknowledges', async () => {
    const pending = pendingStorage();
    const first = deferred<Response>();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response('remote'))
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(response('newer'));
    vi.stubGlobal('fetch', fetch);
    const f = fixture();
    f.select('a');
    await settle();
    f.edit('older');
    await vi.advanceTimersByTimeAsync(500);
    f.edit('newer');
    first.resolve(response('older'));
    await settle();
    expect(pending().selectedGroup).toBe('newer');
    await vi.advanceTimersByTimeAsync(500);
    expect(pending()).toBeNull();
    f.sync.destroy();
  });

  it('retains a failed save for restoration retry', async () => {
    const pending = pendingStorage();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response('remote'))
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValue(response('retry'));
    vi.stubGlobal('fetch', fetch);
    const old = fixture();
    old.select('a');
    await settle();
    old.edit('retry');
    await vi.advanceTimersByTimeAsync(500);
    expect(pending().selectedGroup).toBe('retry');
    old.sync.destroy();
    const fresh = fixture();
    fresh.select('a');
    await settle();
    expect(fresh.read().selectedGroupName).toBe('retry');
    expect(pending()).toBeNull();
    fresh.sync.destroy();
  });

  it('discards an unsent draft reverted to the acknowledged workspace', async () => {
    const pending = pendingStorage();
    const fetch = vi.fn(async () => response('remote'));
    vi.stubGlobal('fetch', fetch);
    const f = fixture();
    f.select('a');
    await settle();
    const original = f.read();
    f.edit('temporary');
    f.sync.save({
      groups: original.groups,
      selectedGroup: original.selectedGroupName,
      selectedPriority: original.selectedPriority,
      selectedStance: original.selectedStance,
    });
    expect(pending()).toBeNull();
    await vi.advanceTimersByTimeAsync(500);
    expect(fetch).toHaveBeenCalledTimes(1);
    f.sync.destroy();
  });

  it('waits for an older same-account save before hydrating a new login session', async () => {
    const pending = deferred<Response>();
    let server = 'original';
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== 'PUT') return response(server);
      await pending.promise;
      server = JSON.parse(init.body as string).selectedGroup;
      return response(server);
    });
    vi.stubGlobal('fetch', fetch);
    const f = fixture();
    f.select('a');
    await settle();
    f.edit('saved');
    await vi.advanceTimersByTimeAsync(500);
    setAccessToken('new-session-same-account');
    f.select('a');
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
    pending.resolve(response('saved'));
    await settle();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(f.read().selectedGroupName).toBe('saved');
    expect(server).toBe('saved');
    f.sync.destroy();
  });

  it('allows a newer edit to save after an earlier write failed', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response('remote'))
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(response('newer'));
    vi.stubGlobal('fetch', fetch);
    const f = fixture();
    f.select('a');
    await settle();
    f.edit('failed');
    await vi.advanceTimersByTimeAsync(500);
    expect(f.onError).toHaveBeenCalledTimes(1);
    f.edit('newer');
    await vi.advanceTimersByTimeAsync(500);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetch.mock.calls[2][1].body).selectedGroup).toBe('newer');
    f.sync.destroy();
  });

  it('serializes delayed saves so the newest edit is the final server value', async () => {
    const first = deferred<Response>();
    let server = 'initial';
    let writes = 0;
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== 'PUT') return response(server);
      const name = JSON.parse(init.body as string).selectedGroup;
      if (++writes === 1) await first.promise;
      server = name;
      return response(server);
    });
    vi.stubGlobal('fetch', fetch);
    const f = fixture();
    f.select('a');
    await settle();
    f.edit('older');
    await vi.advanceTimersByTimeAsync(500);
    f.edit('newer');
    await vi.advanceTimersByTimeAsync(500);
    expect(writes).toBe(1);
    first.resolve(response('older'));
    await settle();
    expect(writes).toBe(2);
    expect(server).toBe('newer');
    expect(f.read().selectedGroupName).toBe('newer');
    f.sync.destroy();
  });

  it('persists a revert to the acknowledged value while an older save is in flight', async () => {
    const pending = deferred<Response>();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response('original'))
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce(response('original'));
    vi.stubGlobal('fetch', fetch);
    const f = fixture();
    f.select('a');
    await settle();
    f.edit('temporary');
    await vi.advanceTimersByTimeAsync(500);
    f.edit('original');
    await vi.advanceTimersByTimeAsync(500);
    pending.resolve(response('temporary'));
    await settle();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetch.mock.calls[2][1].body).selectedGroup).toBe(
      'original',
    );
    f.sync.destroy();
  });

  it('drops queued old-account saves and ignores old-account acknowledgements after switching', async () => {
    const pending = deferred<Response>();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response('a'))
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce(response('b'))
      .mockResolvedValue(response('b-edit'));
    vi.stubGlobal('fetch', fetch);
    const f = fixture();
    f.select('a');
    await settle();
    f.edit('a-first');
    await vi.advanceTimersByTimeAsync(500);
    f.edit('a-queued');
    await vi.advanceTimersByTimeAsync(500);
    setAccessToken('account-b');
    f.select('b');
    await settle();
    f.edit('b-edit');
    await vi.advanceTimersByTimeAsync(500);
    pending.resolve(response('a-first'));
    await settle();
    await vi.advanceTimersByTimeAsync(500);
    const puts = fetch.mock.calls.filter(([, init]) => init.method === 'PUT');
    expect(puts.map(([, init]) => JSON.parse(init.body).selectedGroup)).toEqual(
      ['a-first', 'b-edit'],
    );
    expect(new Headers(puts[1][1].headers).get('Authorization')).toBe(
      'Bearer account-b',
    );
    expect(f.read().selectedGroupName).toBe('b-edit');
    f.sync.destroy();
  });

  it('cancels a debounced save on logout or destruction', async () => {
    const fetch = vi.fn(async () => response('remote'));
    vi.stubGlobal('fetch', fetch);
    const f = fixture();
    f.select('a');
    await settle();
    f.edit('pending');
    f.select(null);
    await vi.advanceTimersByTimeAsync(500);
    expect(fetch).toHaveBeenCalledTimes(1);
    f.select('a');
    await settle();
    f.edit('pending-again');
    f.sync.destroy();
    await vi.advanceTimersByTimeAsync(500);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

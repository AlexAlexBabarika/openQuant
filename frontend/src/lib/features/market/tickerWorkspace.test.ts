import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAccessToken, setAccessToken } from '$lib/core/api';
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

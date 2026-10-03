import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  apiFetch,
  clearAccessToken,
  getAccessToken,
  setAccessToken,
} from './api';
import {
  authState,
  fetchSession,
  login,
  logout,
  signup,
  type AuthUser,
} from '../features/auth/auth';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

const user: AuthUser = { id: 'user-a', email: 'a@example.test' };
const session = (token = 'renewed', account = user) =>
  new Response(
    JSON.stringify({
      access_token: token,
      expires_at: null,
      user: account,
    }),
  );
const unauthorized = () =>
  new Response('', { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } });
const authorization = (init?: RequestInit) =>
  new Headers(init?.headers).get('Authorization');

beforeEach(() => {
  setAccessToken('expired');
  authState.set({ user, loading: false, error: null });
});

afterEach(() => {
  clearAccessToken();
  authState.set({ user: null, loading: false, error: null });
  vi.unstubAllGlobals();
});

describe('protected request renewal', () => {
  it('shares one cookie renewal and retries concurrent rejected writes exactly once', async () => {
    const refresh = deferred<Response>();
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/auth/refresh') return refresh.promise;
      return authorization(init) === 'Bearer expired'
        ? unauthorized()
        : new Response('{}');
    });
    vi.stubGlobal('fetch', fetch);
    const options = { method: 'PUT', body: JSON.stringify({ name: 'draft' }) };
    const first = apiFetch('/strategies/one', options, true);
    const second = apiFetch('/user/ticker-workspace', options, true);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    refresh.resolve(session());
    expect((await first).ok).toBe(true);
    expect((await second).ok).toBe(true);
    expect(
      fetch.mock.calls.filter(([url]) => url === '/auth/refresh'),
    ).toHaveLength(1);
    for (const [, init] of fetch.mock.calls
      .filter(([url]) => url !== '/auth/refresh')
      .slice(2)) {
      expect(init?.body).toBe(options.body);
      expect(init?.method).toBe('PUT');
      expect(authorization(init)).toBe('Bearer renewed');
    }
    expect(get(authState).user).toBe(user);
  });

  it('reuses a renewed token when an older 401 arrives after the refresh completed', async () => {
    const old = deferred<Response>();
    let requests = 0;
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/auth/refresh') return session();
      if (++requests === 1) return old.promise;
      return authorization(init) === 'Bearer expired'
        ? unauthorized()
        : new Response('{}');
    });
    vi.stubGlobal('fetch', fetch);
    const delayed = apiFetch('/strategies', {}, true);
    expect((await apiFetch('/scripts', {}, true)).ok).toBe(true);
    old.resolve(unauthorized());
    expect((await delayed).ok).toBe(true);
    expect(
      fetch.mock.calls.filter(([url]) => url === '/auth/refresh'),
    ).toHaveLength(1);
  });

  it.each([403, 422, 429, 500])(
    'does not renew or retry unrelated HTTP %s failures',
    async status => {
      const fetch = vi.fn(async () => new Response('', { status }));
      vi.stubGlobal('fetch', fetch);
      expect((await apiFetch('/strategies', {}, true)).status).toBe(status);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it('does not renew public requests, anonymous requests, auth endpoints or unchallenged 401s', async () => {
    const fetch = vi.fn(async () => unauthorized());
    vi.stubGlobal('fetch', fetch);
    await apiFetch('/data', {}, false);
    await apiFetch('/auth/logout', {}, true);
    fetch.mockImplementationOnce(async () => new Response('', { status: 401 }));
    await apiFetch('/strategies', {}, true);
    clearAccessToken();
    await apiFetch('/strategies', {}, true);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('does not send in-memory tokens to an unrelated absolute or protocol-relative URL', async () => {
    const fetch = vi.fn(async () => unauthorized());
    vi.stubGlobal('fetch', fetch);
    await apiFetch('https://other.example/strategies', {}, true);
    await apiFetch('//other.example/strategies', {}, true);
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [, init] of fetch.mock.calls as unknown as [
      string,
      RequestInit,
    ][])
      expect(authorization(init)).toBeNull();
  });

  it('does not replay a request aborted during renewal', async () => {
    const refresh = deferred<Response>();
    const controller = new AbortController();
    const fetch = vi.fn(async (url: string) =>
      url === '/auth/refresh' ? refresh.promise : unauthorized(),
    );
    vi.stubGlobal('fetch', fetch);
    const request = apiFetch(
      '/strategies',
      { signal: controller.signal },
      true,
    );
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    controller.abort();
    refresh.resolve(session());
    expect((await request).status).toBe(401);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('returns a second 401 without a refresh loop', async () => {
    const fetch = vi.fn(async (url: string) =>
      url === '/auth/refresh' ? session() : unauthorized(),
    );
    vi.stubGlobal('fetch', fetch);
    expect((await apiFetch('/strategies', {}, true)).status).toBe(401);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('never retries an old-account write if another tab changed the refresh-cookie account', async () => {
    const fetch = vi.fn(async (url: string) =>
      url === '/auth/refresh'
        ? session('other-account', { id: 'user-b', email: null })
        : unauthorized(),
    );
    vi.stubGlobal('fetch', fetch);
    expect(
      (await apiFetch('/strategies', { method: 'POST', body: '{}' }, true))
        .status,
    ).toBe(401);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(getAccessToken()).toBeNull();
    expect(get(authState).user).toBeNull();
  });

  it('clears signed-in state only for an invalid refresh session', async () => {
    const fetch = vi.fn(async () => unauthorized());
    vi.stubGlobal('fetch', fetch);
    expect((await apiFetch('/strategies', {}, true)).status).toBe(401);
    expect(getAccessToken()).toBeNull();
    expect(get(authState).user).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(['network', 'server'])(
    'preserves signed-in state and drafts after a transient %s refresh failure',
    async failure => {
      const fetch = vi.fn(async (url: string) => {
        if (url !== '/auth/refresh') return unauthorized();
        if (failure === 'network') throw new TypeError('offline');
        return new Response('', { status: 503 });
      });
      vi.stubGlobal('fetch', fetch);
      await apiFetch('/strategies', {}, true);
      expect(getAccessToken()).toBe('expired');
      expect(get(authState).user).toBe(user);
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );
});

describe('session races', () => {
  it('invalidates immediately on logout, waits for cookie rotation, and never resurrects or retries the old session', async () => {
    const refresh = deferred<Response>();
    const fetch = vi.fn(async (url: string) => {
      if (url === '/auth/refresh') return refresh.promise;
      return url === '/auth/logout' ? new Response('{}') : unauthorized();
    });
    vi.stubGlobal('fetch', fetch);
    const request = apiFetch('/strategies', {}, true);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const exiting = logout();
    expect(get(authState).user).toBeNull();
    expect(getAccessToken()).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
    refresh.resolve(session());
    await exiting;
    expect((await request).status).toBe(401);
    expect(getAccessToken()).toBeNull();
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/strategies',
      '/auth/refresh',
      '/auth/logout',
    ]);
  });

  it('never replays an old-account request with a new-account token', async () => {
    const old = deferred<Response>();
    const fetch = vi.fn(async (url: string) =>
      url === '/auth/login'
        ? session('new-account', { id: 'user-b', email: null })
        : old.promise,
    );
    vi.stubGlobal('fetch', fetch);
    const request = apiFetch(
      '/strategies',
      { method: 'POST', body: '{}' },
      true,
    );
    await login('b@example.test', 'password');
    old.resolve(unauthorized());
    expect((await request).status).toBe(401);
    expect(getAccessToken()).toBe('new-account');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not let startup restoration replace a newer login', async () => {
    clearAccessToken();
    authState.set({ user: null, loading: false, error: null });
    const refresh = deferred<Response>();
    const fetch = vi.fn(async (url: string) =>
      url === '/auth/refresh'
        ? refresh.promise
        : session('new-account', { id: 'user-b', email: null }),
    );
    vi.stubGlobal('fetch', fetch);
    const restoring = fetchSession();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const signingIn = login('b@example.test', 'password');
    refresh.resolve(session());
    expect(await restoring).toBeNull();
    await signingIn;
    expect(get(authState).user?.id).toBe('user-b');
    expect(getAccessToken()).toBe('new-account');
  });

  it('does not let a delayed login or signup resurrect a logged-out session', async () => {
    for (const signIn of [
      () => login('a@example.test', 'password'),
      () => signup('a@example.test', 'password'),
    ]) {
      const pending = deferred<Response>();
      const fetch = vi.fn(async (url: string) =>
        url === '/auth/logout' ? new Response('{}') : pending.promise,
      );
      vi.stubGlobal('fetch', fetch);
      const signingIn = signIn();
      const rejected = expect(signingIn).rejects.toThrow('Session changed');
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      const exiting = logout();
      pending.resolve(session());
      await rejected;
      await exiting;
      expect(get(authState).user).toBeNull();
      expect(getAccessToken()).toBeNull();
    }
  });

  it('does not replace the auth user object on an incidental refresh', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => session()),
    );
    await fetchSession();
    expect(get(authState).user).toBe(user);
    expect(getAccessToken()).toBe('renewed');
  });

  it('serializes logout before a newer login without clearing the new account on completion', async () => {
    const pending = deferred<Response>();
    const fetch = vi.fn(async (url: string) =>
      url === '/auth/logout'
        ? pending.promise
        : session('new-account', { id: 'user-b', email: null }),
    );
    vi.stubGlobal('fetch', fetch);
    const exiting = logout();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const signingIn = login('b@example.test', 'password');
    expect(fetch).toHaveBeenCalledTimes(1);
    pending.resolve(new Response('{}'));
    await exiting;
    await signingIn;
    expect(get(authState).user?.id).toBe('user-b');
    expect(getAccessToken()).toBe('new-account');
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/auth/logout',
      '/auth/login',
    ]);
  });

  it('does not let an old refresh failure clear a newly requested account', async () => {
    const pending = deferred<Response>();
    const fetch = vi.fn(async (url: string) => {
      if (url === '/auth/refresh') return pending.promise;
      if (url === '/auth/login')
        return session('new-account', { id: 'user-b', email: null });
      return unauthorized();
    });
    vi.stubGlobal('fetch', fetch);
    const request = apiFetch('/strategies', {}, true);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const signingIn = login('b@example.test', 'password');
    pending.resolve(unauthorized());
    await signingIn;
    expect((await request).status).toBe(401);
    expect(get(authState).user?.id).toBe('user-b');
    expect(getAccessToken()).toBe('new-account');
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

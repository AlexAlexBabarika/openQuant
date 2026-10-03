import { get, writable } from 'svelte/store';
import {
  apiFetch,
  apiJson,
  clearAccessToken,
  getAccessToken,
  getSessionGeneration,
  readErrorMessage,
  refreshAccessToken,
  setAccessToken,
  setAccessTokenRefresher,
} from '$lib/core/api';

export type AuthUser = {
  id: string;
  email: string | null;
};

type AuthSessionPayload = {
  access_token: string;
  expires_at: number | null;
  user: AuthUser;
};

type SignupPendingPayload = {
  message: string;
};

export type AuthState = {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
};

export const authState = writable<AuthState>({
  user: null,
  loading: false,
  error: null,
});

let authRevision = 0;
let cookieRequests: Promise<unknown> = Promise.resolve();
let sessionFlight: {
  revision: number;
  generation: number;
  promise: Promise<AuthSessionPayload | null>;
} | null = null;

// Cookie rotation and logout must settle in order, even if the UI changes first.
function queueCookieRequest<T>(request: () => Promise<T>): Promise<T> {
  const result = cookieRequests.then(request);
  cookieRequests = result.catch(() => {});
  return result;
}

function requestSession(): Promise<AuthSessionPayload | null> {
  const revision = authRevision;
  const generation = getSessionGeneration();
  if (
    sessionFlight?.revision === revision &&
    sessionFlight.generation === generation
  )
    return sessionFlight.promise;
  const isCurrent = () =>
    revision === authRevision && generation === getSessionGeneration();
  const promise = queueCookieRequest(async () => {
    if (!isCurrent()) return null;
    try {
      const response = await apiFetch('/auth/refresh', { method: 'POST' });
      if (!isCurrent()) return null;
      if (response.status === 401) {
        clearAuthState();
        return null;
      }
      if (!response.ok) return null;
      const payload = (await response.json()) as AuthSessionPayload;
      return isCurrent() ? payload : null;
    } catch {
      return null;
    }
  });
  const flight = { revision, generation, promise };
  sessionFlight = flight;
  void promise.finally(() => {
    if (sessionFlight === flight) sessionFlight = null;
  });
  return promise;
}

setAccessTokenRefresher(async () => {
  const user = get(authState).user;
  const revision = authRevision;
  const generation = getSessionGeneration();
  const payload = await requestSession();
  if (revision !== authRevision || generation !== getSessionGeneration())
    return null;
  if (payload && user && payload.user.id !== user.id) {
    clearAuthState();
    return null;
  }
  return payload?.access_token ?? null;
});

function setLoading(loading: boolean): void {
  authState.update(prev => ({ ...prev, loading }));
}

function setError(error: string | null): void {
  authState.update(prev => ({ ...prev, error }));
}

function setAuthenticated(payload: AuthSessionPayload): void {
  setAccessToken(payload.access_token);
  authState.set({
    user: payload.user,
    loading: false,
    error: null,
  });
}

function clearAuthState(): void {
  clearAccessToken();
  authState.set({
    user: null,
    loading: false,
    error: null,
  });
}

export async function login(
  email: string,
  password: string,
): Promise<AuthUser> {
  const revision = ++authRevision;
  setLoading(true);
  setError(null);
  try {
    const payload = await queueCookieRequest(() =>
      apiJson<AuthSessionPayload>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    );
    if (revision !== authRevision) throw new Error('Session changed');
    setAuthenticated(payload);
    return payload.user;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Login failed';
    if (revision === authRevision) {
      setError(message);
      setLoading(false);
    }
    throw new Error(message);
  }
}

export async function signup(
  email: string,
  password: string,
): Promise<{
  user: AuthUser | null;
  pendingConfirmation: boolean;
  message?: string;
}> {
  const revision = ++authRevision;
  setLoading(true);
  setError(null);
  try {
    const response = await queueCookieRequest(() =>
      apiFetch('/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    );
    if (revision !== authRevision) throw new Error('Session changed');

    if (response.status === 202) {
      const payload = (await response.json()) as SignupPendingPayload;
      if (revision !== authRevision) throw new Error('Session changed');
      authState.update(prev => ({ ...prev, loading: false }));
      return {
        user: null,
        pendingConfirmation: true,
        message: payload.message,
      };
    }

    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }

    const payload = (await response.json()) as AuthSessionPayload;
    if (revision !== authRevision) throw new Error('Session changed');
    setAuthenticated(payload);
    return { user: payload.user, pendingConfirmation: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Signup failed';
    if (revision === authRevision) {
      setError(message);
      setLoading(false);
    }
    throw new Error(message);
  }
}

export async function logout(): Promise<void> {
  const token = getAccessToken();
  ++authRevision;
  clearAuthState();
  await queueCookieRequest(() =>
    apiFetch('/auth/logout', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }),
  );
}

/**
 * Attempt to restore a session using the HttpOnly refresh_token cookie.
 * Called on app startup / page reload. The cookie is sent automatically
 * by the browser (same-origin), so no JS token handling is needed.
 */
export async function fetchSession(): Promise<AuthUser | null> {
  const currentUser = get(authState).user;
  if (currentUser) {
    await refreshAccessToken();
    return get(authState).user;
  }
  const revision = authRevision;
  const generation = getSessionGeneration();
  setLoading(true);
  setError(null);
  const payload = await requestSession();
  if (revision !== authRevision || generation !== getSessionGeneration())
    return null;
  if (payload) {
    setAuthenticated(payload);
    return payload.user;
  }
  setLoading(false);
  return null;
}

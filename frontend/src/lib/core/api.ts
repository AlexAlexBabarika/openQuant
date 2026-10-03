import { API_BASE } from './config';

/**
 * In-memory access token. Never persisted to localStorage/sessionStorage
 * so it cannot be stolen by XSS reading storage APIs.
 * The refresh token lives in an HttpOnly cookie managed by the backend.
 */
let _accessToken: string | null = null;
let sessionGeneration = 0;
let accessTokenRefresher: (() => Promise<string | null>) | null = null;
let refreshFlight: { generation: number; promise: Promise<boolean> } | null =
  null;

export function getSessionGeneration(): number {
  return sessionGeneration;
}

export function setAccessTokenRefresher(
  refresher: () => Promise<string | null>,
): void {
  accessTokenRefresher = refresher;
}

export function refreshAccessToken(): Promise<boolean> {
  const generation = sessionGeneration;
  if (refreshFlight?.generation === generation) return refreshFlight.promise;
  const promise = (async () => {
    const token = await accessTokenRefresher?.();
    if (!token || generation !== sessionGeneration) return false;
    _accessToken = token;
    return true;
  })();
  const flight = { generation, promise };
  refreshFlight = flight;
  void promise
    .finally(() => {
      if (refreshFlight === flight) refreshFlight = null;
    })
    .catch(() => {});
  return promise;
}

export function getAccessToken(): string | null {
  return _accessToken;
}

export function setAccessToken(token: string | null): void {
  sessionGeneration++;
  _accessToken = token;
}

export function clearAccessToken(): void {
  setAccessToken(null);
}

function resolveUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  if (path.startsWith('/')) {
    return `${API_BASE}${path}`;
  }
  return `${API_BASE}/${path}`;
}

export async function apiFetch(
  path: string,
  init: RequestInit = {},
  withAuth = false,
): Promise<Response> {
  const url = resolveUrl(path);
  const origin =
    typeof window === 'undefined' ? 'http://localhost' : window.location.href;
  const base = new URL(API_BASE || '/', origin);
  const trustedUrl = new URL(url, base).origin === base.origin;
  const generation = sessionGeneration;
  const token = withAuth && trustedUrl ? getAccessToken() : null;
  const headers = new Headers(init.headers ?? {});
  headers.set('Accept', 'application/json');

  const hasBody = init.body !== undefined && init.body !== null;
  if (
    hasBody &&
    !headers.has('Content-Type') &&
    !(init.body instanceof FormData)
  ) {
    headers.set('Content-Type', 'application/json');
  }

  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(url, { ...init, headers });
  if (
    !token ||
    response.status !== 401 ||
    !/^Bearer(?:\s|$)/i.test(response.headers.get('WWW-Authenticate') ?? '') ||
    /\/auth\/(?:login|signup|refresh|logout)(?:[?#]|$)/.test(url) ||
    generation !== sessionGeneration ||
    init.signal?.aborted ||
    (typeof ReadableStream !== 'undefined' &&
      init.body instanceof ReadableStream)
  )
    return response;

  if (_accessToken === token && !(await refreshAccessToken())) return response;
  if (generation !== sessionGeneration || !_accessToken || init.signal?.aborted)
    return response;
  headers.set('Authorization', `Bearer ${_accessToken}`);
  return fetch(url, { ...init, headers });
}

export async function apiJson<T>(
  path: string,
  init: RequestInit = {},
  withAuth = false,
): Promise<T> {
  const res = await apiFetch(path, init, withAuth);
  if (!res.ok) throw new Error(await readErrorMessage(res));
  return (await res.json()) as T;
}

export async function readErrorMessage(response: Response): Promise<string> {
  try {
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const data = (await response.json()) as {
        detail?:
          | string
          | Array<{ msg?: string }>
          | { message?: string; code?: string };
        message?: string;
        error?: string;
      };
      if (typeof data?.detail === 'string') return data.detail;
      if (Array.isArray(data?.detail) && data.detail.length > 0) {
        const msgs = data.detail
          .map(d => (typeof d === 'object' && d?.msg ? d.msg : String(d)))
          .filter((m): m is string => typeof m === 'string');
        return msgs.length > 0 ? msgs.join('; ') : 'Validation error';
      }
      if (
        typeof data?.detail === 'object' &&
        'message' in data.detail &&
        typeof data.detail.message === 'string'
      ) {
        return (data.detail as { message?: string }).message ?? '';
      }
      if (typeof data?.message === 'string') return data.message ?? '';
      if (typeof data?.error === 'string') return data.error ?? '';
    }
    const text = await response.text();
    return text || `${response.status} ${response.statusText}`;
  } catch {
    return `${response.status} ${response.statusText}`;
  }
}

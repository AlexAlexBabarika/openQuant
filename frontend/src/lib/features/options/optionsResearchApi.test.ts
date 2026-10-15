import { afterEach, expect, it, vi } from 'vitest';
import { clearAccessToken, setAccessToken } from '$lib/core/api';
import {
  getChainStatus,
  getChainExpirations,
  getOptionChain,
  evaluateLifecycle,
} from './optionsResearchApi';
import { createOptionsDraft } from './optionsTemplates';

afterEach(() => {
  clearAccessToken();
  vi.unstubAllGlobals();
});

it('authenticates chain requests, encodes query values and carries AbortSignal', async () => {
  const fetch = vi
    .fn()
    .mockImplementation(
      async () =>
        new Response('{}', { headers: { 'content-type': 'application/json' } }),
    );
  vi.stubGlobal('fetch', fetch);
  setAccessToken('test-only-placeholder');
  const signal = new AbortController().signal;
  await getChainStatus(signal);
  await getChainExpirations('XYZ/A', 'sandbox', signal);
  await getOptionChain('XYZ/A', '2026-12-18', 'production', signal);
  for (const [, init] of fetch.mock.calls) {
    expect(init.signal).toBe(signal);
    expect(init.headers.get('Authorization')).toBe(
      'Bearer test-only-placeholder',
    );
  }
  expect(fetch.mock.calls[1][0]).toContain(
    'symbol=XYZ%2FA&environment=sandbox',
  );
  expect(fetch.mock.calls[2][0]).toContain(
    'expiration=2026-12-18&environment=production',
  );
});

it('submits research JSON without attaching account credentials', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch', fetch);
  setAccessToken('test-only-placeholder');
  const signal = new AbortController().signal;
  const request = {
    analysis: createOptionsDraft(),
    path: { source: 'synthetic' as const, horizon_days: 30 },
  };
  await evaluateLifecycle(request, signal);
  const [url, init] = fetch.mock.calls[0];
  expect(url).toContain('/options/research/lifecycle');
  expect(init.method).toBe('POST');
  expect(JSON.parse(init.body)).toEqual(request);
  expect(init.signal).toBe(signal);
  expect(init.headers.has('Authorization')).toBe(false);
});

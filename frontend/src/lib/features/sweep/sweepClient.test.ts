import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpSweepClient } from './sweepClient';

afterEach(() => vi.unstubAllGlobals());

describe('sweep cancellation', () => {
  it('surfaces a rejected DELETE instead of pretending cancellation succeeded', async () => {
    const fetch = vi.fn(
      async () => new Response('Sweep not found', { status: 404 }),
    );
    vi.stubGlobal('fetch', fetch);
    await expect(httpSweepClient.cancel('s1')).rejects.toThrow(
      'Sweep not found',
    );
    expect(fetch).toHaveBeenCalledWith('/sweeps/s1', { method: 'DELETE' });
  });

  it('accepts successful cancellation without a JSON body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    await expect(httpSweepClient.cancel('s1')).resolves.toBeUndefined();
  });
});

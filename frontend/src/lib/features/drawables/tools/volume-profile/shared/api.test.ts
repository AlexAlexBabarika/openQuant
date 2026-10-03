import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeAvp } from '../avp/compute';
import { fetchVolumeProfile } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('AVP integer-second inclusion boundary', () => {
  const base = 1735689600;

  it.each([1, 4])(
    'preserves quarter-bar anchor inclusion with %i bars',
    async count => {
      const times = Array.from({ length: count }, (_, i) => base + i);
      const signal = new AbortController().signal;
      const fetchMock = vi.fn(async (url: string, _options: RequestInit) => {
        const query = new URL(url, 'http://localhost').searchParams;
        const start = Number(query.get('startTs'));
        expect(Number.isInteger(start)).toBe(true);
        return { ok: true, json: async () => times.filter(t => t >= start) };
      });
      vi.stubGlobal('fetch', fetchMock);

      for (const offset of [-0.25, 0, 0.25]) {
        const result = await computeAvp(
          {
            id: 'avp',
            type: 'avp',
            symbol: 'TEST',
            createdAt: 0,
            geometry: { time: base + offset },
            params: { rowSize: 1, vaPercent: 0.7 },
            style: {} as never,
          },
          {
            candles: [],
            provider: 'csv',
            symbol: 'TEST',
            interval: '1s',
            signal,
          },
        );
        expect(result).toEqual(times.filter(t => t >= base + offset));
        const [url, options] =
          fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
        expect(
          new URL(url, 'http://localhost').searchParams.get('startTs'),
        ).toBe(String(Math.ceil(base + offset)));
        expect(options).toEqual({ signal });
      }
    },
  );

  it('floors a fractional inclusive end and ceils the inclusive start', async () => {
    const fetchMock = vi.fn(async (_url: string, _options: RequestInit) => ({
      ok: true,
      json: async () => ({}),
    }));
    vi.stubGlobal('fetch', fetchMock);
    await fetchVolumeProfile(
      {
        provider: 'csv',
        symbol: 'TEST',
        interval: '1s',
        startTs: base + 0.25,
        endTs: base + 2.75,
        rowSize: 1,
        vaPercent: 0.7,
      },
      new AbortController().signal,
    );
    const query = new URL(fetchMock.mock.calls[0][0], 'http://localhost')
      .searchParams;
    expect(query.get('startTs')).toBe(String(base + 1));
    expect(query.get('endTs')).toBe(String(base + 2));
  });

  it('propagates route failures rather than returning a profile', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 409 })),
    );
    await expect(
      fetchVolumeProfile(
        {
          provider: 'yahoo',
          symbol: 'TEST',
          interval: '1d',
          startTs: base,
          rowSize: 1,
          vaPercent: 0.7,
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow('409');
  });
});

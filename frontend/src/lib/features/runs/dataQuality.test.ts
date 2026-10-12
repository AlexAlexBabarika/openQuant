import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearAccessToken, setAccessToken } from '$lib/core/api';
import {
  runWithQuality,
  validDataQuality,
  type DataQualityReport,
} from './dataQuality';

const quality = (): DataQualityReport => ({
  errors: [],
  warnings: [
    {
      code: 'calendar_unknown',
      message: 'Calendar unknown',
      column: null,
      count: 1,
      rows: [],
    },
  ],
  provenance: {
    provider: 'yfinance',
    interval: '1d',
    data_version: 'snapshot-v1',
    row_count: 120,
    start: '2020-01-01T00:00:00Z',
    end: '2020-04-29T00:00:00Z',
    timestamp_timezone: 'UTC',
    timestamp_unit: 'us',
    nominal_interval_seconds: 86400,
    calendar: 'unknown',
    adjustment: 'unknown',
    staleness: 'not_assessed',
    example_limit: 5,
  },
});
const params = { code: 'private source', symbol: 'TEST', provider: 'yfinance' };
afterEach(() => {
  vi.unstubAllGlobals();
  clearAccessToken();
});

describe('quality preview/execution integration', () => {
  it('preflights without source and passes exact preview identity before compute, retaining warnings', async () => {
    const report = quality();
    const fetch = vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.endsWith('quality-preview')
              ? { data_quality: report, data_version: 'snapshot-v1' }
              : { meta: { data_quality: report } },
          ),
        ),
    );
    vi.stubGlobal('fetch', fetch);
    const observe = vi.fn();
    await runWithQuality('/backtests/run', params, undefined, observe);
    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(JSON.parse(String(calls[0][1].body))).toEqual({
      symbol: 'TEST',
      provider: 'yfinance',
      period: '1y',
      interval: '1d',
    });
    expect(JSON.parse(String(calls[1][1].body))).toEqual({
      ...params,
      preview_data_version: 'snapshot-v1',
    });
    expect(observe).toHaveBeenCalledWith(report);
  });

  it('blocks before compute on preview errors', async () => {
    const report = quality();
    report.errors = [
      {
        code: 'nonmonotonic_timestamp',
        message: 'Original order invalid',
        column: 'timestamp',
        count: 1,
        rows: [1],
      },
    ];
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ data_quality: report, data_version: 'snapshot-v1' }),
        ),
    );
    vi.stubGlobal('fetch', fetch);
    const observe = vi.fn();
    await expect(
      runWithQuality('/backtests/robustness', params, undefined, observe),
    ).rejects.toThrow('block execution');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledWith(report);
  });

  it('continues an uncached preview only with execution-side inspection, never an invented preview', async () => {
    const fetch = vi.fn(async (url: string) =>
      url.endsWith('quality-preview')
        ? new Response('', { status: 404 })
        : new Response('{}'),
    );
    vi.stubGlobal('fetch', fetch);
    const observe = vi.fn();
    await runWithQuality('/backtests/run', params, undefined, observe);
    expect(observe).toHaveBeenCalledWith(null);
    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(JSON.parse(String(calls[1][1].body))).not.toHaveProperty(
      'preview_data_version',
    );
  });

  it('surfaces invalidation and updated evidence rather than silently retrying compute', async () => {
    const report = quality();
    const fetch = vi.fn(async (url: string) =>
      url.endsWith('quality-preview')
        ? new Response(
            JSON.stringify({
              data_quality: report,
              data_version: 'snapshot-v1',
            }),
          )
        : new Response(
            JSON.stringify({
              detail: {
                message: 'Dataset changed. Preview again.',
                data_quality: report,
              },
            }),
            { status: 409, headers: { 'Content-Type': 'application/json' } },
          ),
    );
    vi.stubGlobal('fetch', fetch);
    const observe = vi.fn();
    await expect(
      runWithQuality('/backtests/run', params, undefined, observe),
    ).rejects.toThrow('Dataset changed');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(observe).toHaveBeenCalledTimes(2);
  });

  it('never posts source under a different account after awaiting preview', async () => {
    const fetch = vi.fn(async () => {
      setAccessToken('account-b');
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetch);
    await expect(runWithQuality('/backtests/run', params)).rejects.toThrow(
      'Account changed',
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects extra/source keys, malformed diagnostics and nonfinite counts', () => {
    expect(validDataQuality(quality())).toBe(true);
    expect(validDataQuality({ ...quality(), source: 'private' })).toBe(false);
    expect(
      validDataQuality({
        ...quality(),
        provenance: { ...quality().provenance, row_count: Infinity },
      }),
    ).toBe(false);
    expect(
      validDataQuality({
        ...quality(),
        warnings: [{ ...quality().warnings[0], source: 'private' }],
      }),
    ).toBe(false);
    expect(
      validDataQuality({
        ...quality(),
        warnings: [{ ...quality().warnings[0], rows: [-1] }],
      }),
    ).toBe(false);
  });
});

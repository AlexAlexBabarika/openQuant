import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  makeRunsClient,
  RunNotFoundError,
  RerunFailedError,
} from './runsClient';
import { clearAccessToken } from '$lib/core/api';
import { deferred } from '$lib/features/chart/reactiveTestSupport';

function res(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => vi.restoreAllMocks());

describe('runsClient', () => {
  it.each([
    'getRun',
    'compareRuns',
    'rerunRun',
    'notebookMetadata',
    'saveNotebook',
  ] as const)(
    '%s rejects a body completed after the session changes',
    async operation => {
      const body = deferred<never>();
      const response = res(200, {});
      const read = vi.fn(() => body.promise);
      response.json = read;
      response.text = read;
      const client = makeRunsClient(vi.fn().mockResolvedValue(response));
      const request =
        operation === 'getRun'
          ? client.getRun('old')
          : operation === 'compareRuns'
            ? client.compareRuns('old', 'other')
            : operation === 'rerunRun'
              ? client.rerunRun('old')
              : client.notebookMetadata(
                  operation === 'saveNotebook'
                    ? JSON.stringify({
                        format: 'openquant-notebook-metadata',
                        version: 1,
                        entries: [],
                      })
                    : undefined,
                );
      await Promise.resolve();
      expect(read).toHaveBeenCalledOnce();
      clearAccessToken();
      body.resolve(
        operation === 'notebookMetadata' || operation === 'saveNotebook'
          ? (JSON.stringify({
              format: 'openquant-notebook-metadata',
              version: 1,
              entries: [],
            }) as never)
          : ({} as never),
      );
      await expect(request).rejects.toThrow('Account changed');
    },
  );

  it.each(['get', 'compare', 'rerun', 'restore', 'backup'])(
    '%s asks for sign-in instead of exposing a raw authorization error',
    async action => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(
          res(401, { detail: 'Missing Authorization header' }),
        );
      const c = makeRunsClient(fetchImpl);
      const operations: Record<string, () => Promise<unknown>> = {
        get: () => c.getRun('x'),
        compare: () => c.compareRuns('x', 'y'),
        rerun: () => c.rerunRun('x'),
        restore: () => c.notebookMetadata(),
        backup: () =>
          c.notebookMetadata(
            JSON.stringify({
              format: 'openquant-notebook-metadata',
              version: 1,
              entries: [],
            }),
          ),
      };
      await expect(operations[action]()).rejects.toThrow(
        'Sign in again to access account-private saved research.',
      );
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it('getRun returns the blob on 200', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(res(200, { meta: { run_id: 'x' } }));
    const c = makeRunsClient(fetchImpl);
    const blob = (await c.getRun('x')) as { meta: { run_id: string } };
    expect(blob.meta.run_id).toBe('x');
    expect(fetchImpl).toHaveBeenCalledWith('/backtests/runs/x', {}, true);
  });

  it('getRun throws RunNotFoundError on 404', async () => {
    const c = makeRunsClient(
      vi.fn().mockResolvedValue(res(404, { detail: 'run x not found' })),
    );
    await expect(c.getRun('x')).rejects.toBeInstanceOf(RunNotFoundError);
  });

  it('compareRuns returns the diff on 200', async () => {
    const diff = {
      inputs_diff: [],
      metrics_diff: [],
      equity_overlay: { a: [], b: [], residual: [] },
      trades_diff: { changed: [], unchanged: [], only_in_a: [], only_in_b: [] },
      status: { a: {}, b: {} },
    };
    const c = makeRunsClient(vi.fn().mockResolvedValue(res(200, diff)));
    expect(await c.compareRuns('a', 'b')).toEqual(diff);
  });

  it('rerunRun throws RerunFailedError(message) on 422', async () => {
    const c = makeRunsClient(
      vi
        .fn()
        .mockResolvedValue(res(422, { detail: 'rerun failed (error): boom' })),
    );
    const err = await c.rerunRun('x').catch(e => e);
    expect(err).toBeInstanceOf(RerunFailedError);
    expect((err as Error).message).toBe('rerun failed (error): boom');
  });
});

import { apiFetch, readErrorMessage } from '$lib/core/api';
import type { RunDiff, RerunResponse } from './runTypes';
import {
  parseNotebookMetadata,
  serializeNotebookMetadata,
} from './notebookMetadata';

export class RunNotFoundError extends Error {}
export class RerunFailedError extends Error {}

type FetchImpl = typeof apiFetch;

export function makeRunsClient(fetchImpl: FetchImpl) {
  async function notebookMetadata(json?: string): Promise<string> {
    const res = await fetchImpl(
      '/backtests/runs/notebook/metadata',
      json === undefined
        ? {}
        : {
            method: 'PUT',
            body: serializeNotebookMetadata(parseNotebookMetadata(json)),
          },
      true,
    );
    if (!res.ok) throw new Error(await readErrorMessage(res));
    return serializeNotebookMetadata(parseNotebookMetadata(await res.text()));
  }
  async function getRun(id: string): Promise<unknown> {
    const res = await fetchImpl(`/backtests/runs/${id}`, {}, true);
    if (res.status === 404)
      throw new RunNotFoundError(await readErrorMessage(res));
    if (!res.ok) throw new Error(await readErrorMessage(res));
    return res.json();
  }

  async function compareRuns(a: string, b: string): Promise<RunDiff> {
    const res = await fetchImpl(`/backtests/runs/${a}/compare/${b}`, {}, true);
    if (res.status === 404)
      throw new RunNotFoundError(await readErrorMessage(res));
    if (!res.ok) throw new Error(await readErrorMessage(res));
    return (await res.json()) as RunDiff;
  }

  async function rerunRun(id: string): Promise<RerunResponse> {
    const res = await fetchImpl(
      `/backtests/runs/${id}/rerun`,
      { method: 'POST' },
      true,
    );
    if (res.status === 404)
      throw new RunNotFoundError(await readErrorMessage(res));
    if (res.status === 422)
      throw new RerunFailedError(await readErrorMessage(res));
    if (!res.ok) throw new Error(await readErrorMessage(res));
    return (await res.json()) as RerunResponse;
  }

  return { getRun, compareRuns, rerunRun, notebookMetadata };
}

export type RunsClient = ReturnType<typeof makeRunsClient>;
export const runsClient: RunsClient = makeRunsClient(apiFetch);

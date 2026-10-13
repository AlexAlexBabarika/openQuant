import { runsClient, type RunsClient } from './runsClient';
import { getSessionGeneration } from '$lib/core/api';

/** A BacktestState loader that fetches a stored run by id. */
export function storedRunLoader(
  id: string,
  client: RunsClient = runsClient,
): () => Promise<unknown> {
  const generation = getSessionGeneration();
  return async () => {
    if (generation !== getSessionGeneration())
      throw new Error('Account changed. Open the run again.');
    try {
      return await client.getRun(id);
    } finally {
      if (generation !== getSessionGeneration())
        throw new Error('Account changed. Open the run again.');
    }
  };
}

import { runsClient, type RunsClient } from '$lib/features/runs/runsClient';
import type { RerunResponse } from '$lib/features/runs/runTypes';

export class RerunState {
  running = $state(false);
  error = $state<string | null>(null);
  #client: Pick<RunsClient, 'rerunRun'>;
  #sequence = 0;

  constructor(client: Pick<RunsClient, 'rerunRun'> = runsClient) {
    this.#client = client;
  }

  reset(): void {
    ++this.#sequence;
    this.running = false;
    this.error = null;
  }

  async run(id: string): Promise<RerunResponse | null> {
    if (this.running) return null;
    const sequence = ++this.#sequence;
    this.running = true;
    this.error = null;
    try {
      const response = await this.#client.rerunRun(id);
      return sequence === this.#sequence ? response : null;
    } catch (error) {
      if (sequence !== this.#sequence) return null;
      this.error = error instanceof Error ? error.message : 'Rerun failed';
      return null;
    } finally {
      if (sequence === this.#sequence) this.running = false;
    }
  }
}

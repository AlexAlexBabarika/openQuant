import { runsClient, type RunsClient } from './runsClient';
import type { RunDiff } from './runTypes';

export class CompareState {
  a = $state<string | null>(null);
  b = $state<string | null>(null);
  diff = $state<RunDiff | null>(null);
  loading = $state(false);
  error = $state<string | null>(null);
  #client: RunsClient;
  #sequence = 0;

  constructor(client: RunsClient = runsClient) {
    this.#client = client;
  }

  async load(a: string, b: string): Promise<void> {
    const sequence = ++this.#sequence;
    this.a = a;
    this.b = b;
    this.loading = true;
    this.error = null;
    this.diff = null;
    try {
      const diff = await this.#client.compareRuns(a, b);
      if (sequence === this.#sequence) this.diff = diff;
    } catch (e) {
      if (sequence !== this.#sequence) return;
      this.diff = null;
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      if (sequence === this.#sequence) this.loading = false;
    }
  }

  setDiff(a: string, b: string, diff: RunDiff): void {
    ++this.#sequence;
    this.a = a;
    this.b = b;
    this.diff = diff;
    this.error = null;
    this.loading = false;
  }
}

export const compareState = new CompareState();

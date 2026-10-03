/**
 * Sweep dashboard state: the param schema/form, the running sweep's progress, the
 * trials seen so far, and the best trial. Mirrors `BacktestState`'s runes shape.
 *
 * `run()` starts a sweep and polls until it reaches a terminal status. The client
 * and poll interval are injectable so tests can stub the network and poll with no
 * delay.
 */
import { httpSweepClient } from './sweepClient';
import type { BacktestResult } from '$lib/features/backtest/types';
import type {
  ParamSchema,
  SweepClient,
  SweepFormValues,
  SweepProgress,
  TrialRow,
} from './types';

type Status = 'idle' | 'running' | 'done' | 'error' | 'cancelled';
type PendingSweep = { id: string | null; cancelRequested: boolean };

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class SweepState {
  schema = $state<ParamSchema>({});
  schemaLoading = $state(false);
  schemaError = $state<string | null>(null);
  status = $state<Status>('idle');
  total = $state(0);
  done = $state(0);
  trials = $state<TrialRow[]>([]);
  bestTrialId = $state<number | null>(null);
  error = $state<string | null>(null);
  sweepId = $state<string | null>(null);
  cancelling = $state(false);
  cancelError = $state<string | null>(null);

  #client: SweepClient;
  #interval: number;
  #schemaSequence = 0;
  #active: PendingSweep | null = null;

  constructor(client: SweepClient = httpSweepClient, pollIntervalMs = 1000) {
    this.#client = client;
    this.#interval = pollIntervalMs;
  }

  async loadSchema(code: string): Promise<void> {
    const sequence = ++this.#schemaSequence;
    this.schema = {};
    this.schemaLoading = true;
    this.schemaError = null;
    try {
      const schema = await this.#client.schema(code);
      if (sequence === this.#schemaSequence) this.schema = schema;
    } catch (err) {
      if (sequence === this.#schemaSequence) {
        this.schemaError =
          err instanceof Error ? err.message : 'Failed to load parameters';
      }
    } finally {
      if (sequence === this.#schemaSequence) this.schemaLoading = false;
    }
  }

  async run(form: SweepFormValues): Promise<void> {
    const active: PendingSweep = { id: null, cancelRequested: false };
    this.#active = active;
    this.status = 'running';
    this.error = null;
    this.cancelError = null;
    this.cancelling = false;
    this.sweepId = null;
    this.total = 0;
    this.trials = [];
    this.done = 0;
    this.bestTrialId = null;
    try {
      const { sweep_id } = await this.#client.start(form);
      if (this.#active !== active) {
        await this.#client.cancel(sweep_id);
        return;
      }
      active.id = sweep_id;
      this.sweepId = sweep_id;
      if (active.cancelRequested) await this.#cancel(active);
      while (this.#active === active) {
        const p: SweepProgress = await this.#client.poll(sweep_id);
        if (this.#active !== active) return;
        this.#apply(p);
        if (p.status !== 'running') break;
        if (this.#interval > 0) await sleep(this.#interval);
      }
    } catch (err) {
      if (this.#active !== active) return;
      this.status = 'error';
      this.error = err instanceof Error ? err.message : 'Sweep failed';
    } finally {
      if (this.#active === active) {
        this.#active = null;
        this.cancelling = false;
      }
    }
  }

  async cancel(): Promise<void> {
    const active = this.#active;
    if (!active || this.cancelling) return;
    active.cancelRequested = true;
    this.cancelling = true;
    this.cancelError = null;
    if (active.id) await this.#cancel(active);
  }

  async #cancel(active: PendingSweep): Promise<void> {
    try {
      await this.#client.cancel(active.id!);
    } catch (err) {
      if (this.#active !== active) return;
      active.cancelRequested = false;
      this.cancelling = false;
      this.cancelError =
        err instanceof Error ? err.message : 'Cancellation failed';
    }
  }

  trialLoader(
    trialId: number,
    form: SweepFormValues,
  ): () => Promise<BacktestResult> {
    const id = this.sweepId;
    if (!id) throw new Error('No sweep is available');
    const snapshot = {
      ...form,
      vary: [...form.vary],
      ...(form.fixed ? { fixed: { ...form.fixed } } : {}),
    };
    return () => this.#client.loadTrial(id, trialId, snapshot);
  }

  #apply(p: SweepProgress): void {
    this.status = p.status;
    this.total = p.total;
    this.done = p.done;
    this.trials = p.trials;
    this.bestTrialId = p.best_trial_id;
    this.error = p.error;
  }
}

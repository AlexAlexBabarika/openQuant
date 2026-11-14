import { untrack } from 'svelte';
import {
  emptyResearchState,
  ResearchJob,
  type ResearchCopy,
  type ResearchState,
} from './optionsRequest';

export interface ResearchRunOptions<R> {
  documentKey: () => string;
  /** Everything the request depends on; a result is stale once this moves on. */
  inputKey: () => string;
  copy?: Partial<ResearchCopy<R>>;
}

/**
 * A research tool's explicit request and its submitted evidence, as reactive state.
 * Evidence is only visible for the document it was submitted under.
 */
export class ResearchRun<Q, R> {
  #state = $state.raw<ResearchState<R, Q>>(emptyResearchState(''));
  #job: ResearchJob<Q, R>;
  #options: ResearchRunOptions<R>;

  constructor(options: ResearchRunOptions<R>) {
    this.#options = options;
    const documentKey = untrack(options.documentKey);
    this.#state = emptyResearchState(documentKey);
    this.#job = new ResearchJob<Q, R>(
      documentKey,
      options.documentKey,
      next => (this.#state = next),
      options.inputKey,
      options.copy,
    );
  }

  get #visible(): ResearchState<R, Q> | null {
    return this.#state.documentKey === this.#options.documentKey()
      ? this.#state
      : null;
  }
  get result(): R | null {
    return this.#visible?.result ?? null;
  }
  get submitted(): Q | null {
    return this.#visible?.submitted ?? null;
  }
  get pending(): boolean {
    return this.#visible?.pending ?? false;
  }
  get stale(): boolean {
    const visible = this.#visible;
    return (
      !!visible?.result && visible.submittedKey !== this.#options.inputKey()
    );
  }
  get error(): string {
    return this.#visible?.error ?? '';
  }
  set error(error: string) {
    this.#job.note({ error });
  }
  get notice(): string {
    return this.#visible?.notice ?? '';
  }
  set notice(notice: string) {
    this.#job.note({ notice });
  }

  submit(
    request: Q,
    call: (request: Q, signal: AbortSignal) => Promise<R>,
    validate?: (result: R) => boolean | string | null,
  ): Promise<void> {
    return this.#job.submit(
      request,
      untrack(this.#options.inputKey),
      call,
      validate,
    );
  }
  cancel(): void {
    this.#job.cancel();
  }
  inputsChanged(): void {
    this.#job.inputsChanged();
  }
  documentChanged(): void {
    this.#job.reset(untrack(this.#options.documentKey));
  }
  dispose(): void {
    this.#job.reset('unmounted');
  }
}

/**
 * A ResearchRun bound to the calling component: it resets at a document boundary
 * (then runs `onDocumentChange` so the tool can reset its own settings), drops a
 * pending request when its inputs or read-only mode change, and stops on unmount.
 */
export function useResearchRun<Q, R>(
  options: ResearchRunOptions<R> & {
    readOnly?: () => boolean;
    onDocumentChange?: () => void;
  },
): ResearchRun<Q, R> {
  const run = new ResearchRun<Q, R>(options);
  $effect.pre(() => {
    options.documentKey();
    untrack(() => {
      run.documentChanged();
      options.onDocumentChange?.();
    });
  });
  $effect(() => {
    options.inputKey();
    options.readOnly?.();
    untrack(() => run.inputsChanged());
  });
  $effect(() => () => run.dispose());
  return run;
}

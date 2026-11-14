import { getSessionGeneration } from '$lib/core/api';

const REQUEST_TIMEOUT_MS = 15000;

/**
 * One request at a time. A reply counts only while its flight is the newest and its
 * account session and key are unchanged, so a transport that ignores abort still
 * cannot publish late.
 */
export class RequestFlight {
  private generation = 0;
  private controller: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  cancel(): void {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  start(key: () => string, onTimeout: () => void) {
    this.cancel();
    const generation = this.generation;
    const session = getSessionGeneration();
    const submittedKey = key();
    const controller = (this.controller = new AbortController());
    const current = () =>
      generation === this.generation &&
      session === getSessionGeneration() &&
      key() === submittedKey &&
      !controller.signal.aborted;
    this.timer = setTimeout(() => {
      if (current()) {
        this.cancel();
        onTimeout();
      }
    }, REQUEST_TIMEOUT_MS);
    return {
      signal: controller.signal,
      current,
      finish: () => {
        if (generation === this.generation && this.timer !== null) {
          clearTimeout(this.timer);
          this.timer = null;
        }
      },
    };
  }
}

export interface ResearchState<R, Q = unknown> {
  documentKey: string;
  result: R | null;
  /** The frozen request the result answers. */
  submitted: Q | null;
  submittedKey: string;
  pending: boolean;
  error: string;
  notice: string;
}
export const emptyResearchState = <R, Q = unknown>(
  documentKey: string,
): ResearchState<R, Q> => ({
  documentKey,
  result: null,
  submitted: null,
  submittedKey: '',
  pending: false,
  error: '',
  notice: '',
});
export function researchError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (/timeout|timed out/.test(message))
    return 'Research timed out. Reduce path steps or retry explicitly.';
  if (/too large|oversize|size limit/.test(message))
    return 'Research exceeds the request/output limit. Reduce path steps.';
  if (/rate limit|too many|saturat/.test(message))
    return 'Research is busy or rate limited. Retry explicitly later.';
  return 'Research request failed. Inputs are retained. Check the draft/path and retry; the research endpoint may be unavailable.';
}

/** The sentences a tool shows for each lifecycle outcome. */
export interface ResearchCopy<R = unknown> {
  cancelled: string;
  /** Shown when a pending request is dropped because its inputs moved on. */
  inputsChanged: string;
  timedOut: string;
  failed: (error: unknown) => string;
  submitted: (result: R) => string;
}
const DEFAULT_COPY: ResearchCopy = {
  cancelled:
    'Cancelled. Previous submitted evidence, if any, is unchanged. Browser abort does not guarantee server computation stopped.',
  inputsChanged:
    'Cancelled. Previous submitted evidence, if any, is unchanged. Browser abort does not guarantee server computation stopped.',
  timedOut:
    'Research timed out after 15 seconds. Reduce path steps and retry explicitly.',
  failed: researchError,
  submitted: () =>
    'Submitted evidence · session only. Values below use the returned request, not live inputs.',
};

function freezeSnapshot<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeSnapshot);
    Object.freeze(value);
  }
  return value;
}

/**
 * One explicit research request and the evidence it returned. No result may cross a
 * document/account boundary or outlive its inputs, even if abort is ignored.
 */
export class ResearchJob<Q, R> {
  state: ResearchState<R, Q>;
  #flight = new RequestFlight();
  #copy: ResearchCopy<R>;
  constructor(
    documentKey: string,
    private currentDocument: () => string,
    private publish: (state: ResearchState<R, Q>) => void,
    private currentInput?: () => string,
    copy: Partial<ResearchCopy<R>> = {},
  ) {
    this.state = emptyResearchState(documentKey);
    this.#copy = {
      ...DEFAULT_COPY,
      ...(copy.cancelled && !copy.inputsChanged
        ? { inputsChanged: copy.cancelled }
        : {}),
      ...copy,
    };
  }
  /** Tool-authored feedback (a validation error, an "applied" notice). */
  note(patch: { error?: string; notice?: string }): void {
    this.#update(patch);
  }
  #update(patch: Partial<ResearchState<R, Q>>): void {
    this.state = { ...this.state, ...patch };
    this.publish(this.state);
  }
  reset(documentKey: string): void {
    this.#flight.cancel();
    this.state = emptyResearchState(documentKey);
    this.publish(this.state);
  }
  cancel(): void {
    this.#stop(this.#copy.cancelled);
  }
  /** Drops a pending request whose inputs moved on; settled evidence just goes stale. */
  inputsChanged(): void {
    if (this.state.pending) this.#stop(this.#copy.inputsChanged);
  }
  #stop(notice: string): void {
    this.#flight.cancel();
    this.#update({ pending: false, error: '', notice });
  }
  async submit(
    request: Q,
    key: string,
    call: (request: Q, signal: AbortSignal) => Promise<R>,
    /** `false` or a message rejects the response; a message is shown as the error. */
    validate: (result: R) => boolean | string | null = () => true,
  ): Promise<void> {
    const flight = this.#flight.start(
      () => this.currentDocument(),
      () =>
        this.#update({
          pending: false,
          notice: '',
          error: this.#copy.timedOut,
        }),
    );
    const documentKey = this.currentDocument();
    if (this.state.documentKey !== documentKey) {
      this.state = emptyResearchState(documentKey);
    }
    const snapshot = freezeSnapshot(structuredClone(request));
    this.#update({ pending: true, error: '', notice: '', documentKey });
    const current = () =>
      flight.current() && (!this.currentInput || key === this.currentInput());
    try {
      const result = await call(snapshot, flight.signal);
      if (!current()) return;
      const verdict = validate(result);
      if (verdict === false) throw new Error('Invalid research response');
      if (typeof verdict === 'string' && verdict) {
        this.#update({ error: verdict });
        return;
      }
      this.#update({
        result,
        submitted: snapshot,
        submittedKey: key,
        notice: this.#copy.submitted(result),
      });
    } catch (error) {
      if (current()) this.#update({ error: this.#copy.failed(error) });
    } finally {
      flight.finish();
      if (current()) this.#update({ pending: false });
    }
  }
}

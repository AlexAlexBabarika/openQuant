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

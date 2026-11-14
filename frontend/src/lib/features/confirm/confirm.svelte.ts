export interface ConfirmRequest {
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
  /** Notice with a single dismiss button; resolves once dismissed. */
  acknowledge?: boolean;
}

class ConfirmState {
  request = $state<ConfirmRequest | null>(null);
  #resolve: ((confirmed: boolean) => void) | null = null;

  ask(request: ConfirmRequest): Promise<boolean> {
    this.settle(false);
    this.request = request;
    return new Promise(resolve => (this.#resolve = resolve));
  }

  settle(confirmed: boolean): void {
    const resolve = this.#resolve;
    this.#resolve = null;
    this.request = null;
    resolve?.(confirmed);
  }
}

export const confirmState = new ConfirmState();

export function confirmAction(request: ConfirmRequest): Promise<boolean> {
  return confirmState.ask(request);
}

/** Resolves true when nothing is unsaved or the user agrees to discard it. */
export async function confirmDiscard(
  dirty: boolean,
  kind: string,
): Promise<boolean> {
  if (!dirty) return true;
  return confirmAction({
    title: `Discard unsaved ${kind} changes?`,
    description: 'The current editor contents will be replaced.',
    confirmLabel: 'Discard changes',
    destructive: true,
  });
}

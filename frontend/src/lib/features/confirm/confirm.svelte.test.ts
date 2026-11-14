import { describe, expect, it } from 'vitest';
import { confirmAction, confirmDiscard, confirmState } from './confirm.svelte';

describe('confirm requests', () => {
  it('resolves with the settled answer and clears the request', async () => {
    const answer = confirmAction({ title: 'Delete?' });
    expect(confirmState.request?.title).toBe('Delete?');
    confirmState.settle(true);
    await expect(answer).resolves.toBe(true);
    expect(confirmState.request).toBeNull();
  });

  it('cancels a pending request when a newer one replaces it', async () => {
    const first = confirmAction({ title: 'First' });
    const second = confirmAction({ title: 'Second' });
    await expect(first).resolves.toBe(false);
    expect(confirmState.request?.title).toBe('Second');
    confirmState.settle(false);
    await expect(second).resolves.toBe(false);
  });

  it('skips the prompt when nothing is unsaved', async () => {
    await expect(confirmDiscard(false, 'strategy')).resolves.toBe(true);
    expect(confirmState.request).toBeNull();
    const answer = confirmDiscard(true, 'strategy');
    expect(confirmState.request?.title).toBe(
      'Discard unsaved strategy changes?',
    );
    confirmState.settle(true);
    await expect(answer).resolves.toBe(true);
  });
});

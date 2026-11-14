import { describe, expect, it, vi } from 'vitest';
import { client, clientModule } from '../chart/reactiveTestSupport';
import * as request from './optionsRequest';
import type { ResearchRun } from './optionsResearchRun.svelte';

// Effects only run in Svelte's client runtime, so load the module through it.
const { useResearchRun } = clientModule<
  typeof import('./optionsResearchRun.svelte')
>(new URL('./optionsResearchRun.svelte.ts', import.meta.url), {
  './optionsRequest': request,
});
const flushSync = client.flush;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => (resolve = res));
  return { promise, resolve };
}

function mount() {
  const context = client.proxy({
    document: 'doc:1',
    input: 'a',
    readOnly: false,
  });
  const onDocumentChange = vi.fn();
  let run!: ResearchRun<{ n: number }, number>;
  const unmount = client.effect_root(() => {
    run = useResearchRun<{ n: number }, number>({
      documentKey: () => context.document,
      inputKey: () => context.input,
      readOnly: () => context.readOnly,
      copy: { inputsChanged: 'inputs changed', submitted: () => '' },
      onDocumentChange,
    });
  });
  flushSync();
  return { context, run, onDocumentChange, unmount };
}

describe('research run bound to a tool', () => {
  it('marks evidence stale when inputs move on, without discarding it', async () => {
    const { context, run, unmount } = mount();
    await run.submit({ n: 1 }, async () => 42);
    expect(run.result).toBe(42);
    expect(run.submitted).toEqual({ n: 1 });
    expect(run.stale).toBe(false);
    context.input = 'b';
    flushSync();
    expect(run.result).toBe(42);
    expect(run.stale).toBe(true);
    unmount();
  });

  it.each(['input', 'readOnly'] as const)(
    'drops a pending request when %s changes and ignores its late reply',
    async change => {
      const { context, run, unmount } = mount();
      const reply = deferred<number>();
      const task = run.submit({ n: 1 }, () => reply.promise);
      expect(run.pending).toBe(true);
      if (change === 'input') context.input = 'b';
      else context.readOnly = true;
      flushSync();
      expect(run.pending).toBe(false);
      expect(run.notice).toBe('inputs changed');
      reply.resolve(42);
      await task;
      expect(run.result).toBeNull();
      unmount();
    },
  );

  it('hides evidence at a document boundary and lets the tool reset its settings', async () => {
    const { context, run, onDocumentChange, unmount } = mount();
    expect(onDocumentChange).toHaveBeenCalledTimes(1);
    await run.submit({ n: 1 }, async () => 42);
    run.notice = 'applied';
    context.document = 'doc:2';
    expect(run.result).toBeNull();
    expect(run.notice).toBe('');
    flushSync();
    expect(onDocumentChange).toHaveBeenCalledTimes(2);
    expect(run.result).toBeNull();
    expect(run.stale).toBe(false);
    unmount();
  });

  it('stops a pending request on unmount', async () => {
    const { run, unmount } = mount();
    let signal!: AbortSignal;
    const reply = deferred<number>();
    const task = run.submit({ n: 1 }, (_, s) => {
      signal = s;
      return reply.promise;
    });
    unmount();
    expect(signal.aborted).toBe(true);
    reply.resolve(42);
    await task;
    expect(run.result).toBeNull();
  });
});

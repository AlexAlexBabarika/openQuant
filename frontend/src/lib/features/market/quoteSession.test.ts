import { readFileSync } from 'node:fs';
import { parse } from 'svelte/compiler';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

function setup(source: string) {
  const app = readFileSync(
    new URL('../../../App.svelte', import.meta.url),
    'utf8',
  );
  const ast = parse(app, { modern: true });
  const sourceOf = (node: unknown) => {
    const { start, end } = node as { start: number; end: number };
    return app.slice(start, end);
  };
  const effect = ast.instance!.content.body.find(
    node =>
      node.type === 'ExpressionStatement' &&
      node.expression.type === 'CallExpression' &&
      node.expression.callee.type === 'Identifier' &&
      node.expression.callee.name === '$effect' &&
      sourceOf(node).includes('subscribeQuoteStream'),
  )!;
  const expression =
    effect.type === 'ExpressionStatement' &&
    effect.expression.type === 'CallExpression'
      ? effect.expression.arguments[0]
      : null;
  if (!expression) throw new Error('Quote effect missing');
  const compiled = ts.transpileModule(
    `
    let tickerQuotes = {};
    let quoteUserId = $authState.user?.id ?? null;
    return { start: ${sourceOf(expression)}, read: () => tickerQuotes };
  `,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const auth = { user: { id: 'user-1' } as { id: string } | null };
  const chart = { source };
  const unsubs: Array<ReturnType<typeof vi.fn>> = [];
  const prices: Array<(price: number) => void> = [];
  let resolve!: (price: number | null) => void;
  let reject!: (error: Error) => void;
  const fetchLastClose = vi.fn(
    () =>
      new Promise<number | null>((done, fail) => {
        resolve = done;
        reject = fail;
      }),
  );
  const subscribeQuoteStream = vi.fn((_symbol, _source, callback) => {
    prices.push(callback);
    const unsub = vi.fn();
    unsubs.push(unsub);
    return unsub;
  });
  const host = new Function(
    'chart',
    'displayTickers',
    '$authState',
    'untrack',
    'providerSupportsQuoteStream',
    'subscribeQuoteStream',
    'fetchLastClose',
    compiled,
  )(
    chart,
    [{ symbol: 'AAPL' }],
    auth,
    (read: () => unknown) => read(),
    (provider: string) => provider === 'binance',
    subscribeQuoteStream,
    fetchLastClose,
  ) as {
    start: () => (() => void) | undefined;
    read: () => Record<string, unknown>;
  };
  return {
    host,
    auth,
    chart,
    prices,
    unsubs,
    fetchLastClose,
    resolve: (price: number | null) => resolve(price),
    reject: (error: Error) => reject(error),
  };
}

describe('App quote session effect', () => {
  it.each(['success', 'failure'])(
    'ignores delayed private quote %s after account change',
    async outcome => {
      const state = setup('twelvedata');
      state.host.start();
      state.auth.user = { id: 'user-2' };
      if (outcome === 'success') state.resolve(999);
      else state.reject(new Error('old account'));
      await new Promise(done => setTimeout(done, 0));
      expect(state.host.read()['twelvedata:AAPL']).toEqual({
        status: 'loading',
      });
    },
  );

  it('ignores queued ticks immediately after logout and unsubscribes on effect cleanup', () => {
    const state = setup('binance');
    const cleanup = state.host.start();
    state.auth.user = null;
    state.prices[0](999);
    expect(state.host.read()['binance:AAPL']).toEqual({ status: 'loading' });
    cleanup?.();
    expect(state.unsubs[0]).toHaveBeenCalledOnce();
  });

  it('restarts cancelled REST requests instead of leaving quotes permanently loading', () => {
    const state = setup('twelvedata');
    const cleanup = state.host.start();
    cleanup?.();
    state.host.start();
    expect(state.fetchLastClose).toHaveBeenCalledTimes(2);
  });

  it('does not reuse the previous account quote cache when the effect restarts', async () => {
    const state = setup('twelvedata');
    const cleanup = state.host.start();
    state.resolve(100);
    await new Promise(done => setTimeout(done, 0));
    cleanup?.();
    state.auth.user = { id: 'user-2' };
    state.host.start();
    expect(state.host.read()['twelvedata:AAPL']).toEqual({ status: 'loading' });
    expect(state.fetchLastClose).toHaveBeenCalledTimes(2);
  });
});

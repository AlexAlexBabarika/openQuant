import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { render } from 'svelte/server';
import BacktestPanel from '../../../components/backtest/BacktestPanel.svelte';
import { BacktestState } from './backtestState.svelte';
import sample from './fixtures/sample-run.json';
import { loadResult } from './loadResult';
import { tradeSelection, drawdownSelection } from './resultSelection';
import { client, clientModule } from '../chart/reactiveTestSupport';

describe('empty backtest results', () => {
  it('reserves a separate layout row for a focused selection and its reset control', async () => {
    const backtest = new BacktestState(async () => sample);
    await backtest.load();
    backtest.selectTrade(0);
    const html = render(BacktestPanel, {
      props: { open: true, backtest },
    }).body;
    expect(html).toContain('has-selection');
    expect(html).toContain('Show full run');
    backtest.clearSelection();
    const cleared = render(BacktestPanel, {
      props: { open: true, backtest },
    }).body;
    expect(cleared).not.toContain('has-selection');
    expect(cleared).not.toContain('Show full run');
  });

  it('renders a stable load error with an explicit retry and stored-account explanation', async () => {
    const backtest = new BacktestState(async () => {
      throw new Error('Run not found');
    });
    await backtest.load();
    const html = render(BacktestPanel, {
      props: { open: true, backtest },
    }).body;
    expect(html).toContain('Run not found');
    expect(html).toContain('Retry loading result');
    expect(html).toContain('original account');
    expect(html).not.toContain('Loading result…');
  });

  it('loads once on opening or result replacement, not on loading/error changes', async () => {
    const url = new URL(
      '../../../components/backtest/BacktestPanel.svelte',
      import.meta.url,
    );
    const script = readFileSync(url, 'utf8')
      .split('</script>')[0]
      .replace(/^<script[^>]*>/, '');
    const ast = ts.createSourceFile(
      url.pathname,
      script,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const effect = ast.statements.find(
      node =>
        ts.isExpressionStatement(node) &&
        node.getText(ast).startsWith('$effect(') &&
        node.getText(ast).includes('state.load()'),
    );
    expect(effect).toBeDefined();
    const stateModule = clientModule<{ BacktestState: typeof BacktestState }>(
      new URL('./backtestState.svelte.ts', import.meta.url),
      {
        './loadResult': { loadResult },
        './resultSelection': { tradeSelection, drawdownSelection },
      },
    );
    const module = clientModule<{
      default: (
        anchor: unknown,
        props: unknown,
      ) => { show: (state: BacktestState) => void };
    }>(
      url,
      {},
      `<script>
      import { untrack } from 'svelte';
      let open = $state(false), embedded = $state(false), backtest = $state.raw(null);
      ${effect!.getText(ast)}
      export function show(nextState) { backtest = nextState; open = true; }
    </script>`,
    );
    const loader = vi.fn<() => Promise<unknown>>(async () => {
      throw new Error('Run not found');
    });
    const backtest = new stateModule.BacktestState(loader);
    let panel!: ReturnType<typeof module.default>;
    const stop = client.effect_root(() => {
      panel = module.default(null, {});
    });
    try {
      panel.show(backtest);
      for (let i = 0; i < 6; i++) {
        client.flush();
        await Promise.resolve();
      }
      expect(loader).toHaveBeenCalledTimes(1);
      expect(backtest.loading).toBe(false);
      expect(backtest.error).toBe('Run not found');
      loader.mockImplementationOnce(async () => sample);
      await backtest.load();
      client.flush();
      expect(loader).toHaveBeenCalledTimes(2);
      expect(backtest.error).toBeNull();
      const nextLoader = vi.fn(async () => sample);
      panel.show(new stateModule.BacktestState(nextLoader));
      client.flush();
      await Promise.resolve();
      client.flush();
      expect(nextLoader).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });
  it('explains a loaded result with no bars rather than leaving blank chart panes', async () => {
    const backtest = new BacktestState(async () => ({
      ...sample,
      bars: [],
      equity: [],
      trades: [],
    }));
    await backtest.load();
    const html = render(BacktestPanel, {
      props: { open: true, backtest },
    }).body;
    expect(html).toContain('This run returned no market bars.');
    expect(html).not.toContain('class="chart-pane');
  });

  it('still renders results when a run has bars but no closed trades', async () => {
    const backtest = new BacktestState(async () => ({ ...sample, trades: [] }));
    await backtest.load();
    backtest.setTab('trades');
    const html = render(BacktestPanel, {
      props: { open: true, backtest },
    }).body;
    expect(html).not.toContain('This run returned no market bars.');
    expect(html).toContain('class="chart-pane');
  });
});

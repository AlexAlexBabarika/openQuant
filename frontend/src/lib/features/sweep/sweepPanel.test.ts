import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { parse } from 'svelte/compiler';
import { writable } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { clearAccessToken } from '$lib/core/api';
import {
  client,
  clientModule,
  componentDeclarations,
} from '$lib/features/chart/reactiveTestSupport';
import type { SweepClient } from './types';
import SweepPanel from '../../../components/sweep/SweepPanel.svelte';
import { SweepState } from './sweepState.svelte';

describe('sweep control feedback', () => {
  it('reloads the retained draft schema after owner reset without a tab remount', async () => {
    const panel = new URL(
      '../../../components/sweep/SweepPanel.svelte',
      import.meta.url,
    );
    function effects(url: URL): string[] {
      const source = readFileSync(url, 'utf8');
      const instance = parse(source, { modern: true }).instance!;
      const script = source
        .slice(instance.start, instance.end)
        .replace(/^<script[^>]*>|<\/script>$/g, '');
      const ast = ts.createSourceFile(
        url.pathname,
        script,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );
      return ast.statements
        .filter(
          node =>
            ts.isExpressionStatement(node) &&
            ts.isCallExpression(node.expression) &&
            ts.isIdentifier(node.expression.expression) &&
            node.expression.expression.text === '$effect',
        )
        .map(node => node.getText(ast));
    }
    const ownerReset = effects(
      new URL(
        '../../../components/strategy/StrategyPanel.svelte',
        import.meta.url,
      ),
    ).find(effect => effect.includes('savedUserId'))!;
    const schema = { qty: { kind: 'int' as const, low: 1, high: 2, step: 1 } };
    const schemaRequest = vi.fn(async () => schema);
    const sweep = new SweepState({
      schema: schemaRequest,
    } as unknown as SweepClient);
    const authState = writable<{ user: { id: string } | null }>({
      user: { id: 'a' },
    });
    const source = client.state('params = {"qty": Int(1, 2, step=1)}');
    const component = clientModule<{
      default: (anchor: unknown, props: unknown) => void;
    }>(
      panel,
      {},
      `<script lang="ts">
      import {untrack} from 'svelte';
      let {authState, sweep, code} = $props();
      let savedUserId = null;
      let open = false;
      const strat = {clearSaved() {}, load() {}};
      const portfolio = {reset() {}};
      let loadedPortfolioRun = null;
      let completedSource = null;
      let completedResult = null;
      let completedMarket = null;
      let lastForm = $state(null);
      let drillState = $state(null);
      let drillOpen = $state(false);
      ${ownerReset}
      ${componentDeclarations(panel, ['drillOwner', 'clearDrill'])}
      ${effects(panel).join('\n')}
    </script>`,
    ).default;
    const stop = client.effect_root(() =>
      component(null, {
        authState,
        sweep,
        get code() {
          return client.get(source);
        },
      }),
    );
    try {
      for (const owner of ['a', null, 'b']) {
        if (owner !== 'a') {
          clearAccessToken();
          authState.set({ user: owner ? { id: owner } : null });
        }
        client.flush();
        await Promise.resolve();
        client.flush();
        expect(sweep.schema).toEqual(schema);
        expect(sweep.schemaLoading).toBe(false);
        expect(sweep.status).toBe('idle');
        expect(sweep.trials).toEqual([]);
        expect(sweep.sweepId).toBeNull();
      }
      expect(schemaRequest.mock.calls).toEqual(
        Array.from({ length: 3 }, () => [client.get(source)]),
      );
      client.set(source, 'changed draft');
      client.flush();
      await Promise.resolve();
      expect(schemaRequest).toHaveBeenLastCalledWith('changed draft');
      expect(sweep.schema).toEqual(schema);
    } finally {
      stop();
      clearAccessToken();
    }
  });

  it('preserves edited search controls when the view remounts with the same sweep', () => {
    const sweep = new SweepState();
    sweep.form.seed = 7;
    sweep.form.search = 'random';
    sweep.form.nRandom = 32;
    for (let i = 0; i < 2; i++) {
      const html = render(SweepPanel, { props: { code: 'x', sweep } }).body;
      expect(html).toMatch(/Seed <input[^>]*value="7"/);
      expect(html).toMatch(/Trials <input[^>]*value="32"/);
    }
  });
  it('shows schema errors and disables starting while parameters are loading', () => {
    const sweep = new SweepState();
    sweep.schemaLoading = true;
    sweep.schemaError = 'Invalid strategy source';
    const html = render(SweepPanel, {
      props: { code: 'bad source', sweep },
    }).body;
    expect(html).toContain('Loading parameters');
    expect(html).toContain('Invalid strategy source');
    expect(html).toMatch(/type="submit"[^>]*disabled/);
  });

  it('explains a completed sweep with no trials instead of showing a blank results section', () => {
    const sweep = new SweepState();
    sweep.status = 'done';
    const html = render(SweepPanel, { props: { code: 'x', sweep } }).body;
    expect(html).toContain('No trials were returned for this sweep.');
  });

  it('shows pending cancellation and disables duplicate cancellation', () => {
    const sweep = new SweepState();
    sweep.status = 'running';
    sweep.cancelling = true;
    const html = render(SweepPanel, { props: { code: 'x', sweep } }).body;
    expect(html).toMatch(/<button[^>]*disabled[^>]*>cancelling/);
  });
});

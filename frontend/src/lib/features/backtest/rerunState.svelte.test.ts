import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { parse } from 'svelte/compiler';
import { describe, expect, it, vi } from 'vitest';
import { RerunState } from './rerunState.svelte';
import type { RerunResponse } from '$lib/features/runs/runTypes';

const response = { run_id: 'new', diff: {} } as RerunResponse;

describe('rerun controls', () => {
  it.each(['resolve', 'reject'] as const)(
    'invalidates pending %s through the dashboard destruction callback',
    async outcome => {
      let resolve!: (value: RerunResponse) => void;
      let reject!: (error: Error) => void;
      const state = new RerunState({
        rerunRun: vi.fn(
          () =>
            new Promise<RerunResponse>((yes, no) => {
              resolve = yes;
              reject = no;
            }),
        ),
      });
      const pending = state.run('old');
      const source = readFileSync(
        new URL(
          '../../../components/backtest/BacktestPanel.svelte',
          import.meta.url,
        ),
        'utf8',
      );
      const instance = parse(source, { modern: true }).instance!;
      const script = source
        .slice(instance.start, instance.end)
        .replace(/^<script[^>]*>|<\/script>$/g, '');
      const ast = ts.createSourceFile(
        'panel.ts',
        script,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );
      const registration = ast.statements
        .filter(
          statement =>
            ts.isExpressionStatement(statement) &&
            ts.isCallExpression(statement.expression) &&
            ts.isIdentifier(statement.expression.expression) &&
            statement.expression.expression.text === 'onDestroy',
        )
        .map(statement => statement.getText(ast))
        .join('\n');
      const cleanups: (() => void)[] = [];
      const modal = { close: vi.fn() };
      const emitted = ts.transpileModule(registration, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
      }).outputText;
      new Function('onDestroy', 'rerunState', 'modal', emitted)(
        (callback: () => void) => cleanups.push(callback),
        state,
        modal,
      );
      expect(cleanups.length).toBeGreaterThan(0);
      for (const cleanup of cleanups) cleanup();
      expect(modal.close).toHaveBeenCalledOnce();
      if (outcome === 'resolve') resolve(response);
      else reject(new Error('obsolete result failure'));
      expect(await pending).toBeNull();
      expect(state.running).toBe(false);
      expect(state.error).toBeNull();
    },
  );

  it('ignores a rerun response after switching or closing the dashboard', async () => {
    let resolve!: (value: RerunResponse) => void;
    const client = {
      rerunRun: vi.fn(
        () =>
          new Promise<RerunResponse>(r => {
            resolve = r;
          }),
      ),
    };
    const state = new RerunState(client);
    const pending = state.run('old');
    state.reset();
    resolve(response);
    expect(await pending).toBeNull();
    expect(state.running).toBe(false);
    expect(state.error).toBeNull();
  });

  it('does not show an old failure or stop the newer rerun spinner', async () => {
    let rejectOld!: (error: Error) => void;
    let resolveNew!: (value: RerunResponse) => void;
    const old = new Promise<RerunResponse>((_, reject) => {
      rejectOld = reject;
    });
    const latest = new Promise<RerunResponse>(resolve => {
      resolveNew = resolve;
    });
    const state = new RerunState({
      rerunRun: vi.fn().mockReturnValueOnce(old).mockReturnValueOnce(latest),
    });
    const pendingOld = state.run('old');
    state.reset();
    const pendingNew = state.run('latest');
    rejectOld(new Error('old failure'));
    expect(await pendingOld).toBeNull();
    expect(state.running).toBe(true);
    expect(state.error).toBeNull();
    resolveNew(response);
    expect(await pendingNew).toEqual(response);
  });

  it('surfaces server errors and allows retry', async () => {
    const state = new RerunState({
      rerunRun: vi
        .fn()
        .mockRejectedValueOnce(new Error('Sign in required'))
        .mockResolvedValueOnce(response),
    });
    expect(await state.run('a')).toBeNull();
    expect(state.error).toBe('Sign in required');
    expect(state.running).toBe(false);
    expect(await state.run('a')).toEqual(response);
    expect(state.error).toBeNull();
  });
});

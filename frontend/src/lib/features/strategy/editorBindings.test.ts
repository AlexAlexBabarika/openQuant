import { readFileSync } from 'node:fs';
import { parse, type AST } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';
import { StrategyState } from './strategyState.svelte';
import { IndicatorState } from '../indicators/indicatorState.svelte';

function editorBinding(node: unknown): AST.BindDirective | undefined {
  if (!node || typeof node !== 'object') return;
  const record = node as Record<string, unknown>;
  if (record.type === 'Component' && record.name === 'ScriptEditor') {
    return (node as AST.Component).attributes.find(
      (attr): attr is AST.BindDirective =>
        attr.type === 'BindDirective' && attr.name === 'value',
    );
  }
  for (const child of Object.values(record)) {
    if (!child || typeof child !== 'object') continue;
    const binding = editorBinding(child);
    if (binding) return binding;
  }
}

describe('workbench editor bindings', () => {
  it.each([
    {
      name: 'strategy',
      panel: 'strategy/StrategyPanel.svelte',
      variable: 'strat',
      state: () => new StrategyState(),
    },
    {
      name: 'indicator',
      panel: 'indicators/IndicatorsPanel.svelte',
      variable: 'ind',
      state: () => new IndicatorState(),
    },
  ])(
    'tracks code-only edits in the $name panel',
    ({ panel, variable, state: makeState }) => {
      const source = readFileSync(
        new URL(`../../../components/${panel}`, import.meta.url),
        'utf8',
      );
      const binding = editorBinding(parse(source, { modern: true }).fragment);
      expect(binding).toBeDefined();
      const expression = binding!
        .expression as AST.BindDirective['expression'] & {
        start: number;
        end: number;
      };
      const code = source.slice(expression.start, expression.end);
      const callbacks =
        expression.type === 'SequenceExpression'
          ? `[${code}]`
          : `[() => ${code}, value => ${code} = value]`;
      const state = makeState();
      const [read, write] = new Function(variable, `return ${callbacks}`)(
        state,
      ) as [() => string, (value: string) => void];
      const initialCode = read();
      write(initialCode);
      expect(state.dirty).toBe(false);
      write('typed code only');
      expect(read()).toBe('typed code only');
      expect(state.draftCode).toBe('typed code only');
      expect(state.dirty).toBe(true);
    },
  );
});

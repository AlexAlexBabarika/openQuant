import { readFileSync } from 'node:fs';
import { parse, type AST } from 'svelte/compiler';
import { describe, expect, it, vi } from 'vitest';

function sourceOf(source: string, node: unknown): string {
  const { start, end } = node as { start: number; end: number };
  return source.slice(start, end);
}

function findComponent(node: unknown, name: string): AST.Component | undefined {
  if (!node || typeof node !== 'object') return;
  const record = node as Record<string, unknown>;
  if (record.type === 'Component' && record.name === name)
    return node as AST.Component;
  for (const child of Object.values(record)) {
    const component = findComponent(child, name);
    if (component) return component;
  }
}

function marketProps(
  panel: string,
  child: string,
  market: { symbol: string; provider: string },
) {
  const source = readFileSync(
    new URL(`../../../components/${panel}`, import.meta.url),
    'utf8',
  );
  const component = findComponent(
    parse(source, { modern: true }).fragment,
    child,
  )!;
  const result: Record<string, string> = {};
  for (const attribute of component.attributes) {
    if (
      attribute.type !== 'Attribute' ||
      !['symbol', 'provider'].includes(attribute.name)
    )
      continue;
    const value = Array.isArray(attribute.value)
      ? attribute.value[0]
      : attribute.value;
    if (value && typeof value === 'object' && 'expression' in value) {
      const expression = value.expression;
      result[attribute.name] = new Function(
        'symbol',
        'provider',
        `return ${sourceOf(source, expression)}`,
      )(market.symbol, market.provider);
    }
  }
  return result;
}

describe('selected market sweep wiring', () => {
  it.each([
    { symbol: 'BTCUSDT', provider: 'binance' },
    { symbol: 'MSFT', provider: 'twelvedata' },
  ])(
    'submits the selected $symbol/$provider instead of the SPY defaults',
    market => {
      const strategy = marketProps(
        'strategy/StrategyPanel.svelte',
        'SweepPanel',
        market,
      );
      const form = marketProps('sweep/SweepPanel.svelte', 'ParamForm', {
        symbol: strategy.symbol ?? 'SPY',
        provider: strategy.provider ?? 'yfinance',
      });
      const source = readFileSync(
        new URL('../../../components/sweep/ParamForm.svelte', import.meta.url),
        'utf8',
      );
      const submit = parse(source, {
        modern: true,
      }).instance!.content.body.find(
        node =>
          node.type === 'FunctionDeclaration' && node.id?.name === 'submit',
      )!;
      const onsubmit = vi.fn();
      new Function(
        'code',
        'symbol',
        'provider',
        'onsubmit',
        'disabled',
        'vary',
        'search',
        'metric',
        'nRandom',
        'seed',
        `${sourceOf(source, submit)}; submit();`,
      )(
        'strategy source',
        form.symbol ?? 'SPY',
        form.provider ?? 'yfinance',
        onsubmit,
        false,
        ['window'],
        'grid',
        'sharpe',
        200,
        0,
      );
      expect(onsubmit).toHaveBeenCalledWith(expect.objectContaining(market));
    },
  );
});

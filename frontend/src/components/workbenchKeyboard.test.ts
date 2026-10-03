import { describe, expect, it, vi } from 'vitest';
import { parse, type AST } from 'svelte/compiler';
import { render } from 'svelte/server';
import ResultTabs, { resultTabForKey } from './backtest/ResultTabs.svelte';
import TradesTab from './backtest/tabs/TradesTab.svelte';
import ColourPicker, { sliderValueForKey } from './chart/ColourPicker.svelte';
import IndicatorsPanel from './indicators/IndicatorsPanel.svelte';
import StrategyPanel from './strategy/StrategyPanel.svelte';
import ToolboxPanel from './toolbar/ToolboxPanel.svelte';
import {
  BacktestState,
  RESULT_TABS,
} from '$lib/features/backtest/backtestState.svelte';
import { IndicatorState } from '$lib/features/indicators/indicatorState.svelte';
import { StrategyState } from '$lib/features/strategy/strategyState.svelte';
import sample from '$lib/features/backtest/fixtures/sample-run.json';

function elements(html: string): AST.RegularElement[] {
  const result: AST.RegularElement[] = [];
  function visit(fragment: AST.Fragment) {
    for (const node of fragment.nodes) {
      if (node.type !== 'RegularElement') continue;
      result.push(node);
      visit(node.fragment);
    }
  }
  visit(parse(html, { modern: true }).fragment);
  return result;
}

function attr(node: AST.RegularElement, name: string): string | undefined {
  const attribute = node.attributes.find(
    a => a.type === 'Attribute' && a.name === name,
  );
  if (!attribute || attribute.type !== 'Attribute') return undefined;
  if (attribute.value === true) return '';
  if (!Array.isArray(attribute.value))
    throw new Error('Expected rendered attributes');
  return attribute.value
    .map(value => (value.type === 'Text' ? value.data : ''))
    .join('');
}

function keyEvent(key: string) {
  return { key, preventDefault: vi.fn() };
}

describe('workbench keyboard operations', () => {
  it.each([
    ['equity', 'ArrowLeft', 'stats'],
    ['stats', 'ArrowRight', 'equity'],
    ['trades', 'ArrowLeft', 'drawdown'],
    ['trades', 'ArrowRight', 'monthly'],
    ['monthly', 'Home', 'equity'],
    ['equity', 'End', 'stats'],
  ] as const)(
    'moves %s with %s to %s without scrolling',
    (current, key, expected) => {
      const event = keyEvent(key);
      expect(resultTabForKey(event, current)).toBe(expected);
      expect(event.preventDefault).toHaveBeenCalledOnce();
    },
  );

  it.each([360, 100])('steps and clamps the %s-unit slider', max => {
    for (const key of ['ArrowRight', 'ArrowUp']) {
      expect(sliderValueForKey(keyEvent(key), 42, max)).toBe(43);
      expect(sliderValueForKey(keyEvent(key), max, max)).toBe(max);
    }
    for (const key of ['ArrowLeft', 'ArrowDown']) {
      expect(sliderValueForKey(keyEvent(key), 42, max)).toBe(41);
      expect(sliderValueForKey(keyEvent(key), 0, max)).toBe(0);
    }
    for (const [key, expected] of [
      ['Home', 0],
      ['End', max],
    ] as const) {
      const event = keyEvent(key);
      expect(sliderValueForKey(event, 42, max)).toBe(expected);
      expect(event.preventDefault).toHaveBeenCalledOnce();
    }
    const arrow = keyEvent('ArrowRight');
    sliderValueForKey(arrow, max, max);
    expect(arrow.preventDefault).toHaveBeenCalledOnce();
  });

  it.each(['Tab', 'Escape', 'Enter', 'PageDown'])(
    'leaves unhandled %s alone',
    key => {
      const event = keyEvent(key);
      expect(resultTabForKey(event, 'equity')).toBeNull();
      expect(sliderValueForKey(event, 42, 100)).toBeNull();
      expect(event.preventDefault).not.toHaveBeenCalled();
    },
  );
});

describe('rendered workbench semantics', () => {
  it('links every tab and panel and gives only the selected tab a tab stop', async () => {
    const backtest = new BacktestState(async () => sample);
    await backtest.load();
    for (const selected of RESULT_TABS) {
      backtest.setTab(selected.id);
      const nodes = elements(render(ResultTabs, { props: { backtest } }).body);
      const tabs = nodes.filter(node => attr(node, 'role') === 'tab');
      const panels = nodes.filter(node => attr(node, 'role') === 'tabpanel');
      expect(tabs).toHaveLength(5);
      expect(panels).toHaveLength(5);
      expect(tabs.filter(node => attr(node, 'tabindex') === '0')).toHaveLength(
        1,
      );
      for (const [index, tab] of tabs.entries()) {
        const active = RESULT_TABS[index].id === selected.id;
        expect(tab.name).toBe('button');
        expect(attr(tab, 'aria-selected')).toBe(String(active));
        expect(attr(tab, 'tabindex')).toBe(active ? '0' : '-1');
        const panel = panels.find(
          node => attr(node, 'id') === attr(tab, 'aria-controls'),
        );
        expect(panel).toBeDefined();
        expect(attr(panel!, 'aria-labelledby')).toBe(attr(tab, 'id'));
        expect(attr(panel!, 'hidden') !== undefined).toBe(!active);
      }
    }
  });

  it('renders seven native sort controls and reports the initial sort direction', async () => {
    const backtest = new BacktestState(async () => sample);
    await backtest.load();
    const nodes = elements(
      render(TradesTab, {
        props: { backtest, result: backtest.result! },
      }).body,
    );
    const headers = nodes.filter(
      node => node.name === 'th' && attr(node, 'aria-sort') !== undefined,
    );
    expect(headers).toHaveLength(7);
    expect(headers.map(node => attr(node, 'aria-sort'))).toEqual([
      'ascending',
      'none',
      'none',
      'none',
      'none',
      'none',
      'none',
    ]);
    for (const header of headers) {
      const buttons = header.fragment.nodes.filter(
        node => node.type === 'RegularElement' && node.name === 'button',
      );
      expect(buttons).toHaveLength(1);
      expect(attr(buttons[0] as AST.RegularElement, 'type')).toBe('button');
    }
  });

  it('announces hue and alpha values in keyboard units', () => {
    const nodes = elements(
      render(ColourPicker, { props: { colour: '#00ff0080' } }).body,
    );
    const sliders = nodes.filter(node => attr(node, 'role') === 'slider');
    expect(
      sliders.map(node => [
        attr(node, 'aria-label'),
        attr(node, 'aria-valuemin'),
        attr(node, 'aria-valuemax'),
        attr(node, 'aria-valuenow'),
        attr(node, 'tabindex'),
      ]),
    ).toEqual([
      ['Hue', '0', '360', '120', '0'],
      ['Alpha', '0', '100', '50', '0'],
    ]);
  });

  it('keeps closed Toolbox content inert while its reopen handle remains reachable', () => {
    const nodes = elements(
      render(ToolboxPanel, { props: { theme: 'dark' } }).body,
    );
    const dialog = nodes.find(node => attr(node, 'aria-label') === 'Toolbox');
    const handle = nodes.find(
      node => attr(node, 'aria-label') === 'Open toolbox',
    );
    expect(dialog).toBeDefined();
    expect(attr(dialog!, 'inert')).toBe('');
    expect(attr(dialog!, 'aria-hidden')).toBe('true');
    expect(handle).toBeDefined();
    expect(attr(handle!, 'tabindex')).toBe('0');
    expect(attr(handle!, 'inert')).toBeUndefined();
  });

  it('renders saved indicator and strategy actions as sibling native buttons', () => {
    const saved = {
      id: 'saved',
      name: 'Saved draft',
      code: 'print(1)',
      created_at: '2026-10-01',
      updated_at: '2026-10-01',
    };
    const indicators = new IndicatorState();
    const strategy = new StrategyState();
    indicators.scripts = [saved];
    strategy.scripts = [saved];
    const context = {
      open: true,
      symbol: 'AAPL',
      provider: 'yfinance' as const,
      period: '1y',
      interval: '1d',
    };
    const indicatorNodes = elements(
      render(IndicatorsPanel, { props: { ...context, indicators } }).body,
    );
    const strategyNodes = elements(
      render(StrategyPanel, { props: { ...context, strategy } }).body,
    );
    for (const [nodes, count] of [
      [indicatorNodes, 3],
      [strategyNodes, 2],
    ] as const) {
      const row = nodes.find(node =>
        attr(node, 'class')?.split(' ').includes('rail-item'),
      );
      expect(row).toBeDefined();
      expect(row!.name).toBe('div');
      expect(attr(row!, 'role')).toBeUndefined();
      expect(attr(row!, 'tabindex')).toBeUndefined();
      const buttons = row!.fragment.nodes.filter(
        node => node.type === 'RegularElement' && node.name === 'button',
      );
      expect(buttons).toHaveLength(count);
      for (const button of buttons)
        expect(attr(button as AST.RegularElement, 'type')).toBe('button');
    }
  });

  it('keeps the open Toolbox drag handle inside its modal focus scope', () => {
    const nodes = elements(
      render(ToolboxPanel, { props: { open: true, theme: 'dark' } }).body,
    );
    const dialog = nodes.find(node => attr(node, 'role') === 'dialog');
    expect(dialog).toBeDefined();
    expect(attr(dialog!, 'aria-modal')).toBe('true');
    const handle = dialog!.fragment.nodes.find(
      node =>
        node.type === 'RegularElement' &&
        attr(node, 'aria-expanded') === 'true',
    );
    expect(handle).toBeDefined();
    expect(attr(handle as AST.RegularElement, 'tabindex')).toBe('0');
    expect(attr(dialog!, 'inert')).toBeUndefined();
  });
});

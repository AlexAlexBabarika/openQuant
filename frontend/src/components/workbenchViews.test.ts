import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { parse } from 'svelte/compiler';
import {
  client,
  clientModule,
  componentDeclarations,
  deferred,
} from '$lib/features/chart/reactiveTestSupport';
import { selectEntry, trialSearch } from '../entry';
import { StrategyState } from '$lib/features/strategy/strategyState.svelte';
import TopHeader from './layout/TopHeader.svelte';
import StrategyPanel from './strategy/StrategyPanel.svelte';

const app = new URL('../App.svelte', import.meta.url);
const panel = new URL('./strategy/StrategyPanel.svelte', import.meta.url);

describe('persistent research task views', () => {
  it.each(['chart', 'strategy', 'robustness'] as const)(
    'identifies %s as the only active navigation item',
    activeView => {
      const html = render(TopHeader, {
        props: {
          activeView,
          symbol: 'MSFT',
          period: '1y',
          interval: '1d',
          source: 'yfinance',
          autoRefresh: false,
          connectionStatus: 'disconnected',
          isLoading: false,
          onload: vi.fn(),
          onstream: vi.fn(),
          oncsvupload: vi.fn(),
        },
      }).body;
      expect(html).toContain('aria-label="Research tasks"');
      expect(html.match(/aria-current="page"/g)).toHaveLength(1);
      expect(html).toMatch(
        new RegExp(
          `aria-current="page"[^>]*>${activeView[0].toUpperCase() + activeView.slice(1)}</button>`,
        ),
      );
      expect(html).toContain('Load history');
      expect(html).toContain('Inspect data');
    },
  );

  it.each(['', '&trial=1'])(
    'restores task history from initial query %s and preserves other URL parameters',
    initialQuery => {
      const entries: { url: string; state: Record<string, unknown> | null }[] =
        [{ url: `http://localhost/?symbol=MSFT${initialQuery}`, state: null }];
      let position = 0;
      const window = {
        location: {
          href: entries[0].url,
          search: new URL(entries[0].url).search,
        },
        history: {
          state: null as Record<string, unknown> | null,
          pushState: vi.fn(
            (state: Record<string, unknown>, _title: string, url: URL) => {
              entries.splice(++position, entries.length, {
                url: url.href,
                state,
              });
              window.history.state = state;
              window.location.href = url.href;
              window.location.search = url.search;
            },
          ),
          go: (delta: number) => {
            position += delta;
            window.history.state = entries[position].state;
            window.location.href = entries[position].url;
            window.location.search = new URL(entries[position].url).search;
          },
        },
      };
      const module = clientModule<{
        default: (
          anchor: unknown,
          props: unknown,
        ) => {
          view: () => string;
          chart: () => void;
          strategy: () => void;
          robustness: () => void;
          navigate: (delta: number) => void;
        };
      }>(
        app,
        {
          'test:entry': { selectEntry, trialSearch },
          'test:window': { window },
        },
        `<script lang="ts">
      import { selectEntry, trialSearch } from 'test:entry';
      import { window } from 'test:window';
      window.location.search = new URL(window.location.href).search;
      ${componentDeclarations(app, ['trialOpen', 'strategyOpen', 'activeView', 'setTrialOpen', 'openStrategy', 'openChart', 'syncWorkbenchView'])}
      export function view() { return activeView; }
      export function chart() { openChart(); }
      export function strategy() { openStrategy(); }
      export function robustness() { setTrialOpen(true); }
      export function navigate(delta: number) { window.history.go(delta); syncWorkbenchView(); }
    </script>`,
      );
      let harness!: ReturnType<typeof module.default>;
      const stop = client.effect_root(() => {
        harness = module.default(null, {});
      });
      try {
        const initialView = initialQuery ? 'robustness' : 'chart';
        expect(harness.view()).toBe(initialView);
        harness.strategy();
        expect(harness.view()).toBe('strategy');
        harness.navigate(-1);
        expect(harness.view()).toBe(initialView);
        harness.navigate(1);
        expect(harness.view()).toBe('strategy');
        harness.chart();
        harness.navigate(-1);
        expect(harness.view()).toBe('strategy');
        harness.navigate(1);
        expect(harness.view()).toBe('chart');
        harness.robustness();
        expect(harness.view()).toBe('robustness');
        expect(new URL(window.location.href).searchParams.get('trial')).toBe(
          '1',
        );
        harness.strategy();
        expect(harness.view()).toBe('strategy');
        harness.navigate(-1);
        expect(harness.view()).toBe('robustness');
        harness.navigate(1);
        expect(harness.view()).toBe('strategy');
        expect(new URL(window.location.href).searchParams.has('trial')).toBe(
          false,
        );
        harness.chart();
        expect(harness.view()).toBe('chart');
        expect(new URL(window.location.href).searchParams.get('symbol')).toBe(
          'MSFT',
        );
      } finally {
        stop();
      }
    },
  );

  it('keeps chart, editor and report components mounted instead of conditionally destroying them', () => {
    const fragment = parse(readFileSync(app, 'utf8'), {
      modern: true,
    }).fragment;
    const found = new Set<string>();
    function visit(node: unknown, conditional = false) {
      if (!node || typeof node !== 'object') return;
      const current = node as Record<string, unknown>;
      const insideConditional = conditional || current.type === 'IfBlock';
      if (
        current.type === 'Component' &&
        ['Chart', 'StrategyPanel', 'StrategyTrial'].includes(
          String(current.name),
        )
      ) {
        expect(insideConditional).toBe(false);
        found.add(String(current.name));
      }
      for (const child of Object.values(current))
        if (child && typeof child === 'object') visit(child, insideConditional);
    }
    visit(fragment);
    expect([...found].sort()).toEqual([
      'Chart',
      'StrategyPanel',
      'StrategyTrial',
    ]);
  });

  it('renders the embedded Strategy as a region with opt-in split and no modal overlay', () => {
    const html = render(StrategyPanel, {
      props: {
        embedded: true,
        open: true,
        strategy: new StrategyState(),
        symbol: 'MSFT',
        provider: 'yfinance',
        period: '1y',
        interval: '1d',
      },
    }).body;
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="Strategy workbench"');
    expect(html).toMatch(/aria-pressed="false"[^>]*>Split view/);
    expect(html).toContain('Return to chart');
    expect(html).not.toContain('aria-modal="true"');
    expect(html).not.toContain('class="backdrop');
  });
});

describe('completed strategy run context', () => {
  it('captures the source and market at submission, not when the request finishes', async () => {
    const pending = deferred<unknown>();
    const result = client.proxy({
      result: {
        meta: { run_id: 'run-1', finished_at: '2026-10-04T18:30:00Z' },
      },
      error: null,
    });
    const strategy = client.proxy({
      draftCode: 'original source',
      draftName: 'Original draft',
      backtest: result,
      isRunning: false,
      runError: null,
      runBacktest: vi.fn(() => pending.promise),
    });
    const runsHistory = { accountVersion: 0, record: vi.fn() };
    const module = clientModule<{
      default: (
        anchor: unknown,
        props: unknown,
      ) => {
        run: () => Promise<void>;
        change: () => void;
        snapshot: () => {
          name: string;
          symbol: string | undefined;
          source: string | null;
          stale: boolean;
          view: string;
        };
      };
    }>(
      panel,
      { 'test:state': { strategy, runsHistory } },
      `<script lang="ts">
      import { strategy, runsHistory } from 'test:state';
      let symbol = $state('MSFT'), provider = 'yfinance', period = $state('1y'), interval = '1d';
      ${componentDeclarations(panel, ['strat', 'editorView', 'completedSource', 'completedName', 'completedContext', 'completedMarket', 'completedResult', 'resultChanged', 'runNow'])}
      export function run() { return runNow(); }
      export function change() { strategy.draftCode = 'new source'; strategy.draftName = 'New draft'; symbol = 'AAPL'; period = '5y'; }
      export function snapshot() { return { name: completedName, symbol: completedMarket?.symbol, source: completedSource, stale: resultChanged, view: editorView }; }
    </script>`,
    );
    let harness!: ReturnType<typeof module.default>;
    const stop = client.effect_root(() => {
      harness = module.default(null, {});
    });
    try {
      const run = harness.run();
      expect(strategy.runBacktest).toHaveBeenCalledWith({
        symbol: 'MSFT',
        provider: 'yfinance',
        period: '1y',
        interval: '1d',
      });
      harness.change();
      pending.resolve(result);
      await run;
      expect(harness.snapshot()).toEqual({
        name: 'Original draft',
        symbol: 'MSFT',
        source: 'original source',
        stale: true,
        view: 'results',
      });
      expect(runsHistory.record).toHaveBeenCalledWith(
        expect.objectContaining({ label: 'Original draft', run_id: 'run-1' }),
      );
    } finally {
      stop();
    }
  });
});

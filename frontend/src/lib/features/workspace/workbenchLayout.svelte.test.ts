import { describe, expect, it } from 'vitest';
import {
  WorkbenchLayout,
  type WorkspaceContext,
} from './workbenchLayout.svelte';

const context = (): WorkspaceContext => ({
  chart: { symbol: 'SPY', provider: 'yfinance', interval: '1d', period: '1y' },
  strategy: { name: 'Strategy draft', code: 'strategy code' },
  indicator: { name: 'Indicator draft', code: 'indicator code' },
  strategyOpen: true,
  indicatorsOpen: false,
});

function customised(): WorkbenchLayout {
  const layout = new WorkbenchLayout(null);
  layout.chartType = 'line';
  layout.showArea = false;
  layout.showVolume = false;
  layout.sma = { enabled: true, period: 13, lineWidth: 3 };
  layout.ema = { enabled: true, period: 19, lineWidth: 1 };
  layout.bbands = { enabled: true, period: 17, stdDev: 3, lineWidth: 2 };
  layout.sidebar = false;
  layout.strategyEditorShare = 62;
  layout.indicatorSplitPct = 41;
  layout.strategyTab = 'sweep';
  layout.indicatorTab = 'docs';
  return layout;
}

describe('workbench layout', () => {
  it('restores every field it captures', () => {
    const saved = customised().capture(context());
    const fresh = new WorkbenchLayout(null);
    fresh.restore(saved);
    expect(
      fresh.capture(context(), new Date(saved.strategy.updatedAt)),
    ).toEqual(saved);
  });

  it('records the workspace context beside the layout, stamped once', () => {
    const now = new Date('2026-11-14T10:00:00Z');
    const saved = customised().capture(context(), now);
    expect(saved).toMatchObject({
      symbol: 'SPY',
      provider: 'yfinance',
      strategyOpen: true,
      indicatorsOpen: false,
      strategy: {
        name: 'Strategy draft',
        code: 'strategy code',
        updatedAt: now.toISOString(),
      },
      indicator: { code: 'indicator code', updatedAt: now.toISOString() },
    });
  });

  it('captures a copy, so later layout changes do not rewrite a saved workspace', () => {
    const layout = customised();
    const saved = layout.capture(context());
    layout.sma.period = 99;
    layout.strategyTab = 'editor';
    expect(saved.sma.period).toBe(13);
    expect(saved.strategyTab).toBe('sweep');
  });

  it('starts from the stored chart settings and keeps default periods', () => {
    const layout = new WorkbenchLayout({
      chartType: 'line',
      showArea: false,
      showVolume: true,
      smaEnabled: true,
      emaEnabled: false,
      bbandsEnabled: true,
    });
    expect(layout.chartType).toBe('line');
    expect(layout.sma).toEqual({ enabled: true, period: 20, lineWidth: 2 });
    expect(layout.bbands.enabled).toBe(true);
    expect(layout.sidebar).toBe(true);
  });
});

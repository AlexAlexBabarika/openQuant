import {
  loadChartSettingsFromStorage,
  persistChartSettings,
  type ChartSettings,
} from '$lib/features/chart/chartColours';
import type { ResearchLayout } from './researchShelf.svelte';

/** What a saved workspace records besides how the workbench is laid out. */
export interface WorkspaceContext {
  chart: Pick<ResearchLayout, 'symbol' | 'provider' | 'interval' | 'period'>;
  strategy: { name: string; code: string };
  indicator: { name: string; code: string };
  strategyOpen: boolean;
  indicatorsOpen: boolean;
}

/**
 * How the workbench is laid out: chart display, sidebar, and the editor panels'
 * tabs and split sizes. A saved workspace captures it and restores it as a whole.
 */
export class WorkbenchLayout {
  chartType = $state<ResearchLayout['chartType']>('candlestick');
  showArea = $state(true);
  showVolume = $state(true);
  sma = $state<ResearchLayout['sma']>({
    enabled: false,
    period: 20,
    lineWidth: 2,
  });
  ema = $state<ResearchLayout['ema']>({
    enabled: false,
    period: 20,
    lineWidth: 2,
  });
  bbands = $state<ResearchLayout['bbands']>({
    enabled: false,
    period: 20,
    stdDev: 2,
    lineWidth: 1,
  });
  /** Desktop only; narrow screens show the watchlist as a sheet. */
  sidebar = $state(true);
  strategyEditorShare = $state(50);
  indicatorSplitPct = $state(60);
  strategyTab = $state<ResearchLayout['strategyTab']>('editor');
  indicatorTab = $state<ResearchLayout['indicatorTab']>('editor');

  constructor(saved: ChartSettings | null = loadChartSettingsFromStorage()) {
    if (!saved) return;
    this.chartType = saved.chartType;
    this.showArea = saved.showArea;
    this.showVolume = saved.showVolume;
    this.sma.enabled = saved.smaEnabled;
    this.ema.enabled = saved.emaEnabled;
    this.bbands.enabled = saved.bbandsEnabled;
  }

  /** Chart display choices survive a reload; panel sizes and tabs do not. */
  persistChartSettings(): void {
    persistChartSettings({
      chartType: this.chartType,
      showArea: this.showArea,
      showVolume: this.showVolume,
      smaEnabled: this.sma.enabled,
      emaEnabled: this.ema.enabled,
      bbandsEnabled: this.bbands.enabled,
    });
  }

  capture(context: WorkspaceContext, now = new Date()): ResearchLayout {
    const updatedAt = now.toISOString();
    return {
      ...context.chart,
      chartType: this.chartType,
      showArea: this.showArea,
      showVolume: this.showVolume,
      sma: { ...this.sma },
      ema: { ...this.ema },
      bbands: { ...this.bbands },
      sidebar: this.sidebar,
      strategyOpen: context.strategyOpen,
      indicatorsOpen: context.indicatorsOpen,
      strategyEditorShare: this.strategyEditorShare,
      indicatorSplitPct: this.indicatorSplitPct,
      strategyTab: this.strategyTab,
      indicatorTab: this.indicatorTab,
      strategy: { ...context.strategy, updatedAt },
      indicator: { ...context.indicator, updatedAt },
    };
  }

  /** Applies the layout part of a saved workspace; the caller restores the rest. */
  restore(saved: ResearchLayout): void {
    this.chartType = saved.chartType;
    this.showArea = saved.showArea;
    this.showVolume = saved.showVolume;
    this.sma = { ...saved.sma };
    this.ema = { ...saved.ema };
    this.bbands = { ...saved.bbands };
    this.sidebar = saved.sidebar;
    this.strategyEditorShare = saved.strategyEditorShare;
    this.indicatorSplitPct = saved.indicatorSplitPct;
    this.strategyTab = saved.strategyTab;
    this.indicatorTab = saved.indicatorTab;
  }
}

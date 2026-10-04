<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { Popover } from 'bits-ui';
  import TopHeader from './components/layout/TopHeader.svelte';
  import BottomHeader from './components/layout/BottomHeader.svelte';
  import ErrorMessage from './components/layout/ErrorMessage.svelte';
  import Chart from './components/chart/Chart.svelte';
  import Sidebar from './components/sidebar/Sidebar.svelte';
  import type {
    MovingAverageConfig,
    BollingerBandsConfig,
  } from './components/chart/ChartOptionsMenu.svelte';
  import type { ChartType } from '$lib/features/chart/chartColours';
  import { fetchSMA, fetchEMA, fetchBBands } from '$lib/features/chart/indicators';
  import type { IndicatorPoint, BollingerBandsPoint } from '$lib/core/types';
  import { useIndicatorEffect } from '$lib/features/chart/indicatorEffect.svelte';
  import { ChartController } from '$lib/features/chart/chartController.svelte';
  import { ComparisonController } from '$lib/features/chart/comparisonController.svelte';
  import SymbolSearchDialog from './components/dialogs/SymbolSearchDialog.svelte';
  import { authState, fetchSession } from '$lib/features/auth/auth';
  import {
    pickProviderForSymbol,
    type MarketDataProviderValue,
  } from '$lib/features/market/marketDataProviders';
  import type { ChartColours } from '$lib/features/chart/chartColours';
  import {
    defaultChartColours,
    loadChartColoursFromStorage,
    persistChartColours,
    loadChartSettingsFromStorage,
    persistChartSettings,
  } from '$lib/features/chart/chartColours';
  import { loadTheme, persistTheme, applyTheme, type Theme } from '$lib/features/theme/theme';
  import type {
    TickerGroup,
    FlaggedPriority,
    FlaggedStance,
    TickerPriority,
    TickerStance,
  } from '$lib/features/market/tickers';
  import {
    loadGroupsFromStorage,
    persistGroups,
    loadSelectedGroupName,
    persistSelectedGroupName,
    loadSelectedPriority,
    persistSelectedPriority,
    loadSelectedStance,
    persistSelectedStance,
    clearTickerLocalStorage,
    addGroup,
    renameGroup,
    duplicateGroup,
    deleteGroup,
    clearGroup,
    addTickerToGroup,
    removeTickerFromGroup,
    setTickerPriority,
    collectTickersByPriority,
    collectTickersByStance,
    priorityCounts as computePriorityCounts,
    stanceCounts as computeStanceCounts,
    setPriorityEverywhere,
    setTickerStance,
    setStanceEverywhere,
    removeTickerEverywhere,
    findPriorityConflict,
    findStanceConflict,
    setTickerProvidersEverywhere,
    findTickerProviders,
  } from '$lib/features/market/tickers';
  import {
    buildTickerWorkspacePayload,
    TickerWorkspaceSync,
  } from '$lib/features/market/tickerWorkspace';
  import type { SymbolProviders, SymbolSearchResult } from '$lib/features/market/symbols';
  import {
    markYFinanceSupported,
    DEFAULT_PROVIDERS,
    fetchSymbolMeta,
  } from '$lib/features/market/symbols';
  import {
    fetchLastClose,
    providerSupportsQuoteStream,
    subscribeQuoteStream,
    type TickerQuote,
  } from '$lib/features/market/tickerQuotes';
  import { untrack } from 'svelte';
  import AppDialogs from './components/dialogs/AppDialogs.svelte';
  import {
    AppDialogsState,
    provideAppDialogs,
  } from './components/dialogs/dialogsContext.svelte';
  import type { NotesBySymbol } from '$lib/features/notes/notes';
  import {
    loadNotesFromStorage,
    persistNotes,
    notesForSymbol,
    addNote,
    updateNote,
    deleteNote,
  } from '$lib/features/notes/notes';
  import ToolboxPanel from './components/toolbar/ToolboxPanel.svelte';
  import IndicatorsPanel from './components/indicators/IndicatorsPanel.svelte';
  import AnalyticsPanel from './components/analytics/AnalyticsPanel.svelte';
  import BacktestPanel from './components/backtest/BacktestPanel.svelte';
  import RecentRunsPanel from './components/backtest/RecentRunsPanel.svelte';
  import ResearchWorkspacesDialog from './components/dialogs/ResearchWorkspacesDialog.svelte';
  import DataInspector from './components/dialogs/DataInspector.svelte';
  import CommandPalette from './components/dialogs/CommandPalette.svelte';
  import { isCommandShortcut, type ResearchCommand } from '$lib/features/workspace/commands';
  import { listTools } from '$lib/features/drawables';
  import { ResearchShelf, type DraftKind, type ResearchLayout, type ResearchWorkspace } from '$lib/features/workspace/researchShelf.svelte';
  import CompareView from './components/backtest/compare/CompareView.svelte';
  import StrategyPanel from './components/strategy/StrategyPanel.svelte';
  import { IndicatorState } from '$lib/features/indicators/indicatorState.svelte';
  import { AnalyticsState } from '$lib/features/analytics/analyticsState.svelte';
  import { BacktestState } from '$lib/features/backtest/backtestState.svelte';
  import { StrategyState } from '$lib/features/strategy/strategyState.svelte';
  import { compareState } from '$lib/features/runs/compareState.svelte';
  import { storedRunLoader } from '$lib/features/runs/storedRunLoader';
  import { runsHistory } from '$lib/features/runs/runsHistory.svelte';
  import type { RunDiff } from '$lib/features/runs/runTypes';
  import LeftToolbar from './components/toolbar/LeftToolbar.svelte';
  import ToolSettingsModal from './components/toolbar/ToolSettingsModal.svelte';
  import DrawablesPersistence from '$lib/features/drawables/DrawablesPersistence.svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import StrategyTrial from '$lib/features/trial/StrategyTrial.svelte';
  import { selectEntry, trialSearch } from './entry';
  import type { CrosshairModeName } from '$lib/features/chart/crosshair';
  import {
    CURSOR,
    drawables,
    toolbarCommandsFromStore,
    type ActiveTool,
  } from '$lib/features/drawables';

  const drawableToolbarCommands = toolbarCommandsFromStore(drawables);

  let trialOpen = $state(selectEntry(window.location.search, false) === 'trial');

  function setTrialOpen(open: boolean): void {
    trialOpen = open;
    const url = new URL(window.location.href);
    const search = trialSearch(url.search, open);
    if (url.search !== search) {
      url.search = search;
      window.history.pushState(null, '', url);
    }
  }

  onMount(() => {
    const syncTrial = () => {
      trialOpen = selectEntry(window.location.search, false) === 'trial';
    };
    window.addEventListener('popstate', syncTrial);
    return () => window.removeEventListener('popstate', syncTrial);
  });

  const chart = new ChartController({
    userId: () => $authState.user?.id ?? null,
    onSymbolFetched: (sym, src, count) => maybeMarkYFinance(sym, src, count),
  });

  const comparisonController = new ComparisonController({
    userId: () => $authState.user?.id ?? null,
    mainSymbol: () => chart.loadedSymbol,
    period: () => chart.period,
    interval: () => chart.interval,
    mainProvider: () => chart.source,
    onError: msg => {
      chart.errorMessage = msg;
    },
  });
  $effect(() => {
    comparisonController.updateContext(chart.period, chart.interval);
  });
  let comparisonDialogOpen = $state(false);

  const savedSettings = loadChartSettingsFromStorage();
  let chartType = $state<ChartType>(savedSettings?.chartType ?? 'candlestick');
  let showArea = $state(savedSettings?.showArea ?? true);
  let showVolume = $state(savedSettings?.showVolume ?? true);
  let smaConfig = $state<MovingAverageConfig>({
    enabled: savedSettings?.smaEnabled ?? false,
    period: 20,
    lineWidth: 2,
  });
  let emaConfig = $state<MovingAverageConfig>({
    enabled: savedSettings?.emaEnabled ?? false,
    period: 20,
    lineWidth: 2,
  });
  let bbandsConfig = $state<BollingerBandsConfig>({
    enabled: savedSettings?.bbandsEnabled ?? false,
    period: 20,
    stdDev: 2,
    lineWidth: 1,
  });
  const indicatorErrorHandler = (msg: string) => {
    chart.errorMessage = msg;
  };
  const sma = useIndicatorEffect<IndicatorPoint>({
    enabled: () => smaConfig.enabled,
    hasCandles: () => hasCandles,
    symbol: () => chart.loadedSymbol,
    version: () => chart.marketDataVersion,
    args: () => [smaConfig.period],
    account: () => $authState.user?.id ?? null,
    fetch: (sym, [period], signal) =>
      fetchSMA(sym, period as number, signal).then(r => r.points),
    onError: indicatorErrorHandler,
    label: 'SMA',
  });
  const ema = useIndicatorEffect<IndicatorPoint>({
    enabled: () => emaConfig.enabled,
    hasCandles: () => hasCandles,
    symbol: () => chart.loadedSymbol,
    version: () => chart.marketDataVersion,
    args: () => [emaConfig.period],
    account: () => $authState.user?.id ?? null,
    fetch: (sym, [period], signal) =>
      fetchEMA(sym, period as number, signal).then(r => r.points),
    onError: indicatorErrorHandler,
    label: 'EMA',
  });
  const bbands = useIndicatorEffect<BollingerBandsPoint>({
    enabled: () => bbandsConfig.enabled,
    hasCandles: () => hasCandles,
    symbol: () => chart.loadedSymbol,
    version: () => chart.marketDataVersion,
    args: () => [bbandsConfig.period, bbandsConfig.stdDev],
    account: () => $authState.user?.id ?? null,
    fetch: (sym, [period, stdDev], signal) =>
      fetchBBands(sym, period as number, stdDev as number, signal).then(r => r.points),
    onError: indicatorErrorHandler,
    label: 'Bollinger Bands',
  });
  let colours = $state<ChartColours>(
    loadChartColoursFromStorage() ?? defaultChartColours(),
  );
  let theme = $state<Theme>(loadTheme());

  function setTheme(next: Theme) {
    if (next === theme) return;
    applyTheme(next);
    theme = next;
    persistTheme(next);
  }
  let hasCandles = $derived(chart.candles.length > 0);
  let narrow = $state(false);
  let desktopSidebarVisible = $state(true);
  let watchlistOpen = $state(false);
  let drawingToolsOpen = $state(false);
  let sidebarVisible = $derived(narrow ? watchlistOpen : desktopSidebarVisible);
  let crosshairMode = $state<CrosshairModeName>('normal');
  let activeTool = $state<ActiveTool>(CURSOR);
  let toolSettingsOpen = $state(false);
  let toolSettingsType = $state<string | null>(null);

  function openToolSettings(type: string): void {
    drawingToolsOpen = false;
    toolSettingsType = type;
    toolSettingsOpen = true;
  }

  const initialGroups = loadGroupsFromStorage();
  let groups = $state<TickerGroup[]>(initialGroups);
  let selectedGroupName = $state(loadSelectedGroupName(initialGroups));
  let selectedPriority = $state<FlaggedPriority | null>(loadSelectedPriority());
  let selectedStance = $state<FlaggedStance | null>(loadSelectedStance());
  const authed = $derived($authState.user != null);
  let lastRemoteUserId = $state<string | null>(null);
  let sessionReady = $state(false);
  const workspaceSync = new TickerWorkspaceSync({
    userId: () => $authState.user?.id ?? null,
    read: () => ({ groups, selectedGroupName, selectedPriority, selectedStance }),
    apply: next => {
      groups = next.groups;
      selectedGroupName = next.selectedGroupName;
      selectedPriority = next.selectedPriority;
      selectedStance = next.selectedStance;
    },
    onHydrated: clearTickerLocalStorage,
    onError: error => console.warn('[openquant] Ticker workspace sync failed', error),
  });
  const dialogs = new AppDialogsState();
  provideAppDialogs(dialogs);

  async function openWatchlistDialog(action: () => void) {
    watchlistOpen = false;
    await tick();
    action();
  }

  let notes = $state<NotesBySymbol>(loadNotesFromStorage());
  let symbolMeta = $state<SymbolSearchResult | null>(null);

  $effect(() => {
    persistNotes(notes);
  });

  $effect(() => {
    const sym = chart.loadedSymbol;
    const src = chart.source;
    if (!sym.trim() || src === 'csv') {
      symbolMeta = null;
      return;
    }
    const ac = new AbortController();
    void fetchSymbolMeta(sym, ac.signal).then(m => {
      if (!ac.signal.aborted) symbolMeta = m;
    });
    return () => ac.abort();
  });

  let symbolFullName = $derived.by(() => {
    const m = symbolMeta;
    const s = chart.loadedSymbol.trim().toUpperCase();
    if (!m || !s) return null;
    const n = m.name.trim();
    if (!n || n.toUpperCase() === s) return null;
    return n;
  });
  let symbolExchangeLabel = $derived.by(() => {
    const m = symbolMeta;
    if (!m) return null;
    const ex = m.exchange?.trim();
    return ex && ex.length > 0 ? ex : null;
  });

  let currentNotes = $derived(notesForSymbol(notes, chart.loadedSymbol));

  function handleDeleteNote(id: string) {
    notes = deleteNote(notes, id);
  }

  function handleNoteSubmit(title: string | undefined, body: string) {
    const state = dialogs.noteDialogState;
    if (!state) return;
    if (state.mode === 'create') {
      notes = addNote(notes, state.symbol, body, title);
    } else if (state.note) {
      notes = updateNote(notes, state.note.id, { title, body });
    }
  }
  let toolboxOpen = $state(false);
  let indicatorsOpen = $state(false);
  let analyticsOpen = $state(false);
  let backtestOpen = $state(false);
  let strategyOpen = $state(false);
  const indicators = new IndicatorState();
  const analytics = new AnalyticsState();
  let backtest = $state(new BacktestState());
  const strategy = new StrategyState();

  const researchShelf = new ResearchShelf();
  let researchWorkspacesOpen = $state(false);
  let dataInspectorOpen = $state(false);
  let strategyEditorShare = $state(50);
  let indicatorSplitPct = $state(60);
  let strategyTab = $state<'editor' | 'sweep' | 'portfolio' | 'docs'>('editor');
  let indicatorTab = $state<'editor' | 'docs'>('editor');
  let commandsOpen = $state(false);
  let workspaceLayout: ResearchLayout | null = null;

  function openResearchWorkspaces(): void {
    if (!researchWorkspacesOpen) workspaceLayout = currentResearchLayout();
    void activateCommand(() => (researchWorkspacesOpen = true));
  }

  function saveResearchWorkspace(name: string): boolean {
    return researchShelf.saveWorkspace(name, workspaceLayout ?? currentResearchLayout());
  }

  function closeResearchPanels(): void {
    strategyOpen = false; indicatorsOpen = false; analyticsOpen = false;
    backtestOpen = false; runsOpen = false; compareOpen = false; trialOpen = false;
    researchWorkspacesOpen = false; dataInspectorOpen = false; watchlistOpen = false;
  }

  async function activateCommand(action: () => void, focusChart = false): Promise<void> {
    closeResearchPanels();
    await tick();
    action();
    if (focusChart) requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-label="Chart"][tabindex="0"]')?.focus());
  }

  function selectChartSymbol(symbol: string, providers: SymbolProviders | null): void {
    chart.symbol = symbol;
    chart.source = pickProviderForSymbol(chart.source, providers);
    void chart.loadMarketData();
    watchlistOpen = false;
  }

  const researchCommands = $derived.by<ResearchCommand[]>(() => {
    const command = (id: string, title: string, action: () => void, group = 'Workspace', detail = ''): ResearchCommand => ({ id, title, group, detail, action: () => void activateCommand(action, group === 'Drawing' || group === 'Symbol') });
    const commands = [
      command('strategy', 'Open Strategy editor', () => { portfolioRunId = null; strategyTab = 'editor'; strategyOpen = true; }),
      command('indicators', 'Open Indicators editor', () => { indicatorTab = 'editor'; indicatorsOpen = true; }),
      command('analytics', 'Open Analytics', () => (analyticsOpen = true)),
      command('runs', 'Open Experiment notebook', () => (runsOpen = true), 'Workspace', 'runs baseline notes tags compare'),
      { id: 'workspaces', title: 'Workspaces and draft recovery', group: 'Workspace', action: openResearchWorkspaces },
      command('data', 'Inspect loaded market data', () => (dataInspectorOpen = true), 'Workspace', 'provenance coverage quality source'),
      command('robustness', 'Open Robustness', () => (trialOpen = true)),
      command('backtest', 'Open backtest results', () => { void backtest.load(); backtestOpen = true; }),
      command('cursor', 'Select chart cursor', () => (activeTool = CURSOR), 'Drawing'),
      ...listTools().map(tool => command(`drawing:${tool.type}`, tool.label, () => (activeTool = tool.type), 'Drawing')),
    ];
    const symbols = new Map(groups.flatMap(group => group.tickers).map(ticker => [ticker.symbol, ticker]));
    for (const ticker of symbols.values()) commands.push(command(`watchlist:${ticker.symbol}`, ticker.symbol, () => selectChartSymbol(ticker.symbol, ticker.providers ?? null), 'Symbol', 'watchlist'));
    if ($authState.user) {
      commands.push(...strategy.scripts.map(script => command(`strategy:${script.id}`, script.name, () => { strategy.select(script.id); portfolioRunId = null; strategyTab = 'editor'; strategyOpen = true; }, 'Strategy', 'saved script')));
      commands.push(...indicators.scripts.map(script => command(`indicator:${script.id}`, script.name, () => { indicators.openScript(script.id); indicatorTab = 'editor'; indicatorsOpen = true; }, 'Indicator', 'saved script')));
    }
    commands.push(...runsHistory.entries.map(run => command(`run:${run.run_id}`, run.label, () => openStoredRun(run.run_id), 'Run', `${run.kind} ${run.tags?.join(' ') ?? ''} ${run.baseline ? 'baseline' : ''}`)));
    return commands;
  });
  let draftBoundary = { strategy: '', indicator: '' };
  const fingerprint = (editor: StrategyState | IndicatorState) => JSON.stringify([editor.draftName, editor.draftCode]);
  $effect(() => {
    if (!sessionReady) return;
    const account = $authState.user?.id ?? null;
    untrack(() => {
      persistDrafts();
      researchShelf.setAccount(account);
      draftBoundary = { strategy: fingerprint(strategy), indicator: fingerprint(indicators) };
    });
  });

  function persistDrafts(): void {
    if (!sessionReady) return;
    for (const [kind, editor] of [['strategy', strategy], ['indicator', indicators]] as const) {
      if (editor.dirty && fingerprint(editor) === draftBoundary[kind]) continue;
      researchShelf.saveDraft(kind, editor.dirty ? {
        name: editor.draftName, code: editor.draftCode, updatedAt: new Date().toISOString(),
      } : null);
    }
  }

  $effect(() => {
    sessionReady; $authState.user?.id;
    strategy.draftCode; strategy.draftName; strategy.dirty;
    indicators.draftCode; indicators.draftName; indicators.dirty;
    researchShelf.pending.strategy; researchShelf.pending.indicator;
    const timer = setTimeout(() => untrack(persistDrafts), 500);
    return () => clearTimeout(timer);
  });
  onMount(() => {
    const flush = () => untrack(persistDrafts);
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  });

  function recoverDraft(kind: DraftKind): void {
    const draft = researchShelf.pending[kind];
    if (!draft) return;
    const editor = kind === 'strategy' ? strategy : indicators;
    if (editor.dirty && !confirm(`Replace the current ${kind} editor with the recovered local draft?`)) return;
    editor.newDraft(() => true);
    editor.setName(draft.name); editor.setCode(draft.code); editor.dirty = true;
    researchShelf.resolve(kind);
    draftBoundary[kind] = '';
    if (kind === 'strategy') strategyOpen = true;
    else indicatorsOpen = true;
    researchWorkspacesOpen = false;
  }

  function keepCurrentDraft(kind: DraftKind): void {
    researchShelf.resolve(kind);
    draftBoundary[kind] = '';
    untrack(persistDrafts);
  }

  function localRecoveryTime(kind: DraftKind): string | null {
    const editor = kind === 'strategy' ? strategy : indicators;
    const draft = researchShelf.drafts[kind];
    return !researchShelf.error && !researchShelf.pending[kind] && draft?.code === editor.draftCode && draft.name === editor.draftName ? draft.updatedAt : null;
  }

  function currentResearchLayout(): ResearchLayout {
    const updatedAt = new Date().toISOString();
    return {
      symbol: chart.symbol, provider: chart.source, interval: chart.interval, period: chart.period,
      chartType, showArea, showVolume, sma: { ...smaConfig }, ema: { ...emaConfig }, bbands: { ...bbandsConfig },
      sidebar: desktopSidebarVisible, strategyOpen, indicatorsOpen,
      strategyEditorShare, indicatorSplitPct, strategyTab, indicatorTab,
      strategy: { name: strategy.draftName, code: strategy.draftCode, updatedAt },
      indicator: { name: indicators.draftName, code: indicators.draftCode, updatedAt },
    };
  }

  function restoreResearchWorkspace(workspace: ResearchWorkspace): boolean {
    if (strategy.isRunning || indicators.isRunning) { researchShelf.error = 'Stop or finish execution before restoring a workspace.'; return false; }
    if (!confirm(`Restore “${workspace.name}”? This replaces both editors and the chart layout, but does not run scripts.`)) return false;
    const layout = workspace.layout;
    indicators.stopAll();
    chart.stopStream(); chart.autoRefresh = false;
    chart.symbol = layout.symbol; chart.source = layout.provider; chart.interval = layout.interval; chart.period = layout.period;
    chartType = layout.chartType; showArea = layout.showArea; showVolume = layout.showVolume;
    smaConfig = { ...layout.sma }; emaConfig = { ...layout.ema }; bbandsConfig = { ...layout.bbands };
    desktopSidebarVisible = layout.sidebar;
    strategyEditorShare = layout.strategyEditorShare; indicatorSplitPct = layout.indicatorSplitPct;
    strategyTab = layout.strategyTab; indicatorTab = layout.indicatorTab;
    portfolioRunId = null;
    for (const [kind, editor] of [['strategy', strategy], ['indicator', indicators]] as const) {
      editor.newDraft(() => true); editor.setName(layout[kind].name); editor.setCode(layout[kind].code); editor.dirty = true;
      researchShelf.resolve(kind); draftBoundary[kind] = '';
    }
    strategyOpen = layout.strategyOpen; indicatorsOpen = layout.indicatorsOpen;
    if (chart.source !== 'csv') void chart.loadMarketData();
    else chart.errorMessage = 'Workspace restored. Upload its CSV again; CSV bars are not part of the preset.';
    return true;
  }

  let runsOpen = $state(false);
  $effect(() => {
    const account = $authState.user?.id ?? null;
    untrack(() => runsHistory.setAccount(account));
  });
  let compareOpen = $state(false);
  let portfolioRunId = $state<string | null>(null);

  function openStoredRun(id: string): void {
    runsOpen = false;
    const entry = runsHistory.entries.find(e => e.run_id === id);
    if (entry?.kind === 'portfolio') {
      // Portfolio runs render in the Strategy panel's portfolio view. Reset
      // first so re-opening the same run re-triggers the load effect.
      portfolioRunId = null;
      portfolioRunId = id;
      strategyTab = 'portfolio';
      strategyOpen = true;
      return;
    }
    backtest = new BacktestState(storedRunLoader(id));
    void backtest.load();
    backtestOpen = true;
  }

  function openCompare(a: string, b: string): void {
    void compareState.load(a, b);
    compareOpen = true;
    runsOpen = false;
  }

  function compareAfterRerun(a: string, b: string, diff: RunDiff): void {
    compareState.setDiff(a, b, diff);
    compareOpen = true;
  }

  const toolboxTileHandlers: Record<string, () => void> = {
    Indicators: () => (indicatorsOpen = true),
    Analytics: () => (analyticsOpen = true),
    Backtesting: () => (backtestOpen = true),
    Strategy: () => (strategyOpen = true),
    Runs: () => (runsOpen = true),
    Workspaces: openResearchWorkspaces,
    Commands: () => (commandsOpen = true),
  };

  function handleToolboxTile(title: string) {
    toolboxTileHandlers[title]?.();
  }

  let lastAutoRunVersion: number | null = null;
  $effect(() => {
    const v = chart.marketDataVersion;
    if (lastAutoRunVersion === null) {
      lastAutoRunVersion = v;
      return;
    }
    if (v === lastAutoRunVersion) return;
    if (!chart.loadedSymbol) return;
    lastAutoRunVersion = v;
    untrack(() => {
      indicators.rerunAll({
        symbol: chart.loadedSymbol,
        provider: chart.source,
        period: chart.period,
        interval: chart.interval,
      });
      analytics.invalidate();
    });
  });

  $effect(() => {
    const ts = chart.liveBarCloseTs;
    if (ts === null) return;
    if (!chart.loadedSymbol) return;
    untrack(() => {
      indicators.tickAll(
        {
          symbol: chart.loadedSymbol,
          provider: chart.source,
          period: chart.period,
          interval: chart.interval,
        },
        ts,
      );
    });
  });

  $effect(() => {
    if (authed || lastRemoteUserId !== null) return;
    persistGroups(groups);
    persistSelectedGroupName(selectedGroupName);
    persistSelectedPriority(selectedPriority);
    persistSelectedStance(selectedStance);
  });
  $effect(() => {
    if (!authed) return;
    const payload = buildTickerWorkspacePayload(
      groups,
      selectedGroupName,
      selectedPriority,
      selectedStance,
    );
    untrack(() => workspaceSync.save(payload));
  });
  $effect(() => {
    if (!sessionReady) return;
    const id = $authState.user?.id ?? null;
    untrack(() => {
      if (lastRemoteUserId !== null && id !== lastRemoteUserId) {
        const g = loadGroupsFromStorage();
        groups = g;
        selectedGroupName = loadSelectedGroupName(g);
        selectedPriority = loadSelectedPriority();
        selectedStance = loadSelectedStance();
      }
      lastRemoteUserId = id;
      workspaceSync.setUser(id);
    });
  });

  let currentGroup = $derived(groups.find(g => g.name === selectedGroupName));

  function handleDuplicateGroup() {
    const result = duplicateGroup(groups, selectedGroupName);
    if (!result) return;
    groups = result.groups;
    selectedGroupName = result.newName;
  }

  function handleDeleteGroup() {
    const next = deleteGroup(groups, selectedGroupName);
    if (!next) return;
    groups = next;
    selectedGroupName = next[0].name;
  }

  function handleClearGroup() {
    groups = clearGroup(groups, selectedGroupName);
  }

  function handleGroupDialogSubmit(name: string) {
    if (dialogs.groupDialogMode === 'add') {
      groups = addGroup(groups, name);
      selectedGroupName = name;
      selectedPriority = null;
      selectedStance = null;
    } else if (dialogs.groupDialogMode === 'rename') {
      groups = renameGroup(groups, selectedGroupName, name);
      selectedGroupName = name;
    }
  }

  function handleAddSymbolSubmit(
    sym: string,
    providers: SymbolProviders | null,
  ) {
    groups = addTickerToGroup(groups, selectedGroupName, sym, providers);
  }

  function handleSelectGroup(name: string) {
    selectedGroupName = name;
    selectedPriority = null;
    selectedStance = null;
  }

  function handleSelectPriority(p: FlaggedPriority) {
    selectedPriority = p;
    selectedStance = null;
  }

  function handleSelectStance(s: FlaggedStance) {
    selectedStance = s;
    selectedPriority = null;
  }

  function handleDeleteTicker(sym: string) {
    groups = selectedPriority || selectedStance
      ? removeTickerEverywhere(groups, sym)
      : removeTickerFromGroup(groups, selectedGroupName, sym);
  }

  function handleSetPriority(sym: string, priority: TickerPriority) {
    if (selectedPriority) {
      groups = setPriorityEverywhere(groups, sym, priority);
      return;
    }
    const conflict = findPriorityConflict(
      groups,
      sym,
      priority,
      selectedGroupName,
    );
    if (conflict) {
      dialogs.showFlagConflict({ kind: 'priority', symbol: sym, desired: priority, conflict });
      return;
    }
    groups = setTickerPriority(groups, selectedGroupName, sym, priority);
  }

  function handleSetStance(sym: string, stance: TickerStance) {
    if (selectedStance) {
      groups = setStanceEverywhere(groups, sym, stance);
      return;
    }
    const conflict = findStanceConflict(
      groups,
      sym,
      stance,
      selectedGroupName,
    );
    if (conflict) {
      dialogs.showFlagConflict({ kind: 'stance', symbol: sym, desired: stance, conflict });
      return;
    }
    groups = setTickerStance(groups, selectedGroupName, sym, stance);
  }

  function resolveFlagConflictKeepExisting() {
    const c = dialogs.flagConflict;
    if (!c) return;
    if (c.kind === 'priority') {
      groups = setTickerPriority(
        groups,
        selectedGroupName,
        c.symbol,
        c.conflict.existingPriority,
      );
    } else {
      groups = setTickerStance(
        groups,
        selectedGroupName,
        c.symbol,
        c.conflict.existingStance,
      );
    }
    dialogs.clearFlagConflict();
  }

  function resolveFlagConflictSwitchGroup(groupName: string) {
    selectedGroupName = groupName;
    selectedPriority = null;
    selectedStance = null;
    dialogs.clearFlagConflict();
  }

  let groupDialogInitial = $derived(
    dialogs.groupDialogMode === 'rename' ? selectedGroupName : '',
  );
  let groupDialogExistingNames = $derived(groups.map(g => g.name));
  let currentTickers = $derived(currentGroup?.tickers ?? []);
  let currentTickerSymbols = $derived(currentTickers.map(t => t.symbol));
  let displayTickers = $derived(
    selectedStance
      ? collectTickersByStance(groups, selectedStance)
      : selectedPriority
        ? collectTickersByPriority(groups, selectedPriority)
        : currentTickers,
  );
  let priorityCountsMap = $derived(computePriorityCounts(groups));
  let stanceCountsMap = $derived(computeStanceCounts(groups));

  let tickerQuotes = $state<Record<string, TickerQuote>>({});
  let quoteUserId = $authState.user?.id ?? null;

  $effect(() => {
    const userId = $authState.user?.id ?? null;
    const currentSource = chart.source;
    const tickers = displayTickers;
    if (userId !== quoteUserId) {
      quoteUserId = userId;
      tickerQuotes = {};
    }
    let active = true;
    const isCurrent = () => active &&
      userId === ($authState.user?.id ?? null) && currentSource === chart.source;
    if (currentSource === 'csv') return;

    if (providerSupportsQuoteStream(currentSource)) {
      // Stream quotes for visible tickers; sync subscriptions to the set.
      const snapshot = untrack(() => tickerQuotes);
      const seeded: Record<string, TickerQuote> = { ...snapshot };
      let changed = false;
      for (const t of tickers) {
        const key = `${currentSource}:${t.symbol}`;
        if (!seeded[key] || seeded[key].status === 'error') {
          seeded[key] = { status: 'loading' };
          changed = true;
        }
      }
      if (changed) tickerQuotes = seeded;

      const unsubs: Array<() => void> = [];
      for (const t of tickers) {
        const key = `${currentSource}:${t.symbol}`;
        unsubs.push(
          subscribeQuoteStream(t.symbol, currentSource, price => {
            if (!isCurrent()) return;
            tickerQuotes = {
              ...tickerQuotes,
              [key]: { status: 'ok', close: price },
            };
          }),
        );
      }
      return () => {
        active = false;
        for (const u of unsubs) u();
      };
    }

    // Non-streaming providers: keep REST fallback.
    const snapshot = untrack(() => tickerQuotes);
    const missing = tickers.filter(t => {
      const entry = snapshot[`${currentSource}:${t.symbol}`];
      return !entry || entry.status !== 'ok';
    });
    if (missing.length === 0) return;

    const seeded: Record<string, TickerQuote> = { ...snapshot };
    for (const t of missing) {
      seeded[`${currentSource}:${t.symbol}`] = { status: 'loading' };
    }
    tickerQuotes = seeded;

    for (const t of missing) {
      const key = `${currentSource}:${t.symbol}`;
      fetchLastClose(t.symbol, currentSource)
        .then(close => {
          if (!isCurrent()) return;
          tickerQuotes = { ...tickerQuotes, [key]: { status: 'ok', close } };
        })
        .catch(() => {
          if (!isCurrent()) return;
          tickerQuotes = { ...tickerQuotes, [key]: { status: 'error' } };
        });
    }
    return () => { active = false; };
  });

  let tickerQuotesForGroup = $derived.by(() => {
    const out: Record<string, TickerQuote> = {};
    for (const t of displayTickers) {
      const entry = tickerQuotes[`${chart.source}:${t.symbol}`];
      if (entry) out[t.symbol] = entry;
    }
    return out;
  });
  let lastClose = $derived(
    chart.candles.length > 0 ? chart.candles[chart.candles.length - 1].close : null,
  );

  // A successful yfinance fetch is the cheapest proof that yfinance supports
  // this symbol. Once marked, we remember per-session so chart reloads and
  // untracked symbols don't keep re-POSTing.
  const markedThisSession = new Set<string>();

  function maybeMarkYFinance(
    sym: string,
    src: MarketDataProviderValue,
    candleCount: number,
  ): void {
    if (src !== 'yfinance' || candleCount === 0) return;
    if (markedThisSession.has(sym)) return;
    const cached = findTickerProviders(groups, sym);
    if (cached?.yfinance) {
      markedThisSession.add(sym);
      return;
    }
    markedThisSession.add(sym);
    markYFinanceSupported(sym);
    const nextProviders: SymbolProviders = {
      ...(cached ?? DEFAULT_PROVIDERS),
      yfinance: true,
    };
    groups = setTickerProvidersEverywhere(groups, sym, nextProviders);
  }

  // Persist chart colours and settings to localStorage only when the page unloads,
  // avoiding excessive writes during drag operations in colour pickers.
  function persistOnUnload() {
    persistChartColours(colours);
    persistChartSettings({
      chartType,
      showArea,
      showVolume,
      smaEnabled: smaConfig.enabled,
      emaEnabled: emaConfig.enabled,
      bbandsEnabled: bbandsConfig.enabled,
    });
  }

  onMount(async () => {
    window.addEventListener('beforeunload', persistOnUnload);
    try {
      await fetchSession();
    } catch (err) {
      console.warn('Session fetch failed:', err);
    }
    sessionReady = true;
    await chart.loadMarketData();
  });

  onMount(() => {
    const query = window.matchMedia('(max-width: 760px)');
    function updateLayout() {
      narrow = query.matches;
      watchlistOpen = false;
      drawingToolsOpen = false;
    }
    updateLayout();
    query.addEventListener('change', updateLayout);
    return () => query.removeEventListener('change', updateLayout);
  });

  onDestroy(() => {
    workspaceSync.destroy();
    persistOnUnload();
    window.removeEventListener('beforeunload', persistOnUnload);
  });
</script>

<svelte:window onkeydown={event => { if (isCommandShortcut(event)) { event.preventDefault(); commandsOpen = !commandsOpen; } }} />

<Dialog.Root open={trialOpen} onOpenChange={setTrialOpen}>
<div class="flex flex-col h-dvh bg-background">
  <DrawablesPersistence userId={$authState.user?.id ?? null} ready={sessionReady} />
  <TopHeader
    bind:symbol={chart.symbol}
    bind:period={chart.period}
    bind:interval={chart.interval}
    bind:source={chart.source}
    bind:autoRefresh={chart.autoRefresh}
    connectionStatus={chart.connectionStatus}
    isLoading={chart.isLoading}
    onload={chart.loadMarketData}
    onstream={chart.startStream}
    oncsvupload={chart.handleCsvUpload}
    onstrategy={() => (strategyOpen = true)}
    onworkspaces={openResearchWorkspaces}
    oninspectdata={() => (dataInspectorOpen = true)}
    loadedProvider={chart.loadedContext?.source ?? null}
    errorMessage={chart.errorMessage}
    compact={narrow}
  />
  {#if researchShelf.pending.strategy || researchShelf.pending.indicator || researchShelf.error}
    <div class="flex flex-wrap items-center gap-2 border-b px-3 py-1 text-xs" role="status">
      <span>{researchShelf.error ?? 'Recovered local drafts are available; your editors have not been replaced.'}</span>
      <button type="button" class="ot-workbench-ghost" onclick={openResearchWorkspaces}>Review recovery</button>
    </div>
  {/if}
  <ErrorMessage bind:message={chart.errorMessage} context={`${chart.symbol} · ${chart.source} · ${chart.period} / ${chart.interval}`} loadedContext={chart.candles.length && chart.loadedContext ? `${chart.loadedContext.symbol} · ${chart.loadedContext.source} · ${chart.loadedContext.period} / ${chart.loadedContext.interval}` : ''} onretry={chart.source !== 'csv' ? () => void chart.loadMarketData() : undefined} />
  {#snippet drawingToolsControl()}
    {#if narrow}
      <Popover.Root bind:open={drawingToolsOpen}>
        <Popover.Trigger class="ot-workbench-ghost" aria-label="Drawing tools" aria-pressed={activeTool !== CURSOR}>Draw</Popover.Trigger>
        <Popover.Portal><Popover.Content side="right" sideOffset={8} class="z-[60] rounded border border-border bg-popover p-2">
          <LeftToolbar nested chartSymbol={chart.symbol} bind:crosshairMode {activeTool} onToolSettings={openToolSettings} drawableCommands={drawableToolbarCommands} onActivate={tool => { activeTool = tool; drawingToolsOpen = false; }} />
        </Popover.Content></Popover.Portal>
      </Popover.Root>
    {/if}
  {/snippet}
  <div class="flex flex-1 min-h-0">
    {#if !narrow}
    <LeftToolbar
      chartSymbol={chart.symbol}
      bind:crosshairMode
      bind:activeTool
      onToolSettings={openToolSettings}
      drawableCommands={drawableToolbarCommands}
    />
    {/if}
    <ToolSettingsModal
      toolType={toolSettingsType}
      bind:open={toolSettingsOpen}
    />
  <div class="flex-1 min-w-0 min-h-0 flex flex-col">
      {#if chart.candles.length && chart.loadedContext && !chart.dataContextCurrent}
        <p class="px-3 py-2 text-xs text-muted-foreground border-b border-border" role="status">Showing last loaded data: {chart.loadedContext.symbol} · {chart.loadedContext.source} · {chart.loadedContext.period} / {chart.loadedContext.interval}. {chart.isLoading ? 'New request loading…' : 'Load the current context to update.'}</p>
      {/if}
      <Chart
        candles={chart.candles}
        candleRevision={chart.candleRevision}
        annotationOwner={sessionReady ? ($authState.user ? `user:${$authState.user.id}` : 'guest') : 'pending'}
        symbol={chart.loadedSymbol || chart.symbol}
        {chartType}
        {showArea}
        {showVolume}
        smaPoints={sma.points}
        emaPoints={ema.points}
        bbandsPoints={bbands.points}
        smaLineWidth={smaConfig.lineWidth}
        emaLineWidth={emaConfig.lineWidth}
        bbandsLineWidth={bbandsConfig.lineWidth}
        {colours}
        {crosshairMode}
        provider={chart.loadedContext?.source ?? chart.source}
        interval={chart.loadedContext?.interval ?? chart.interval}
        runningScripts={indicators.runningOutputs}
        bind:activeTool
        bind:api={chart.chartApi}
        comparisons={comparisonController.comparisons}
        onRemoveComparison={id => void comparisonController.remove(id)}
        onSetComparisonColor={(id, c) => void comparisonController.setColor(id, c)}
        onSetComparisonSeriesType={(id, t) =>
          void comparisonController.setSeriesType(id, t)}
      />
    </div>
    {#snippet watchlistContent()}
      <Sidebar
        sheet={narrow}
        symbol={chart.loadedSymbol}
        symbolFullName={symbolFullName}
        symbolExchange={symbolExchangeLabel}
        closePrice={lastClose}
        {groups}
        {selectedGroupName}
        {selectedPriority}
        {selectedStance}
        priorityCounts={priorityCountsMap}
        stanceCounts={stanceCountsMap}
        tickers={displayTickers}
        quotes={tickerQuotesForGroup}
        groupActions={{
          select: handleSelectGroup,
          rename: () => void openWatchlistDialog(dialogs.openRenameGroup),
          duplicate: handleDuplicateGroup,
          clear: handleClearGroup,
          add: () => void openWatchlistDialog(dialogs.openAddGroup),
          delete: handleDeleteGroup,
        }}
        onaddticker={() => void openWatchlistDialog(dialogs.openAddSymbol)}
        onselectpriority={handleSelectPriority}
        onselectstance={handleSelectStance}
        onselectticker={sym => selectChartSymbol(sym, findTickerProviders(groups, sym))}
        ondeleteticker={handleDeleteTicker}
        onsetpriority={handleSetPriority}
        onsetstance={handleSetStance}
        notes={currentNotes}
        onaddnote={symbol => void openWatchlistDialog(() => dialogs.openAddNote(symbol))}
        oneditnote={note => void openWatchlistDialog(() => dialogs.openEditNote(note))}
        ondeletenote={handleDeleteNote}
      />
    {/snippet}
    {#if narrow}
      <Dialog.Root bind:open={watchlistOpen}>
        <Dialog.Content class="left-auto right-0 top-0 h-dvh w-[min(360px,100vw)] max-w-none translate-x-0 translate-y-0 rounded-none p-0 flex flex-col gap-0" >
          <Dialog.Title class="px-3 py-3 pr-12 font-mono text-sm border-b border-border">Watchlist</Dialog.Title>
          <Dialog.Description class="sr-only">Symbols, groups and notes for the current research workspace.</Dialog.Description>
          {@render watchlistContent()}
        </Dialog.Content>
      </Dialog.Root>
    {:else if sidebarVisible}
      {@render watchlistContent()}
    {/if}
  </div>
  <BottomHeader
    drawingTools={drawingToolsControl}
    bind:chartType
    bind:showArea
    bind:showVolume
    bind:smaConfig
    bind:emaConfig
    bind:bbandsConfig
    bind:colours
    {theme}
    onthemechange={setTheme}
    {sidebarVisible}
    ontogglesidebar={() => { if (narrow) watchlistOpen = !watchlistOpen; else desktopSidebarVisible = !desktopSidebarVisible; }}
    comparisonCount={comparisonController.comparisons.length}
    oncompare={() => (comparisonDialogOpen = true)}
  />
  <ToolboxPanel
    bind:open={toolboxOpen}
    {theme}
    onTileSelect={handleToolboxTile}
  />
  <IndicatorsPanel
    bind:tab={indicatorTab}
    bind:splitPct={indicatorSplitPct}
    recoverySavedAt={localRecoveryTime('indicator')}
    bind:open={indicatorsOpen}
    symbol={chart.loadedSymbol || chart.symbol}
    provider={chart.source}
    period={chart.period}
    interval={chart.interval}
    {indicators}
  />
  <AnalyticsPanel
    bind:open={analyticsOpen}
    symbol={chart.loadedSymbol || chart.symbol}
    {analytics}
  />
  <BacktestPanel bind:open={backtestOpen} {backtest} onCompareAfterRerun={compareAfterRerun} onOpenRuns={() => (runsOpen = true)} onCompare={openCompare} />
  <RecentRunsPanel bind:open={runsOpen} onOpenRun={openStoredRun} onCompare={openCompare} />
  <ResearchWorkspacesDialog bind:open={researchWorkspacesOpen} shelf={researchShelf} onSave={saveResearchWorkspace} onRestore={restoreResearchWorkspace} onRecover={recoverDraft} onKeep={keepCurrentDraft} />
  <DataInspector bind:open={dataInspectorOpen} {chart} />
  <CommandPalette
    bind:open={commandsOpen}
    commands={researchCommands}
    onSymbol={(symbol, providers) => void activateCommand(() => selectChartSymbol(symbol, providers), true)}
    onLoadScripts={() => { if ($authState.user) { void strategy.load(); void indicators.refresh(); } }}
    scriptStatus={!$authState.user ? 'Sign in to browse account scripts. Local commands and notebook references are available.' : strategy.loading || indicators.loading ? 'Loading saved scripts…' : [strategy.loadError, indicators.loadError].filter(Boolean).join(' · ')}
  />
  <CompareView bind:open={compareOpen} compare={compareState} />
  <StrategyPanel
    bind:tab={strategyTab}
    bind:editorShare={strategyEditorShare}
    recoverySavedAt={localRecoveryTime('strategy')}
    bind:open={strategyOpen}
    symbol={chart.loadedSymbol || chart.symbol}
    provider={chart.source}
    period={chart.period}
    interval={chart.interval}
    {strategy}
    onOpenRuns={() => (runsOpen = true)}
    onCompare={openCompare}
    {portfolioRunId}
    onRobustness={() => { strategyOpen = false; setTrialOpen(true); }}
  />
  <AppDialogs
    {groupDialogInitial}
    {groupDialogExistingNames}
    existingSymbols={currentTickerSymbols}
    onGroupDialogSubmit={handleGroupDialogSubmit}
    onAddSymbolSubmit={handleAddSymbolSubmit}
    onNoteSubmit={handleNoteSubmit}
    onResolveFlagConflictKeepExisting={resolveFlagConflictKeepExisting}
    onResolveFlagConflictSwitchGroup={resolveFlagConflictSwitchGroup}
  />
  <SymbolSearchDialog
    mode="comparison"
    open={comparisonDialogOpen}
    onopenchange={v => (comparisonDialogOpen = v)}
    existingSymbols={[
      chart.loadedSymbol,
      ...comparisonController.comparisons.map(c => c.symbol),
    ]}
    onsubmit={(sym, providers) =>
      void comparisonController.add(
        chart.loadedSymbol,
        sym,
        providers,
        chart.source,
      )}
  />
</div>
  <Dialog.Content class="flex h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-none flex-col gap-0 overflow-hidden rounded-md p-0 sm:max-w-6xl">
    <Dialog.Title class="sr-only">Robustness checks</Dialog.Title>
    <Dialog.Description class="sr-only">Compare execution costs, chronological holdout, parameter sensitivity and benchmarks for your workspace strategy and selected market data, or explore built-in synthetic examples. Your research workspace stays open behind this panel.</Dialog.Description>
    <div class="min-h-0 flex-1 overflow-hidden">
      <StrategyTrial embedded
        workspace={{ code: strategy.draftCode, name: strategy.draftName, symbol: chart.loadedSymbol || chart.symbol, provider: chart.source, period: chart.period, interval: chart.interval }}
        onopenstrategy={() => { setTrialOpen(false); strategyOpen = true; }}
        onreturnworkspace={() => setTrialOpen(false)} />
    </div>
  </Dialog.Content>
</Dialog.Root>

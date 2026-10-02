<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
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
    putTickerWorkspace,
    syncWorkspaceOnSignIn,
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
    onSymbolFetched: (sym, src, count) => maybeMarkYFinance(sym, src, count),
  });

  const comparisonController = new ComparisonController({
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
    fetch: (sym, [period]) =>
      fetchSMA(sym, period as number).then(r => r.points),
    onError: indicatorErrorHandler,
    label: 'SMA',
  });
  const ema = useIndicatorEffect<IndicatorPoint>({
    enabled: () => emaConfig.enabled,
    hasCandles: () => hasCandles,
    symbol: () => chart.loadedSymbol,
    version: () => chart.marketDataVersion,
    args: () => [emaConfig.period],
    fetch: (sym, [period]) =>
      fetchEMA(sym, period as number).then(r => r.points),
    onError: indicatorErrorHandler,
    label: 'EMA',
  });
  const bbands = useIndicatorEffect<BollingerBandsPoint>({
    enabled: () => bbandsConfig.enabled,
    hasCandles: () => hasCandles,
    symbol: () => chart.loadedSymbol,
    version: () => chart.marketDataVersion,
    args: () => [bbandsConfig.period, bbandsConfig.stdDev],
    fetch: (sym, [period, stdDev]) =>
      fetchBBands(sym, period as number, stdDev as number).then(r => r.points),
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
  let sidebarVisible = $state(true);
  let crosshairMode = $state<CrosshairModeName>('normal');
  let activeTool = $state<ActiveTool>(CURSOR);
  let toolSettingsOpen = $state(false);
  let toolSettingsType = $state<string | null>(null);

  function openToolSettings(type: string): void {
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
  let remoteTickerLoadDone = $state(false);
  let sessionReady = $state(false);
  const dialogs = new AppDialogsState();
  provideAppDialogs(dialogs);

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

  let runsOpen = $state(false);
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
    if (authed) return;
    persistGroups(groups);
    persistSelectedGroupName(selectedGroupName);
    persistSelectedPriority(selectedPriority);
    persistSelectedStance(selectedStance);
  });
  let lastPushedPayloadJson: string | null = null;
  $effect(() => {
    if (!authed || !remoteTickerLoadDone) return;
    const payload = buildTickerWorkspacePayload(
      groups,
      selectedGroupName,
      selectedPriority,
      selectedStance,
    );
    const json = JSON.stringify(payload);
    if (json === lastPushedPayloadJson) return;
    const t = setTimeout(() => {
      void putTickerWorkspace(payload)
        .then(() => {
          lastPushedPayloadJson = json;
        })
        .catch((err: unknown) => {
          console.warn('[openquant] Ticker workspace sync failed', err);
        });
    }, 500);
    return () => clearTimeout(t);
  });
  $effect(() => {
    if (!sessionReady) return;
    const u = $authState.user;
    const id = u?.id ?? null;
    if (id && id !== lastRemoteUserId) {
      lastRemoteUserId = id;
      void (async () => {
        remoteTickerLoadDone = false;
        try {
          const next = await syncWorkspaceOnSignIn({
            groups,
            selectedGroupName,
            selectedPriority,
            selectedStance,
          });
          if (next) {
            groups = next.groups;
            selectedGroupName = next.selectedGroupName;
            selectedPriority = next.selectedPriority;
            selectedStance = next.selectedStance;
          }
          lastPushedPayloadJson = JSON.stringify(
            buildTickerWorkspacePayload(
              groups,
              selectedGroupName,
              selectedPriority,
              selectedStance,
            ),
          );
        } catch (e) {
          console.warn('[openquant] Ticker workspace load failed', e);
        }
        clearTickerLocalStorage();
        remoteTickerLoadDone = true;
      })();
    } else if (!id && lastRemoteUserId) {
      const g = loadGroupsFromStorage();
      groups = g;
      selectedGroupName = loadSelectedGroupName(g);
      selectedPriority = loadSelectedPriority();
      selectedStance = loadSelectedStance();
      lastRemoteUserId = null;
      lastPushedPayloadJson = null;
      remoteTickerLoadDone = true;
    }
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

  $effect(() => {
    const currentSource = chart.source;
    const tickers = displayTickers;
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
            tickerQuotes = {
              ...tickerQuotes,
              [key]: { status: 'ok', close: price },
            };
          }),
        );
      }
      return () => {
        for (const u of unsubs) u();
      };
    }

    // Non-streaming providers: keep REST fallback.
    const snapshot = untrack(() => tickerQuotes);
    const missing = tickers.filter(t => {
      const entry = snapshot[`${currentSource}:${t.symbol}`];
      return !entry || entry.status === 'error';
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
          tickerQuotes = { ...tickerQuotes, [key]: { status: 'ok', close } };
        })
        .catch(() => {
          tickerQuotes = { ...tickerQuotes, [key]: { status: 'error' } };
        });
    }
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

  onDestroy(() => {
    persistOnUnload();
    window.removeEventListener('beforeunload', persistOnUnload);
  });
</script>

<Dialog.Root open={trialOpen} onOpenChange={setTrialOpen}>
<div class="flex flex-col h-screen bg-background">
  <DrawablesPersistence />
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
  />
  <ErrorMessage bind:message={chart.errorMessage} />
  <div class="flex flex-1 min-h-0">
    <LeftToolbar
      chartSymbol={chart.symbol}
      bind:crosshairMode
      bind:activeTool
      onToolSettings={openToolSettings}
      drawableCommands={drawableToolbarCommands}
    />
    <ToolSettingsModal
      toolType={toolSettingsType}
      bind:open={toolSettingsOpen}
    />
    <div class="flex-1 min-w-0 min-h-0 flex flex-col">
      <Chart
        candles={chart.candles}
        symbol={chart.symbol}
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
        provider={chart.source}
        interval={chart.interval}
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
    {#if sidebarVisible}
      <Sidebar
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
          rename: dialogs.openRenameGroup,
          duplicate: handleDuplicateGroup,
          clear: handleClearGroup,
          add: dialogs.openAddGroup,
          delete: handleDeleteGroup,
        }}
        onaddticker={dialogs.openAddSymbol}
        onselectpriority={handleSelectPriority}
        onselectstance={handleSelectStance}
        onselectticker={sym => {
          chart.symbol = sym;
          const providers = findTickerProviders(groups, sym);
          const next = pickProviderForSymbol(chart.source, providers);
          if (next !== chart.source) chart.source = next;
          void chart.loadMarketData();
        }}
        ondeleteticker={handleDeleteTicker}
        onsetpriority={handleSetPriority}
        onsetstance={handleSetStance}
        notes={currentNotes}
        onaddnote={dialogs.openAddNote}
        oneditnote={dialogs.openEditNote}
        ondeletenote={handleDeleteNote}
      />
    {/if}
  </div>
  <BottomHeader
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
    ontogglesidebar={() => (sidebarVisible = !sidebarVisible)}
    comparisonCount={comparisonController.comparisons.length}
    oncompare={() => (comparisonDialogOpen = true)}
  />
  <ToolboxPanel
    bind:open={toolboxOpen}
    {theme}
    onTileSelect={handleToolboxTile}
  />
  <IndicatorsPanel
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
  <BacktestPanel bind:open={backtestOpen} {backtest} onCompareAfterRerun={compareAfterRerun} onOpenRuns={() => (runsOpen = true)} />
  <RecentRunsPanel bind:open={runsOpen} onOpenRun={openStoredRun} onCompare={openCompare} />
  <CompareView bind:open={compareOpen} compare={compareState} />
  <StrategyPanel
    bind:open={strategyOpen}
    symbol={chart.loadedSymbol || chart.symbol}
    provider={chart.source}
    period={chart.period}
    interval={chart.interval}
    {strategy}
    onOpenRuns={() => (runsOpen = true)}
    {portfolioRunId}
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
    <Dialog.Title class="sr-only">Strategy on Trial</Dialog.Title>
    <Dialog.Description class="sr-only">A guided educational demo of execution costs, holdout tests and benchmarks. Your research workspace stays open behind this panel.</Dialog.Description>
    <div class="min-h-0 flex-1 overflow-y-auto">
      <StrategyTrial embedded onreturnworkspace={() => setTrialOpen(false)} />
    </div>
  </Dialog.Content>
</Dialog.Root>

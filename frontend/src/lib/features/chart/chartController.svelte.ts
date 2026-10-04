import { onDestroy, untrack } from 'svelte';
import { apiFetch, readErrorMessage } from '$lib/core/api';
import { WSClient, type ConnectionStatus } from '$lib/core/ws';
import type { OHLCVCandle } from '$lib/core/types';
import { fetchMarketOHLCV } from '$lib/features/market/marketData';
import { DEFAULT_MARKET_INTERVAL } from '$lib/features/market/marketIntervals';
import { DEFAULT_MARKET_PERIOD } from '$lib/features/market/marketPeriods';
import {
  providerSupportsWs,
  type MarketDataProviderValue,
} from '$lib/features/market/marketDataProviders';
import {
  subscribeMarketStream,
  mergeCandleSnapshot,
  type StreamStatus,
} from '$lib/features/market/streaming';

export type ChartApiLike = { appendCandle: (c: OHLCVCandle) => void };

interface ChartContext {
  userId: string | null;
  symbol: string;
  source: MarketDataProviderValue;
  period: string;
  interval: string;
}

export interface ChartControllerOptions {
  userId?: () => string | null;
  initialSymbol?: string;
  initialSource?: MarketDataProviderValue;
  onSymbolFetched?: (
    symbol: string,
    source: MarketDataProviderValue,
    candleCount: number,
  ) => void;
}

export class ChartController {
  symbol = $state('AAPL');
  loadedSymbol = $state('');
  period = $state<string>(DEFAULT_MARKET_PERIOD);
  interval = $state<string>(DEFAULT_MARKET_INTERVAL);
  source = $state<MarketDataProviderValue>('yfinance');
  autoRefresh = $state(false);

  errorMessage = $state<string | null>(null);
  connectionStatus = $state<ConnectionStatus>('disconnected');
  candles = $state<OHLCVCandle[]>([]);
  chartApi = $state<ChartApiLike | null>(null);
  isLoading = $state(false);
  marketDataVersion = $state(0);
  initialLoadDone = $state(false);
  liveBarCloseTs = $state<number | null>(null);

  #wsClient: WSClient | null = null;
  #liveUnsubscribe: (() => void) | null = null;
  #refreshIntervalId: ReturnType<typeof setInterval> | null = null;
  #onSymbolFetched?: ChartControllerOptions['onSymbolFetched'];
  #loadGeneration = 0;
  #streamGeneration = 0;
  #streamEnabled = true;
  #loadedContext: ChartContext | null = null;
  #userId: () => string | null;
  #sessionUser: string | null;
  #requestedTimeframe: string | null = null;

  constructor(opts: ChartControllerOptions = {}) {
    this.#userId = opts.userId ?? (() => null);
    this.#sessionUser = this.#userId();
    if (opts.initialSymbol !== undefined) this.symbol = opts.initialSymbol;
    if (opts.initialSource !== undefined) this.source = opts.initialSource;
    this.#onSymbolFetched = opts.onSymbolFetched;

    $effect(() => {
      this.#userId();
      untrack(() => this.syncSession());
    });

    $effect(() => {
      if (this.#refreshIntervalId) {
        clearInterval(this.#refreshIntervalId);
        this.#refreshIntervalId = null;
      }
      if (this.autoRefresh) {
        this.#refreshIntervalId = setInterval(() => {
          if (this.source !== 'csv') {
            void this.loadMarketData();
          }
        }, 60_000);
      }
    });

    $effect(() => {
      const timeframe = JSON.stringify([this.period, this.interval]);
      const ready = this.initialLoadDone;
      untrack(() => {
        if (!ready || this.source === 'csv') return;
        if (timeframe === this.#requestedTimeframe) return;
        void this.loadMarketData();
      });
    });

    onDestroy(() => {
      this.#loadGeneration += 1;
      if (this.#refreshIntervalId) clearInterval(this.#refreshIntervalId);
      this.#disconnectStreams();
    });
  }

  syncSession(): void {
    const userId = this.#userId();
    if (userId === this.#sessionUser) return;
    this.#sessionUser = userId;
    const reload = this.initialLoadDone || this.isLoading;
    this.#loadGeneration++;
    this.#disconnectStreams();
    this.isLoading = false;
    if (this.source === 'twelvedata' || this.source === 'csv') {
      this.candles = [];
      this.loadedSymbol = '';
      this.#loadedContext = null;
      this.marketDataVersion++;
    }
    if (reload && this.source !== 'csv') {
      if (this.source === 'twelvedata' && !userId) {
        this.errorMessage = 'Sign in to load Twelve Data market data.';
      } else {
        void this.loadMarketData();
      }
    }
  }

  get loadedContext(): Readonly<ChartContext> | null {
    this.marketDataVersion;
    return this.#loadedContext;
  }

  get dataContextCurrent(): boolean {
    return (
      this.loadedContext !== null && this.#contextMatches(this.loadedContext)
    );
  }

  loadMarketData = async (): Promise<void> => {
    const generation = ++this.#loadGeneration;
    const context = this.#context();
    this.#requestedTimeframe = JSON.stringify([
      context.period,
      context.interval,
    ]);
    this.#disconnectStreams();
    if (context.source === 'csv') {
      this.errorMessage =
        'Choose a CSV file with the Load button, or pick another data source.';
      this.isLoading = false;
      this.initialLoadDone = true;
      return;
    }
    this.errorMessage = null;
    this.isLoading = true;
    try {
      const data = await fetchMarketOHLCV(
        context.symbol,
        context.source,
        context.period,
        context.interval,
      );
      if (!this.#isCurrentLoad(generation, context)) return;
      this.candles = data.candles ?? [];
      this.loadedSymbol = context.symbol;
      this.#loadedContext = context;
      this.marketDataVersion += 1;
      this.#onSymbolFetched?.(
        context.symbol,
        context.source,
        data.candles?.length ?? 0,
      );
      if (this.#streamEnabled && providerSupportsWs(context.source)) {
        this.#startLiveStream(context.source, context.symbol, context.interval);
      }
    } catch (e) {
      if (this.#isCurrentLoad(generation, context)) {
        this.errorMessage = e instanceof Error ? e.message : 'Failed to load';
      }
    } finally {
      if (generation === this.#loadGeneration) {
        this.isLoading = false;
        this.initialLoadDone = true;
      }
    }
  };

  startStream = (): void => {
    // Toggle: if a stream is already active, clicking Stream stops it.
    if (this.#liveUnsubscribe || this.#wsClient) {
      this.stopStream();
      return;
    }
    const sym = this.symbol.trim();
    if (!sym) {
      this.errorMessage = 'Enter a symbol';
      return;
    }
    this.errorMessage = null;
    this.#streamEnabled = true;
    if (this.isLoading) return;
    if (this.source === 'csv') {
      this.#startWsStream('csv', sym);
      return;
    }
    if (!providerSupportsWs(this.source)) {
      this.errorMessage = `Live streaming is not available for ${this.source}.`;
      return;
    }
    if (!this.#loadedContext || !this.#contextMatches(this.#loadedContext)) {
      void this.loadMarketData();
      return;
    }
    this.#startLiveStream(this.source, sym, this.interval);
  };

  stopStream = (): void => {
    this.#streamEnabled = false;
    this.#disconnectStreams();
  };

  #context(): ChartContext {
    return {
      userId: this.#userId(),
      symbol: this.symbol.trim(),
      source: this.source,
      period: this.period,
      interval: this.interval,
    };
  }

  #contextMatches(context: ChartContext): boolean {
    return (
      context.userId === this.#userId() &&
      context.symbol === this.symbol.trim() &&
      context.source === this.source &&
      context.period === this.period &&
      context.interval === this.interval
    );
  }

  #isCurrentLoad(generation: number, context: ChartContext): boolean {
    return generation === this.#loadGeneration && this.#contextMatches(context);
  }

  #disconnectStreams(): void {
    this.#streamGeneration += 1;
    if (this.#liveUnsubscribe) {
      this.#liveUnsubscribe();
      this.#liveUnsubscribe = null;
    }
    if (this.#wsClient) {
      this.#wsClient.disconnect();
      this.#wsClient = null;
    }
    this.connectionStatus = 'disconnected';
    this.liveBarCloseTs = null;
  }

  #startLiveStream(
    provider: MarketDataProviderValue,
    sym: string,
    interval: string,
  ): void {
    this.#disconnectStreams();
    const generation = this.#streamGeneration;
    const context = this.#context();
    const isCurrent = () =>
      generation === this.#streamGeneration && this.#contextMatches(context);

    const existing = this.candles ?? [];
    const historyEndIso = existing.length
      ? existing[existing.length - 1].timestamp
      : undefined;
    this.candles = existing.slice();
    let liveCandles = this.candles;

    const mapStatus = (s: StreamStatus): ConnectionStatus =>
      s === 'connected'
        ? 'connected'
        : s === 'connecting'
          ? 'connecting'
          : s === 'error'
            ? 'error'
            : 'disconnected';

    this.#liveUnsubscribe = subscribeMarketStream({
      provider,
      symbol: sym,
      interval,
      historyEndIso,
      onSnapshot: snapshot => {
        if (!isCurrent()) return;
        const merged = mergeCandleSnapshot(liveCandles, snapshot);
        if (merged.length === liveCandles.length) return;
        this.candles = merged;
        liveCandles = this.candles;
      },
      onCandle: (c, _isFinal) => {
        if (!isCurrent()) return;
        const last = liveCandles[liveCandles.length - 1];
        if (last && Date.parse(last.timestamp) === Date.parse(c.timestamp)) {
          liveCandles[liveCandles.length - 1] = c;
        } else {
          liveCandles.push(c);
        }
        this.chartApi?.appendCandle(c);
      },
      onCandleClose: c => {
        if (!isCurrent()) return;
        const ts = Date.parse(c.timestamp);
        if (Number.isFinite(ts)) this.liveBarCloseTs = ts;
      },
      onStatus: s => {
        if (!isCurrent()) return;
        this.connectionStatus = mapStatus(s);
      },
    });
  }

  handleCsvUpload = async (file: File): Promise<void> => {
    const generation = ++this.#loadGeneration;
    const context = this.#context();
    const sym = context.symbol || 'CSV';
    this.#disconnectStreams();
    this.#streamEnabled = true;
    this.errorMessage = null;
    this.isLoading = true;
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await apiFetch(
        `/data/csv?symbol=${encodeURIComponent(sym)}`,
        { method: 'POST', body: form },
      );
      if (!res.ok) throw new Error(await readErrorMessage(res));
      await res.json();
      if (!this.#isCurrentLoad(generation, context)) return;
      this.loadedSymbol = sym;
      this.#loadedContext = context;
      this.marketDataVersion += 1;
      this.#onSymbolFetched?.(sym, 'csv', 0);
      if (this.#streamEnabled) this.#startWsStream('csv', sym);
    } catch (e) {
      if (this.#isCurrentLoad(generation, context)) {
        this.errorMessage = e instanceof Error ? e.message : 'Upload failed';
      }
    } finally {
      if (generation === this.#loadGeneration) {
        this.isLoading = false;
        this.initialLoadDone = true;
      }
    }
  };

  #startWsStream(
    provider: MarketDataProviderValue,
    sym: string,
    opts: { reconnectDelayMs?: number; maxReconnectAttempts?: number } = {},
  ): void {
    this.#disconnectStreams();
    const generation = this.#streamGeneration;
    const context = this.#context();
    const isCurrent = () =>
      generation === this.#streamGeneration && this.#contextMatches(context);
    this.candles = [];
    const streamCandles = this.candles;
    this.#wsClient = new WSClient({
      provider,
      symbol: sym,
      maxReconnectAttempts: 0,
      onCandle: c => {
        if (!isCurrent()) return;
        const last = streamCandles[streamCandles.length - 1];
        if (last && Date.parse(last.timestamp) === Date.parse(c.timestamp)) {
          streamCandles[streamCandles.length - 1] = c;
        } else {
          streamCandles.push(c);
        }
        this.chartApi?.appendCandle(c);
      },
      onStatus: s => {
        if (!isCurrent()) return;
        this.connectionStatus = s;
        if (s === 'disconnected') this.#wsClient = null;
      },
      ...opts,
    });
    this.#wsClient.connect();
  }
}

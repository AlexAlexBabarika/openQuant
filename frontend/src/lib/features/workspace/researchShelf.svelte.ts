import {
  MARKET_DATA_PROVIDERS,
  type MarketDataProviderValue,
} from '$lib/features/market/marketDataProviders';
import { MARKET_INTERVAL_OPTIONS } from '$lib/features/market/marketIntervals';
import { MARKET_PERIOD_OPTIONS } from '$lib/features/market/marketPeriods';

export type DraftKind = 'strategy' | 'indicator';
export type LocalDraft = { name: string; code: string; updatedAt: string };
export type ResearchLayout = {
  symbol: string;
  provider: MarketDataProviderValue;
  period: string;
  interval: string;
  chartType: 'candlestick' | 'line';
  showArea: boolean;
  showVolume: boolean;
  sma: { enabled: boolean; period: number; lineWidth: number };
  ema: { enabled: boolean; period: number; lineWidth: number };
  bbands: {
    enabled: boolean;
    period: number;
    stdDev: number;
    lineWidth: number;
  };
  sidebar: boolean;
  strategyOpen: boolean;
  indicatorsOpen: boolean;
  strategyEditorShare: number;
  indicatorSplitPct: number;
  strategyTab: 'editor' | 'sweep' | 'portfolio' | 'docs';
  indicatorTab: 'editor' | 'docs';
  strategy: LocalDraft;
  indicator: LocalDraft;
};
export type ResearchWorkspace = {
  id: string;
  name: string;
  updatedAt: string;
  layout: ResearchLayout;
};

function validDraft(value: unknown): value is LocalDraft {
  if (!value || typeof value !== 'object') return false;
  const d = value as LocalDraft;
  return (
    typeof d.name === 'string' &&
    d.name.length <= 120 &&
    typeof d.code === 'string' &&
    d.code.length <= 1000000 &&
    typeof d.updatedAt === 'string' &&
    Number.isFinite(Date.parse(d.updatedAt))
  );
}

export function validLayout(value: unknown): value is ResearchLayout {
  if (!value || typeof value !== 'object') return false;
  const l = value as ResearchLayout;
  const ma = (m: ResearchLayout['sma']) =>
    m &&
    typeof m.enabled === 'boolean' &&
    Number.isInteger(m.period) &&
    m.period > 0 &&
    m.period <= 10000 &&
    Number.isInteger(m.lineWidth) &&
    m.lineWidth >= 1 &&
    m.lineWidth <= 4;
  return (
    typeof l.symbol === 'string' &&
    l.symbol.length <= 100 &&
    MARKET_DATA_PROVIDERS.some(p => p.value === l.provider) &&
    MARKET_INTERVAL_OPTIONS.some(p => p.value === l.interval) &&
    MARKET_PERIOD_OPTIONS.some(p => p.value === l.period) &&
    ['candlestick', 'line'].includes(l.chartType) &&
    ['editor', 'sweep', 'portfolio', 'docs'].includes(l.strategyTab) &&
    ['editor', 'docs'].includes(l.indicatorTab) &&
    [
      l.showArea,
      l.showVolume,
      l.sidebar,
      l.strategyOpen,
      l.indicatorsOpen,
    ].every(v => typeof v === 'boolean') &&
    ma(l.sma) &&
    Number.isFinite(l.strategyEditorShare) &&
    l.strategyEditorShare >= 25 &&
    l.strategyEditorShare <= 75 &&
    Number.isFinite(l.indicatorSplitPct) &&
    l.indicatorSplitPct >= 22 &&
    l.indicatorSplitPct <= 82 &&
    ma(l.ema) &&
    ma(l.bbands) &&
    Number.isFinite(l.bbands.stdDev) &&
    l.bbands.stdDev > 0 &&
    l.bbands.stdDev <= 10 &&
    validDraft(l.strategy) &&
    validDraft(l.indicator)
  );
}

export class ResearchShelf {
  workspaces = $state<ResearchWorkspace[]>([]);
  pending = $state<Partial<Record<DraftKind, LocalDraft>>>({});
  drafts = $state<Partial<Record<DraftKind, LocalDraft>>>({});
  error = $state<string | null>(null);
  #key = '';
  #storage: Storage | null;
  #readFailed = false;

  constructor(storage?: Storage) {
    try {
      this.#storage =
        storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    } catch {
      this.#storage = null;
    }
  }

  setAccount(id: string | null): void {
    const key = `openquant.research.v1:${id ? `account:${encodeURIComponent(id)}` : 'guest'}`;
    if (key === this.#key) return;
    this.#key = key;
    this.#readFailed = false;
    this.workspaces = [];
    this.drafts = {};
    this.pending = {};
    this.error = null;
    try {
      const raw = this.#storage?.getItem(key);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved?.version !== 1)
        throw new Error('Unsupported stored research version');
      this.workspaces = Array.isArray(saved.workspaces)
        ? saved.workspaces
            .filter(
              (w: ResearchWorkspace) =>
                w &&
                typeof w.id === 'string' &&
                typeof w.name === 'string' &&
                typeof w.updatedAt === 'string' &&
                validLayout(w.layout),
            )
            .slice(0, 10)
        : [];
      for (const kind of ['strategy', 'indicator'] as const)
        if (validDraft(saved.drafts?.[kind]))
          this.drafts[kind] = saved.drafts[kind];
      this.pending = { ...this.drafts };
    } catch {
      this.#readFailed = true;
      this.error =
        'Saved research could not be read. Existing browser data has not been overwritten; local saving is paused until storage is repaired.';
    }
  }

  #persist(): void {
    if (this.#readFailed) return;
    try {
      if (!this.#storage) throw new Error('Storage unavailable');
      this.#storage.setItem(
        this.#key,
        JSON.stringify({
          version: 1,
          drafts: this.drafts,
          workspaces: this.workspaces,
        }),
      );
      this.error = null;
    } catch {
      this.error =
        'Browser storage is unavailable or full. Changes are in memory only; copy important code before closing.';
    }
  }

  saveDraft(kind: DraftKind, draft: LocalDraft | null): void {
    if (!this.#key || this.pending[kind]) return;
    if (draft && !validDraft(draft)) {
      this.error =
        'This draft exceeds local recovery limits (120-character name, 1 million characters of code). Copy it before closing.';
      return;
    }
    const previous = this.drafts[kind];
    if (previous?.name === draft?.name && previous?.code === draft?.code)
      return;
    if (draft) this.drafts[kind] = draft;
    else delete this.drafts[kind];
    this.#persist();
  }

  resolve(kind: DraftKind): void {
    delete this.pending[kind];
  }

  saveWorkspace(name: string, layout: ResearchLayout): boolean {
    if (!name.trim() || !validLayout(layout)) return false;
    if (this.workspaces.length >= 10) {
      this.error =
        'The browser holds at most 10 workspaces. Remove one before saving another.';
      return false;
    }
    this.workspaces = [
      {
        id: crypto.randomUUID(),
        name: name.trim().slice(0, 120),
        updatedAt: new Date().toISOString(),
        layout: structuredClone($state.snapshot(layout)),
      },
      ...this.workspaces,
    ];
    this.#persist();
    return true;
  }

  removeWorkspace(id: string): void {
    this.workspaces = this.workspaces.filter(w => w.id !== id);
    this.#persist();
  }
}

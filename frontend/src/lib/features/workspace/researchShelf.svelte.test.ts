import { describe, it, expect } from 'vitest';
import {
  ResearchShelf,
  validLayout,
  type ResearchLayout,
} from './researchShelf.svelte';

function storage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => map.set(k, v),
  } as unknown as Storage;
}
const draft = {
  name: 'Research draft',
  code: 'print(1)',
  updatedAt: '2026-01-01T00:00:00Z',
};
const layout: ResearchLayout = {
  symbol: 'SPY',
  provider: 'yfinance',
  period: '1y',
  interval: '1d',
  chartType: 'candlestick',
  showArea: true,
  showVolume: true,
  sidebar: true,
  strategyOpen: true,
  indicatorsOpen: false,
  strategyEditorShare: 50,
  indicatorSplitPct: 60,
  strategyTab: 'editor',
  indicatorTab: 'editor',
  sma: { enabled: true, period: 20, lineWidth: 2 },
  ema: { enabled: false, period: 20, lineWidth: 2 },
  bbands: { enabled: false, period: 20, stdDev: 2, lineWidth: 1 },
  strategy: draft,
  indicator: draft,
};

describe('ResearchShelf', () => {
  it('offers recovery without restoring or overwriting drafts automatically', () => {
    const s = storage();
    const first = new ResearchShelf(s);
    first.setAccount(null);
    first.saveDraft('strategy', draft);
    const next = new ResearchShelf(s);
    next.setAccount(null);
    expect(next.pending.strategy).toEqual(draft);
    next.saveDraft('strategy', { ...draft, code: 'new code' });
    expect(next.drafts.strategy).toEqual(draft);
    next.resolve('strategy');
    next.saveDraft('strategy', { ...draft, code: 'new code' });
    expect(next.drafts.strategy?.code).toBe('new code');
  });
  it('removes recovery after keeping a clean editor', () => {
    const s = storage();
    const shelf = new ResearchShelf(s);
    shelf.setAccount(null);
    shelf.saveDraft('indicator', draft);
    const next = new ResearchShelf(s);
    next.setAccount(null);
    next.resolve('indicator');
    next.saveDraft('indicator', null);
    const final = new ResearchShelf(s);
    final.setAccount(null);
    expect(final.pending.indicator).toBeUndefined();
  });
  it('isolates accounts and guests', () => {
    const shelf = new ResearchShelf(storage());
    shelf.setAccount('a');
    shelf.saveDraft('strategy', draft);
    shelf.saveWorkspace('A', layout);
    shelf.setAccount('b');
    expect(shelf.pending).toEqual({});
    expect(shelf.workspaces).toEqual([]);
    shelf.setAccount(null);
    expect(shelf.drafts).toEqual({});
    shelf.setAccount('a');
    expect(shelf.pending.strategy).toEqual(draft);
    expect(shelf.workspaces[0].name).toBe('A');
  });
  it('saves detached layouts, limits presets, and allows removing them', () => {
    const shelf = new ResearchShelf(storage());
    shelf.setAccount(null);
    const current = structuredClone(layout);
    shelf.saveWorkspace('Original', current);
    current.sma.period = 50;
    expect(shelf.workspaces[0].layout.sma.period).toBe(20);
    for (let i = 1; i < 10; i++)
      expect(shelf.saveWorkspace(String(i), layout)).toBe(true);
    expect(shelf.saveWorkspace('overflow', layout)).toBe(false);
    shelf.removeWorkspace(shelf.workspaces[0].id);
    expect(shelf.workspaces).toHaveLength(9);
  });
  it('rejects unsupported contexts and malformed code snapshots', () => {
    expect(validLayout(layout)).toBe(true);
    expect(validLayout({ ...layout, provider: 'bogus' })).toBe(false);
    expect(validLayout({ ...layout, strategyTab: 'unknown' })).toBe(false);
    expect(validLayout({ ...layout, indicatorSplitPct: 90 })).toBe(false);
    expect(validLayout({ ...layout, sma: { ...layout.sma, period: -1 } })).toBe(
      false,
    );
    expect(validLayout({ ...layout, strategy: { ...draft, code: null } })).toBe(
      false,
    );
    const s = storage();
    s.setItem(
      'openquant.research.v1:guest',
      JSON.stringify({
        version: 1,
        drafts: { strategy: 10 },
        workspaces: [{}],
      }),
    );
    const shelf = new ResearchShelf(s);
    shelf.setAccount(null);
    expect(shelf.workspaces).toEqual([]);
    expect(shelf.pending).toEqual({});
  });
  it('reports denied writes instead of claiming recovery is saved', () => {
    const shelf = new ResearchShelf({
      getItem: () => null,
      setItem: () => {
        throw new Error('Quota');
      },
    } as unknown as Storage);
    shelf.setAccount(null);
    shelf.saveDraft('strategy', draft);
    expect(shelf.error).toContain('memory only');
  });
  it('does not replace unreadable storage when new drafts are edited', () => {
    const s = storage();
    s.setItem('openquant.research.v1:guest', '{broken');
    const shelf = new ResearchShelf(s);
    shelf.setAccount(null);
    shelf.saveDraft('strategy', draft);
    expect(s.getItem('openquant.research.v1:guest')).toBe('{broken');
    expect(shelf.error).toContain('paused');
  });
});

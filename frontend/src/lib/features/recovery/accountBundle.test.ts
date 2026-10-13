import { describe, expect, it, vi } from 'vitest';
import {
  exportAccountBundle,
  prepareAccountRestore,
  MAX_BUNDLE_BYTES,
  type RecoveryIdentity,
} from './accountBundle';
import {
  ResearchShelf,
  type ResearchLayout,
} from '../workspace/researchShelf.svelte';
import { RunsHistory } from '../runs/runsHistory.svelte';
import { latestReviewKey, loadLatestReview } from '../trial/recovery';
import { drawablesStorageKey } from '../drawables/persistence';

const account = 'account/A';
const owner = () => ({ account, generation: 1 });
const confirmed = { confirmed: true, writersPaused: true };
const draft = {
  name: 'Synthetic',
  code: 'def on_bar(ctx): pass',
  updatedAt: '2026-10-13T00:00:00Z',
};
const layout: ResearchLayout = {
  symbol: 'TEST',
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
  sma: { enabled: false, period: 20, lineWidth: 1 },
  ema: { enabled: false, period: 20, lineWidth: 1 },
  bbands: { enabled: false, period: 20, stdDev: 2, lineWidth: 1 },
  strategy: draft,
  indicator: draft,
};
const shelfKey = `openquant.research.v1:account:${encodeURIComponent(account)}`;
const notebookKey = `openquant.runs.history:account:${encodeURIComponent(account)}`;
const elementsKey = drawablesStorageKey(account);

class MemoryStorage {
  values = new Map<string, string>();
  getItem = vi.fn((key: string) => this.values.get(key) ?? null);
  setItem = vi.fn((key: string, value: string) => {
    this.values.set(key, value);
  });
  removeItem = vi.fn((key: string) => {
    this.values.delete(key);
  });
}

function source() {
  const storage = new MemoryStorage();
  const shelf = new ResearchShelf(storage as unknown as Storage);
  shelf.setAccount(account);
  shelf.saveDraft('strategy', draft);
  shelf.saveDraft('indicator', draft);
  shelf.saveWorkspace('Synthetic layout', layout);
  storage.values.set(
    notebookKey,
    JSON.stringify([
      {
        run_id: 'a'.repeat(64),
        kind: 'single',
        label: 'Synthetic notebook',
        created_at: draft.updatedAt,
        tags: ['synthetic'],
        notes: 'Keep original identity',
        baseline: true,
        decision: 'revise',
      },
    ]),
  );
  storage.values.set(
    elementsKey,
    JSON.stringify([
      {
        id: 'ruler',
        type: 'ruler',
        schemaVersion: 1,
        symbol: 'TEST',
        createdAt: 1,
        geometry: { startTime: 1, endTime: 2, startPrice: 3, endPrice: 4 },
        params: {},
        style: { upColor: '#123456', downColor: '#654321', showStats: true },
      },
    ]),
  );
  storage.getItem.mockClear();
  return storage;
}

describe('separate bounded account-local recovery', () => {
  it('round-trips robustness receipt/context/review without interpreting it as provider proof', () => {
    const summary = {
      total_return: -0.1,
      max_drawdown: -0.2,
      trade_count: 1,
      total_cost: 7,
      equity: [{ t: 1, value: 10000 }],
    };
    const report = {
      schema_version: 1,
      source: 'workspace',
      report_id: 'a'.repeat(64),
      code_hash: 'b'.repeat(64),
      engine_version: 'fixture',
      strategy: {
        id: 'workspace',
        name: 'Synthetic fixture',
        description: 'Parser fixture only',
        lesson: 'No provider proof',
      },
      // Native workspace parser requires false; these fabricated unit-test bars are still synthetic evidence.
      dataset: {
        id: 'fixture',
        version: 'c'.repeat(64),
        label: 'Synthetic parser fixture',
        synthetic: false,
        start: '2025-01-01',
        end: '2025-04-01',
        split_date: '2025-03-01',
        training_bars: 70,
        holdout_bars: 30,
      },
      config: {
        strategy_id: 'workspace',
        commission_bps: 2,
        slippage_bps: 5,
        starting_cash: 10000,
        seed: 0,
        holdout_fraction: 0.3,
        params: {},
        sensitivity_parameter: null,
      },
      baseline: summary,
      realistic: summary,
      benchmark: summary,
      holdout: { strategy: summary, benchmark: summary },
      sensitivity: [],
      selected_parameter: null,
      findings: [],
      assumptions: ['Fixture'],
      limitations: ['No provider coverage'],
      cost_stress: {
        status: 'measured',
        limitation: 'Fixture',
        points: [1, 2, 3].map(multiplier => ({
          multiplier,
          commission_bps: 2 * multiplier,
          slippage_bps: 5 * multiplier,
          summary,
        })),
      },
      research_review: { decision: 'revise', reason: 'Synthetic test only' },
    };
    const saved = {
      version: 1,
      account,
      received_at: draft.updatedAt,
      input_fingerprint: 'd'.repeat(64),
      context: {
        name: 'Fixture',
        symbol: 'TEST',
        provider: 'yfinance',
        period: '1y',
        interval: '1d',
      },
      report,
    };
    const original = source();
    original.values.set(latestReviewKey(account), JSON.stringify(saved));
    const exported = exportAccountBundle(original, owner);
    expect(exported.preview.every(item => item.status === 'ready')).toBe(true);
    const target = new MemoryStorage();
    prepareAccountRestore(exported.text, target, owner).commit(confirmed);
    expect(loadLatestReview(target, account).saved).toEqual(saved);
    expect(loadLatestReview(target, 'B').saved).toBeNull();
  });
  it('reads exactly four account keys and excludes tokens, other accounts, guests and legacy', () => {
    const storage = source();
    for (const key of [
      'auth.token',
      'provider.key',
      'openquant.research.v1:guest',
      'openquant.runs.history',
      'openQuant.drawables.v1',
      drawablesStorageKey('B'),
    ])
      storage.values.set(key, 'DO-NOT-EXPORT');
    const result = exportAccountBundle(storage, owner);
    expect(storage.getItem.mock.calls.map(call => call[0])).toEqual([
      shelfKey,
      notebookKey,
      latestReviewKey(account),
      elementsKey,
    ]);
    expect(result.text).not.toContain('DO-NOT-EXPORT');
    expect(result.preview.map(item => item.status)).toEqual([
      'ready',
      'ready',
      'missing',
      'ready',
    ]);
    expect(JSON.stringify(result.preview)).not.toContain(draft.code);
  });

  it('previews without writes, explicitly restores exact bytes and existing loaders recover them', () => {
    const original = source();
    const { text } = exportAccountBundle(original, owner);
    const target = new MemoryStorage();
    target.values.set('auth.token', 'untouched');
    target.values.set(drawablesStorageKey('B'), 'untouched');
    const restore = prepareAccountRestore(text, target, owner);
    expect(target.setItem).not.toHaveBeenCalled();
    expect(() =>
      restore.commit({ confirmed: false, writersPaused: true }),
    ).toThrow();
    expect(() =>
      restore.commit({ confirmed: true, writersPaused: false }),
    ).toThrow();
    restore.commit(confirmed);
    for (const [key, value] of original.values)
      expect(target.values.get(key)).toBe(value);
    expect(target.values.get('auth.token')).toBe('untouched');
    const shelf = new ResearchShelf(target as unknown as Storage);
    shelf.setAccount(account);
    expect(shelf.pending.strategy?.code).toBe(draft.code);
    expect(shelf.workspaces[0].layout).toEqual(layout);
    const notebook = new RunsHistory(target as unknown as Storage);
    notebook.setAccount(account);
    expect(notebook.entries[0].notes).toBe('Keep original identity');
    expect(() => restore.commit(confirmed)).toThrow();
  });

  it('preserves unreadable source originals in private export but refuses write-stage restore', () => {
    const original = source();
    original.values.set(elementsKey, 'unreadable-original');
    const { text, preview } = exportAccountBundle(original, owner);
    expect(text).toContain('unreadable-original');
    expect(preview.find(item => item.kind === 'elements')?.status).toBe(
      'unreadable',
    );
    const target = new MemoryStorage();
    expect(() =>
      prepareAccountRestore(text, target, owner).commit(confirmed),
    ).toThrow();
    expect(target.values.size).toBe(0);
    expect(original.values.get(elementsKey)).toBe('unreadable-original');
  });

  it.each(['future', 'duplicate'])(
    'preserves %s Elements without silently normalizing them',
    kind => {
      const original = source();
      const entries = JSON.parse(original.values.get(elementsKey)!);
      if (kind === 'future') entries[0].schemaVersion = 99;
      else entries.push(entries[0]);
      const raw = JSON.stringify(entries);
      original.values.set(elementsKey, raw);
      const { text, preview } = exportAccountBundle(original, owner);
      expect(JSON.parse(text).records.elements).toBe(raw);
      expect(preview.find(item => item.kind === 'elements')?.status).toBe(
        'unreadable',
      );
      expect(() =>
        prepareAccountRestore(text, new MemoryStorage(), owner).commit(
          confirmed,
        ),
      ).toThrow();
    },
  );

  it.each(['valid', 'unreadable'])(
    'never replaces %s populated targets',
    kind => {
      const text = exportAccountBundle(source(), owner).text;
      const target = new MemoryStorage();
      target.values.set(shelfKey, kind === 'valid' ? '{}' : 'broken');
      expect(() => prepareAccountRestore(text, target, owner)).toThrow();
      expect(target.values.get(shelfKey)).toBe(
        kind === 'valid' ? '{}' : 'broken',
      );
      expect(target.setItem).not.toHaveBeenCalled();
    },
  );

  it('fences guest, another account and A-B-A generations', () => {
    const text = exportAccountBundle(source(), owner).text;
    expect(() => exportAccountBundle(source(), () => null)).toThrow();
    expect(() =>
      prepareAccountRestore(text, new MemoryStorage(), () => ({
        account: 'B',
        generation: 1,
      })),
    ).toThrow();
    let current: RecoveryIdentity | null = owner();
    const target = new MemoryStorage();
    const restore = prepareAccountRestore(text, target, () => current);
    current = { account, generation: 3 };
    expect(() => restore.commit(confirmed)).toThrow();
    expect(target.setItem).not.toHaveBeenCalled();
  });

  it('fences an account switch while exporting', () => {
    let current = owner();
    const storage = source();
    storage.getItem.mockImplementation(key => {
      current = { account: 'B', generation: 2 };
      return storage.values.get(key) ?? null;
    });
    expect(() => exportAccountBundle(storage, () => current)).toThrow();
  });

  it('rejects intervening target edits without replacing them', () => {
    const target = new MemoryStorage();
    const restore = prepareAccountRestore(
      exportAccountBundle(source(), owner).text,
      target,
      owner,
    );
    target.values.set(elementsKey, 'intervening');
    expect(() => restore.commit(confirmed)).toThrow();
    expect(target.values.get(elementsKey)).toBe('intervening');
    expect(target.setItem).not.toHaveBeenCalled();
  });

  it('rolls back only its own exact bytes after a quota failure', () => {
    const target = new MemoryStorage();
    target.setItem.mockImplementation((key, raw) => {
      if (key === notebookKey) throw new Error('sensitive-quota-message');
      target.values.set(key, raw);
    });
    const restore = prepareAccountRestore(
      exportAccountBundle(source(), owner).text,
      target,
      owner,
    );
    expect(() => restore.commit(confirmed)).toThrow(
      'partial records may remain',
    );
    expect(target.values.size).toBe(0);
  });

  it('reports failed rollback as failure, never success', () => {
    const target = new MemoryStorage();
    target.setItem.mockImplementation((key, raw) => {
      if (key === notebookKey) throw new Error('quota');
      target.values.set(key, raw);
    });
    target.removeItem.mockImplementation(() => {
      throw new Error('blocked');
    });
    const restore = prepareAccountRestore(
      exportAccountBundle(source(), owner).text,
      target,
      owner,
    );
    expect(() => restore.commit(confirmed)).toThrow(
      'partial records may remain',
    );
    expect(target.values.has(shelfKey)).toBe(true);
  });

  it('rejects malformed versions, keys and oversized UTF-8 records with fixed diagnostics', () => {
    const text = exportAccountBundle(source(), owner).text;
    for (const changed of [
      { ...JSON.parse(text), version: 2 },
      { ...JSON.parse(text), token: 'never import' },
      {
        ...JSON.parse(text),
        records: { ...JSON.parse(text).records, auth: 'never import' },
      },
      { ...JSON.parse(text), records: {} },
    ])
      expect(() =>
        prepareAccountRestore(
          JSON.stringify(changed),
          new MemoryStorage(),
          owner,
        ),
      ).toThrow();
    expect(() =>
      prepareAccountRestore(
        ' '.repeat(MAX_BUNDLE_BYTES + 1),
        new MemoryStorage(),
        owner,
      ),
    ).toThrow();
    const storage = source();
    storage.values.set(latestReviewKey(account), '€'.repeat(1_000_001));
    expect(() => exportAccountBundle(storage, owner)).toThrow();
    storage.getItem.mockImplementation(() => {
      throw new Error('private-storage-error');
    });
    expect(() => exportAccountBundle(storage, owner)).toThrow(
      'existing records were not replaced',
    );
  });

  it('refuses source records that existing recovery parsers cannot restore losslessly', () => {
    const storage = source();
    storage.values.set(elementsKey, JSON.stringify([{ type: 'unknown-tool' }]));
    storage.values.set(notebookKey, JSON.stringify([{ run_id: 'bad' }]));
    storage.values.set(
      latestReviewKey(account),
      JSON.stringify({ account: 'B' }),
    );
    expect(
      exportAccountBundle(storage, owner).preview.map(item => item.status),
    ).toEqual(['ready', 'unreadable', 'unreadable', 'unreadable']);
  });
});

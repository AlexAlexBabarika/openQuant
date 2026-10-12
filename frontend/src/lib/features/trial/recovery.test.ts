import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import ResearchReview from './ResearchReview.svelte';
import { generateTrialReportHtml } from '../trial-report/export';
import {
  createReviewFence,
  emptyReview,
  latestReviewKey,
  loadLatestReview,
  MAX_SAVED_REPORT,
  restoredReviewIsStale,
  reviewInputFingerprint,
  saveLatestReview,
  selectSavedReview,
  validWorkspaceReport,
  type ReviewStorage,
  type SavedReview,
} from './recovery';
import type {
  WorkspaceContext,
  WorkspaceReport,
  WorkspaceSettings,
} from './workspace';
import type { TrialReport } from '../trial-report/types';

const context: WorkspaceContext = {
  code: 'def on_bar(ctx):\n    pass',
  name: 'Draft',
  symbol: 'TEST',
  provider: 'yfinance',
  period: '1y',
  interval: '1d',
};
const settings: WorkspaceSettings = {
  commission_bps: 2,
  slippage_bps: 5,
  starting_cash: 10000,
  holdout_fraction: 0.3,
  params: {},
  sensitivity_parameter: null,
};

function report(): WorkspaceReport {
  const summary = {
    total_return: -0.1,
    max_drawdown: -0.2,
    trade_count: 1,
    total_cost: 7,
    equity: [{ t: 1735689600, value: 10000 }],
  };
  return {
    schema_version: 1,
    source: 'workspace',
    report_id: 'a'.repeat(64),
    code_hash: 'b'.repeat(64),
    engine_version: 'engine-1',
    suite_version: '2',
    strategy: {
      id: 'workspace',
      name: 'Draft',
      description: 'Current strategy',
      lesson: 'Research only',
    },
    dataset: {
      id: 'yfinance:TEST',
      version: 'c'.repeat(64),
      label: 'TEST · yfinance · 1y / 1d',
      synthetic: false,
      start: '2025-01-01',
      end: '2025-04-01',
      split_date: '2025-03-01',
      training_bars: 70,
      holdout_bars: 30,
    },
    config: { ...settings, strategy_id: 'workspace', seed: 0 },
    baseline: { ...summary, total_cost: 0 },
    realistic: summary,
    benchmark: summary,
    holdout: { strategy: summary, benchmark: summary },
    sensitivity: [],
    selected_parameter: null,
    findings: [
      {
        id: 'loss',
        severity: 'warning',
        title: 'Measured loss',
        detail: 'Full-period return -10%; drawdown -20%.',
      },
    ],
    assumptions: ['Same bars/source/seed/parameters'],
    limitations: ['Not unseen dates'],
    cost_stress: {
      status: 'measured',
      limitation: 'Costs can change decisions; not monotonic.',
      points: [1, 2, 3].map(multiplier => ({
        multiplier: multiplier as 1 | 2 | 3,
        commission_bps: 2 * multiplier,
        slippage_bps: 5 * multiplier,
        summary: { ...summary, total_cost: multiplier * 7 },
      })),
    },
    research_review: {
      decision: 'revise',
      reason: 'Investigate costs before more research.',
    },
  };
}

function saved(account = 'A'): SavedReview {
  const { code: _code, ...safeContext } = context;
  return {
    version: 1,
    account,
    received_at: '2026-10-12T18:00:00.000Z',
    input_fingerprint: 'd'.repeat(64),
    context: safeContext,
    report: report(),
  };
}

class MemoryStorage implements ReviewStorage {
  values = new Map<string, string>();
  getItem = vi.fn((key: string) => this.values.get(key) ?? null);
  setItem = vi.fn((key: string, value: string) => {
    this.values.set(key, value);
  });
}

describe('bounded account-private latest report and explicit recovery', () => {
  it('loads only a candidate and restores original receipt/review without changing current draft or rerunning', async () => {
    const storage = new MemoryStorage(),
      original = saved();
    original.input_fingerprint = await reviewInputFingerprint(
      context,
      settings,
    );
    expect(saveLatestReview(storage, original, () => 'A')).toBe('saved');
    const candidate = loadLatestReview(storage, 'A');
    expect(candidate.status).toBe('ready');
    const currentDraft = {
      ...context,
      code: 'new private source',
      symbol: 'OTHER',
    };
    const before = structuredClone(currentDraft);
    const restored = selectSavedReview(candidate.saved, 'A')!;
    expect(restored).toEqual(original);
    expect(restored).not.toBe(original);
    expect(restored.received_at).toBe(original.received_at);
    expect(restored.report.research_review?.decision).toBe('revise');
    expect(currentDraft).toEqual(before);
    expect(restoredReviewIsStale(restored, original.input_fingerprint)).toBe(
      false,
    );
    expect(
      restoredReviewIsStale(
        restored,
        await reviewInputFingerprint(currentDraft, settings),
      ),
    ).toBe(true);
    expect(restoredReviewIsStale(restored, null)).toBe(true);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(storage.values.get(latestReviewKey('A'))).not.toContain(
      context.code,
    );
  });

  it('hashes source/context/configuration changes without persisting source in the receipt', async () => {
    const original = await reviewInputFingerprint(context, settings);
    expect(original).toMatch(/^[a-f0-9]{64}$/);
    for (const change of [
      { code: context.code + '\n' },
      { symbol: 'OTHER' },
      { provider: 'binance' as const },
      { period: '5y' },
      { interval: '1h' },
      { name: 'Another draft' },
    ]) {
      expect(
        await reviewInputFingerprint({ ...context, ...change }, settings),
      ).not.toBe(original);
    }
    for (const change of [
      { commission_bps: 4 },
      { slippage_bps: 8 },
      { starting_cash: 5000 },
      { holdout_fraction: 0.4 },
      { params: { fast: 10 } },
      { sensitivity_parameter: 'fast' },
    ]) {
      expect(
        await reviewInputFingerprint(context, { ...settings, ...change }),
      ).not.toBe(original);
    }
  });

  it('separates two accounts and guests/examples, never adopts guest data, and gates selection on current account', () => {
    const storage = new MemoryStorage();
    storage.values.set(
      'openquant:robustness-review:v1:guest',
      JSON.stringify(saved()),
    );
    expect(loadLatestReview(storage, null)).toEqual({
      status: 'ready',
      saved: null,
    });
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(loadLatestReview(storage, 'B').saved).toBeNull();
    expect(saveLatestReview(storage, saved(), () => 'A')).toBe('saved');
    const b = saved('B');
    b.report.strategy.name = 'B private';
    expect(saveLatestReview(storage, b, () => 'B')).toBe('saved');
    expect(loadLatestReview(storage, 'A').saved?.report.strategy.name).toBe(
      'Draft',
    );
    expect(loadLatestReview(storage, 'B').saved?.report.strategy.name).toBe(
      'B private',
    );
    expect(selectSavedReview(saved(), 'B')).toBeNull();
    expect(selectSavedReview(saved(), null)).toBeNull();
    expect(saveLatestReview(storage, saved(), () => 'B')).toBe('obsolete');
    expect(saveLatestReview(storage, saved(), () => null)).toBe('obsolete');
    const synthetic = {
      ...saved(),
      report: {
        ...report(),
        source: undefined,
        dataset: { ...report().dataset, synthetic: true },
      },
    };
    expect(
      saveLatestReview(storage, synthetic as unknown as SavedReview, () => 'A'),
    ).toBe('unreadable');
    expect(loadLatestReview(storage, 'A').saved?.report.dataset.synthetic).toBe(
      false,
    );
  });

  it.each([
    '{malformed',
    'null',
    JSON.stringify({ version: 999 }),
    JSON.stringify({ ...saved(), account: 'B' }),
    JSON.stringify({ ...saved(), context: { ...context } }),
    ' '.repeat(MAX_SAVED_REPORT + 1),
  ])('preserves unreadable storage rather than overwriting it (%#)', raw => {
    const storage = new MemoryStorage(),
      key = latestReviewKey('A');
    storage.values.set(key, raw);
    expect(loadLatestReview(storage, 'A').status).toBe('unreadable');
    expect(saveLatestReview(storage, saved(), () => 'A')).toBe('unreadable');
    expect(storage.values.get(key)).toBe(raw);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('preserves previous evidence for quota/blocked storage and oversized new reports', () => {
    const storage = new MemoryStorage(),
      old = saved(),
      key = latestReviewKey('A');
    expect(saveLatestReview(storage, old, () => 'A')).toBe('saved');
    const original = storage.values.get(key);
    storage.setItem.mockImplementation(() => {
      throw new DOMException('Quota', 'QuotaExceededError');
    });
    const next = saved();
    next.report.research_review = {
      decision: 'reject',
      reason: 'Measured loss',
    };
    expect(saveLatestReview(storage, next, () => 'A')).toBe('unavailable');
    expect(storage.values.get(key)).toBe(original);
    next.report.findings[0].detail = 'x'.repeat(MAX_SAVED_REPORT);
    expect(saveLatestReview(storage, next, () => 'A')).toBe('too-large');
    expect(storage.values.get(key)).toBe(original);
    storage.getItem.mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadLatestReview(storage, 'A').status).toBe('unavailable');
    expect(saveLatestReview(storage, old, () => 'A')).toBe('unavailable');
  });

  it('fences a pending write even when the account changes during reading storage', () => {
    let account: string | null = 'A';
    const storage = new MemoryStorage();
    storage.getItem.mockImplementation(() => {
      account = 'B';
      return null;
    });
    expect(saveLatestReview(storage, saved(), () => account)).toBe('obsolete');
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('accepts older reports without stress or review but rejects malformed numeric/unknown/source-bearing data', () => {
    const old = report();
    delete old.cost_stress;
    delete old.suite_version;
    delete old.research_review;
    expect(validWorkspaceReport(old)).toBe(true);
    const storage = new MemoryStorage(),
      receipt = { ...saved(), report: old };
    expect(saveLatestReview(storage, receipt, () => 'A')).toBe('saved');
    expect(
      loadLatestReview(storage, 'A').saved?.report.research_review,
    ).toBeUndefined();
    for (const corrupt of [
      { ...old, schema_version: 2 },
      { ...old, code: context.code },
      { ...old, realistic: { ...old.realistic, total_return: NaN } },
      { ...old, holdout: null },
      { ...old, dataset: { ...old.dataset, synthetic: true } },
      { ...old, config: { ...old.config, starting_cash: 0 } },
      { ...old, research_review: { decision: 'buy', reason: 'unsafe' } },
      {
        ...old,
        research_review: { decision: 'revise', reason: 'x'.repeat(2001) },
      },
    ])
      expect(validWorkspaceReport(corrupt)).toBe(false);
  });
});

describe('controlled obsolete workspace completions', () => {
  it('discards obsolete successes and errors across replacement, account switch, guest logout and unmount invalidation', async () => {
    let account: string | null = 'A';
    const storage = new MemoryStorage(),
      fence = createReviewFence(() => account);
    const publish = vi.fn();
    const finish = async (
      pending: Promise<SavedReview>,
      token: ReturnType<typeof fence.capture>,
    ) => {
      try {
        const result = await pending;
        if (!token.current()) return;
        publish(result);
        saveLatestReview(storage, result, () => account);
      } catch (error) {
        if (token.current()) publish(error);
      }
    };
    let complete!: (value: SavedReview) => void;
    const first = finish(
      new Promise(resolve => {
        complete = resolve;
      }),
      fence.capture(),
    );
    const second = fence.capture();
    complete(saved());
    await first;
    expect(publish).not.toHaveBeenCalled();
    expect(second.current()).toBe(true);
    for (const next of ['B', null, 'A'] as const) {
      let reject!: (error: Error) => void;
      const pending = finish(
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
        fence.capture(),
      );
      account = next;
      fence.invalidate();
      reject(new Error('late failure'));
      await pending;
    }
    let lastComplete!: (value: SavedReview) => void;
    const last = finish(
      new Promise(resolve => {
        lastComplete = resolve;
      }),
      fence.capture(),
    );
    fence.invalidate();
    lastComplete(saved());
    await last;
    expect(publish).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});

describe('staged research evidence and export', () => {
  it('shows actual stresses/units and escapes the conclusion without a confidence score or source/public workspace link', () => {
    const measured = report();
    measured.research_review = {
      decision: 'reject',
      reason: '<script>unsafe()</script> failed costs',
    };
    const html = generateTrialReportHtml(measured);
    for (const phrase of [
      'Bounded full-period cost stress',
      '2× · 4 bps commission / 10 bps slippage',
      '3× · 6 bps commission / 15 bps slippage',
      'Research conclusion · not a confidence score',
      'reject',
      '&lt;script&gt;unsafe()&lt;/script&gt;',
      'not independent out-of-sample evidence',
    ])
      expect(html).toContain(phrase);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain(context.code);
    expect(html).not.toContain('?trial=');
    const ui = render(ResearchReview, {
      props: {
        report: measured,
        review: measured.research_review,
        onreview: () => {},
      },
    }).body;
    expect(ui).toContain('Staged research review');
    expect(ui).toContain('currency units');
    expect(ui).toContain('Completed round trips');
    expect(ui).toContain('Continue research · not approval to trade');
    expect(ui).toContain('3× · 6 bps commission / 15 bps slippage');
  });

  it('labels older/example stress as unavailable and zero multiplied costs as no evidence', () => {
    const old = report();
    delete old.cost_stress;
    const {
      source: _source,
      code_hash: _hash,
      engine_version: _engine,
      ...exampleFields
    } = old;
    const example: TrialReport = {
      ...exampleFields,
      strategy: { ...old.strategy, id: 'boring-benchmark' },
      config: {
        strategy_id: 'boring-benchmark',
        commission_bps: 1,
        slippage_bps: 5,
      },
      dataset: { ...old.dataset, synthetic: true },
      selected_parameter: null,
      sensitivity: [],
    };
    for (const evidence of [old, example]) {
      const ui = render(ResearchReview, {
        props: { report: evidence, review: emptyReview(), onreview: () => {} },
      }).body;
      expect(ui).toContain('Cost-stress evidence unavailable');
      expect(generateTrialReportHtml(evidence)).toContain(
        'Missing checks provide no resilience evidence',
      );
    }
    const zero = report();
    zero.config.commission_bps = 0;
    zero.config.slippage_bps = 0;
    zero.realistic = { ...zero.realistic, total_cost: 0 };
    zero.cost_stress = {
      status: 'zero-cost',
      limitation: 'Multiplying zero provides no cost resilience evidence.',
      points: [1, 2, 3].map(multiplier => ({
        multiplier: multiplier as 1 | 2 | 3,
        commission_bps: 0,
        slippage_bps: 0,
        summary: zero.realistic,
      })),
    };
    expect(validWorkspaceReport(zero)).toBe(true);
    expect(generateTrialReportHtml(zero)).toContain(
      'Multiplying zero provides no cost resilience evidence',
    );
    zero.cost_stress.points[2].summary = {
      ...zero.realistic,
      total_return: 0.75,
    };
    expect(validWorkspaceReport(zero)).toBe(false);
    zero.cost_stress.points[2].summary = zero.realistic;
    zero.cost_stress.points[2].commission_bps = 1;
    expect(validWorkspaceReport(zero)).toBe(false);
  });
});

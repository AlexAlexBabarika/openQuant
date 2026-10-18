import { describe, expect, it, vi } from 'vitest';
import { clearAccessToken, setAccessToken } from '$lib/core/api';
import { createOptionsDraft } from './optionsTemplates';
import type { LifecycleResponse } from './optionsResearchTypes';
import {
  MAX_PATH_POINTS,
  MAX_PATH_TEXT,
  ResearchJob,
  applyCalendar,
  boundedNumber,
  calendarControls,
  calendarProposal,
  inputKey,
  lastExpiry,
  lifecycleRequest,
  observationIndex,
  parsePathCsv,
  pathChart,
  pathControls,
  pathRequest,
  researchError,
  researchValue,
  setLegExpiry,
  validLifecycle,
} from './optionsLifecycle';

describe('integrated research input and timeout fences', () => {
  it('rejects publication after the account session changes', async () => {
    let finish!: (value: number) => void;
    const pending = new Promise<number>(resolve => {
      finish = resolve;
    });
    const job = new ResearchJob<null, number>(
      'guest:a',
      () => 'guest:a',
      vi.fn(),
    );
    const done = job.submit(null, 'query', () => pending, Number.isFinite);
    try {
      setAccessToken('test-only');
      finish(123);
      await done;
    } finally {
      clearAccessToken();
    }
    expect(job.state.result).toBeNull();
  });
  it('rejects publication after input divergence even before the cancellation effect runs', async () => {
    let key = 'submitted';
    let finish!: (value: number) => void;
    const pending = new Promise<number>(resolve => {
      finish = resolve;
    });
    const job = new ResearchJob<null, number>(
      'guest:a',
      () => 'guest:a',
      vi.fn(),
      () => key,
    );
    const done = job.submit(null, key, () => pending, Number.isFinite);
    key = 'different query';
    finish(123);
    await done;
    expect(job.state.result).toBeNull();
    job.cancel();
    expect(job.state.pending).toBe(false);
  });

  it('bounds lifecycle/hedge client waiting and ignores a late success after timeout', async () => {
    vi.useFakeTimers();
    try {
      let finish!: (value: number) => void;
      let signal!: AbortSignal;
      const pending = new Promise<number>(resolve => {
        finish = resolve;
      });
      const job = new ResearchJob<null, number>(
        'guest:a',
        () => 'guest:a',
        vi.fn(),
      );
      const done = job.submit(
        null,
        'query',
        (_, s) => {
          signal = s;
          return pending;
        },
        Number.isFinite,
      );
      await vi.advanceTimersByTimeAsync(15000);
      expect(signal.aborted).toBe(true);
      expect(job.state.pending).toBe(false);
      expect(job.state.error).toContain('15 seconds');
      finish(123);
      await done;
      expect(job.state.result).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

function lifecycle(): LifecycleResponse {
  const draft = createOptionsDraft();
  return {
    request: {
      analysis: draft,
      path: { source: 'supplied', points: [{ day: 0, spot: draft.spot }] },
    },
    provenance: {
      version: '1',
      model: 'black_scholes_merton',
      currency: 'USD',
      day_basis: 'ACT/365',
      exercise_style: 'european',
      settlement: 'cash',
      input_source: 'manual_or_synthetic',
    },
    path: [{ day: 0, spot: draft.spot }],
    settlements: [],
    ledger: [
      {
        day: 0,
        spot: draft.spot,
        settlement_cash_flow: 0,
        cumulative_settlement_cash: 0,
        remaining_value: -10,
        total_pnl: -5,
        legs: [
          {
            leg_index: 0,
            state: 'model_mark',
            remaining_days: 30,
            value: -10,
            greeks: {
              delta: null,
              gamma: null,
              theta: null,
              vega: null,
              rho: null,
            },
          },
        ],
      },
    ],
    net_entry_cost: -5,
    final_pnl: -5,
    warnings: [],
  };
}

describe('explicit bounded path inputs', () => {
  it.each(['', ' ', 'Infinity', 'NaN', '1e999', '-1', '11'])(
    'rejects blank/nonfinite/out-of-bounds number %j',
    value => {
      expect(boundedNumber(value, 0, 10)).toBeNull();
    },
  );
  it('preserves zero, finite decimals and integer constraints', () => {
    expect(boundedNumber('0', 0, 10)).toBe(0);
    expect(boundedNumber('1.5', 0, 10)).toBe(1.5);
    expect(boundedNumber('1.5', 0, 10, true)).toBeNull();
    expect(researchValue(null)).toBe('Unavailable');
    expect(researchValue(NaN)).toBe('Unavailable');
    expect(researchValue(0)).toBe('0');
    expect(researchValue(-2)).toBe('-2');
  });
  it('parses explicit zero, decimal days, CRLF, whitespace and optional headers', () => {
    expect(
      parsePathCsv(' day, spot\r\n 0,100\r\n 0.5,0\r\n 3650,1000000 ').points,
    ).toEqual([
      { day: 0, spot: 100 },
      { day: 0.5, spot: 0 },
      { day: 3650, spot: 1000000 },
    ]);
    expect(parsePathCsv('0,100').error).toBeUndefined();
  });
  it.each([
    '',
    'day,spot',
    '0,',
    ',100',
    '0,100,2',
    '0,-1',
    '0,1000001',
    '0,NaN',
    '0,Infinity',
    '1,100',
    '0,100\n0,101',
    '0,100\n2,101\n1,102',
    '0,100\n\n1,102',
    '0,100\n3651,100',
  ])('rejects invalid CSV without silently fixing %j', text => {
    expect(parsePathCsv(text).error).toBeTruthy();
    expect(parsePathCsv(text).points).toEqual([]);
  });
  it('bounds CSV length and observations', () => {
    const text = Array.from(
      { length: MAX_PATH_POINTS },
      (_, day) => `${day},100`,
    ).join('\n');
    expect(parsePathCsv(text).points).toHaveLength(MAX_PATH_POINTS);
    expect(parsePathCsv(`${text}\n366,100`).error).toBeTruthy();
    expect(parsePathCsv('0'.repeat(MAX_PATH_TEXT + 1)).error).toContain(
      'characters',
    );
  });
  it('requires matching day-zero spot and coverage through the far active expiry', () => {
    const draft = createOptionsDraft();
    draft.strategy.legs[0].days_to_expiry = 60;
    const settings = { ...pathControls(draft), source: 'supplied' as const };
    settings.csv = `0,${draft.spot + 1}\n60,100`;
    expect(pathRequest(draft, settings).errors.csv).toContain('exactly');
    settings.csv = `0,${draft.spot}\n59,100`;
    expect(pathRequest(draft, settings).errors.csv).toContain('60');
    settings.csv = `0,${draft.spot}\n60,0`;
    expect(pathRequest(draft, settings).path).toEqual({
      source: 'supplied',
      points: [
        { day: 0, spot: draft.spot },
        { day: 60, spot: 0 },
      ],
    });
    draft.strategy.legs[0].enabled = false;
    expect(lastExpiry(draft)).toBe(0);
  });
  it('resolves date-only leg horizons and ignores stock expiries', () => {
    const draft = createOptionsDraft();
    draft.strategy.valuation_date = '2026-01-01';
    draft.strategy.legs[0].expiry_date = '2026-03-02';
    expect(lastExpiry(draft)).toBe(60);
    draft.strategy.legs[0].kind = 'underlying';
    expect(lastExpiry(draft)).toBe(0);
  });
  it.each([
    ['seed', '-1'],
    ['seed', '4294967296'],
    ['seed', '1.5'],
    ['steps', '0'],
    ['steps', '366'],
    ['steps', '1.5'],
    ['horizon', '0'],
    ['horizon', '3651'],
    ['drift', '-1.1'],
    ['drift', '1.1'],
    ['volatility', '-0.1'],
    ['volatility', '5.1'],
    ['volatility', ''],
  ] as const)('rejects invalid synthetic %s=%s', (field, value) => {
    const draft = createOptionsDraft();
    const settings = { ...pathControls(draft), [field]: value };
    expect(pathRequest(draft, settings).path).toBeNull();
    expect(pathRequest(draft, settings).errors[field]).toBeTruthy();
  });
  it('builds seeded assumptions, never generated observations or prices', () => {
    const draft = createOptionsDraft();
    const settings = {
      ...pathControls(draft),
      seed: '0',
      volatility: '0',
      horizon: '3650',
      steps: '365',
      drift: '-1',
    };
    const result = pathRequest(draft, settings);
    expect(result.errors).toEqual({});
    expect(result.path).toEqual({
      source: 'synthetic',
      generator: 'gbm_seeded_v1',
      seed: 0,
      horizon_days: 3650,
      steps: 365,
      annual_drift: -1,
      annual_volatility: 0,
    });
  });
  it('blocks invalid drafts and snapshots reactive proxies without mutation', () => {
    const draft = createOptionsDraft();
    const result = lifecycleRequest(new Proxy(draft, {}), pathControls(draft));
    expect(result.errors).toEqual({});
    expect(result.request?.analysis).toEqual(draft);
    expect(result.request?.analysis).not.toBe(draft);
    draft.strategy.name = 'edited after prepare';
    expect(result.request?.analysis.strategy.name).not.toBe(
      draft.strategy.name,
    );
    draft.spot = NaN;
    expect(lifecycleRequest(draft, pathControls(draft)).request).toBeNull();
  });
});

describe('controlled per-leg expiry construction', () => {
  it('requires explicit entry premiums, but permits actual zero premiums', () => {
    const draft = createOptionsDraft();
    const controls = calendarControls(draft);
    expect(calendarProposal(controls).errors).toHaveProperty('nearPremium');
    expect(calendarProposal(controls).errors).toHaveProperty('farPremium');
    controls.nearPremium = controls.farPremium = '0';
    controls.contracts = '2';
    const { legs, errors } = calendarProposal(controls);
    expect(errors).toEqual({});
    expect(
      legs?.map(l => [l.quantity, l.days_to_expiry, l.entry_premium, l.strike]),
    ).toEqual([
      [-2, 30, 0, draft.spot],
      [2, 60, 0, draft.spot],
    ]);
  });
  it('requires a later far expiry and different diagonal strikes', () => {
    const controls = {
      ...calendarControls(createOptionsDraft()),
      nearPremium: '3',
      farPremium: '5',
      template: 'diagonal' as const,
      farDays: '30',
    };
    expect(calendarProposal(controls).errors).toHaveProperty('farDays');
    expect(calendarProposal(controls).errors).toHaveProperty('farStrike');
    controls.farDays = '60';
    controls.farStrike = '110';
    expect(calendarProposal(controls).legs?.map(l => l.strike)).toEqual([
      100, 110,
    ]);
  });
  it('replaces legs only, preserves context/fees, and never mutates on invalid input', () => {
    const draft = createOptionsDraft();
    const original = structuredClone(draft);
    const controls = calendarControls(draft);
    expect(applyCalendar(draft, controls)).toBe(false);
    expect(draft).toEqual(original);
    controls.nearPremium = '3';
    controls.farPremium = '5';
    expect(applyCalendar(draft, controls)).toBe(true);
    expect(draft.strategy.template).toBe('calendar');
    const { legs: _a, template: _b, ...context } = draft.strategy;
    const { legs: _c, template: _d, ...previous } = original.strategy;
    expect(context).toEqual(previous);
    expect(lifecycleRequest(draft, pathControls(draft)).errors).toEqual({});
  });
  it('drops an observed contract when its expiry changes', () => {
    const draft = createOptionsDraft();
    Object.assign(draft.strategy.legs[0], {
      expiry_date: '2026-12-18',
      bid: 1,
      ask: 2,
      quote_as_of: '2026-10-17T15:00:00Z',
      source: {
        provider: 'tradier',
        environment: 'sandbox',
        contract_symbol: 'XYZ261218C00100000',
        underlying: 'XYZ',
        fetched_at: '2026-10-17T15:00:01Z',
      },
    });
    setLegExpiry(draft, 0, 'expiry_date', '2027-01-15');
    expect(draft.strategy.legs[0]).toMatchObject({
      expiry_date: '2027-01-15',
      source: null,
      bid: null,
      ask: null,
      quote_as_of: null,
    });
  });
  it('clears conflicting override fields and keeps shares expiry-free', () => {
    const draft = createOptionsDraft();
    setLegExpiry(draft, 0, 'expiry_date', '2026-03-02');
    expect(draft.strategy.legs[0].days_to_expiry).toBeNull();
    setLegExpiry(draft, 0, 'days_to_expiry', 0);
    expect(draft.strategy.legs[0].days_to_expiry).toBe(0);
    expect(draft.strategy.legs[0].expiry_date).toBeNull();
    setLegExpiry(draft, 0, 'days_to_expiry', null);
    expect(lastExpiry(draft)).toBe(draft.strategy.days_to_expiry);
    draft.strategy.legs[0].kind = 'underlying';
    const original = structuredClone(draft);
    setLegExpiry(draft, 0, 'days_to_expiry', 7);
    setLegExpiry(draft, 99, 'days_to_expiry', 7);
    expect(draft).toEqual(original);
  });
});

describe('submitted evidence request fencing', () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    return { promise, resolve, reject };
  }
  it('publishes only the newest generation even when older fetch ignores abort', async () => {
    const publish = vi.fn();
    const job = new ResearchJob<{ n: number }, number>(
      'guest:a',
      () => 'guest:a',
      publish,
    );
    const first = deferred<number>(),
      second = deferred<number>();
    let signal!: AbortSignal;
    const a = job.submit(
      { n: 1 },
      'one',
      (_request, s) => {
        signal = s;
        return first.promise;
      },
      Number.isFinite,
    );
    const b = job.submit(
      { n: 2 },
      'two',
      () => second.promise,
      Number.isFinite,
    );
    expect(signal.aborted).toBe(true);
    first.resolve(1);
    await a;
    expect(job.state.pending).toBe(true);
    expect(job.state.result).toBeNull();
    second.resolve(2);
    await b;
    expect(job.state).toMatchObject({
      result: 2,
      pending: false,
      submittedKey: 'two',
      error: '',
    });
    expect(publish.mock.calls.some(([s]) => s.result === 1)).toBe(false);
  });
  it('snapshots requests, retains prior evidence on refresh, and sanitizes failures', async () => {
    const job = new ResearchJob<{ n: number }, number>(
      'a',
      () => 'a',
      () => {},
    );
    const request = { n: 1 };
    const pending = deferred<number>();
    let submitted!: { n: number };
    const first = job.submit(
      request,
      inputKey(createOptionsDraft(), request),
      q => {
        submitted = q;
        return pending.promise;
      },
      Number.isFinite,
    );
    request.n = 9;
    expect(submitted.n).toBe(1);
    pending.resolve(7);
    await first;
    const failed = deferred<number>();
    const refresh = job.submit(
      request,
      'edited',
      () => failed.promise,
      Number.isFinite,
    );
    expect(job.state).toMatchObject({ result: 7, pending: true });
    failed.reject(new Error('SECRET raw provider body'));
    await refresh;
    expect(job.state).toMatchObject({ result: 7, pending: false });
    expect(job.state.error).not.toContain('SECRET');
    expect(job.state.submittedKey).not.toBe('edited');
  });
  it('aborts cancellation and ignores late success/error/finally publication', async () => {
    const job = new ResearchJob<null, number>(
      'a',
      () => 'a',
      () => {},
    );
    await job.submit(null, 'old', async () => 1, Number.isFinite);
    const pending = deferred<number>();
    let signal!: AbortSignal;
    const work = job.submit(
      null,
      'new',
      (_, s) => {
        signal = s;
        return pending.promise;
      },
      Number.isFinite,
    );
    job.cancel();
    expect(signal.aborted).toBe(true);
    pending.reject(new Error('timeout'));
    await work;
    expect(job.state).toMatchObject({
      result: 1,
      pending: false,
      error: '',
      submittedKey: 'old',
    });
    expect(job.state.notice).toContain('Cancelled');
  });
  it('discards results immediately when document/account changes, then clears session evidence', async () => {
    let document = 'guest:private-a';
    const job = new ResearchJob<null, number>(
      document,
      () => document,
      () => {},
    );
    const pending = deferred<number>();
    const work = job.submit(
      null,
      'key',
      () => pending.promise,
      Number.isFinite,
    );
    document = 'account-b:private-b';
    pending.resolve(1);
    await work;
    expect(job.state.result).toBeNull();
    job.reset(document);
    expect(job.state).toEqual({
      documentKey: document,
      result: null,
      pending: false,
      submittedKey: '',
      error: '',
      notice: '',
    });
  });
  it('aborts on reset and rejects invalid responses without replacing prior evidence', async () => {
    const job = new ResearchJob<null, number>(
      'a',
      () => 'a',
      () => {},
    );
    await job.submit(null, 'old', async () => 1, Number.isFinite);
    await job.submit(null, 'invalid', async () => NaN, Number.isFinite);
    expect(job.state.result).toBe(1);
    expect(job.state.error).toContain('failed');
    const pending = deferred<number>();
    let signal!: AbortSignal;
    const work = job.submit(
      null,
      'new',
      (_, s) => {
        signal = s;
        return pending.promise;
      },
      Number.isFinite,
    );
    job.reset('b');
    expect(signal.aborted).toBe(true);
    pending.resolve(9);
    await work;
    expect(job.state).toMatchObject({
      documentKey: 'b',
      result: null,
      pending: false,
      error: '',
    });
  });
  it('never republishes the previous document result while a new document starts work', async () => {
    let document = 'guest:a';
    const publish = vi.fn();
    const job = new ResearchJob<null, number>(
      document,
      () => document,
      publish,
    );
    await job.submit(null, 'old', async () => 123, Number.isFinite);
    document = 'account-b:b';
    const next = deferred<number>();
    const work = job.submit(null, 'new', () => next.promise, Number.isFinite);
    expect(job.state).toMatchObject({
      documentKey: document,
      result: null,
      pending: true,
    });
    expect(
      publish.mock.calls.some(
        ([s]) => s.documentKey === document && s.result === 123,
      ),
    ).toBe(false);
    next.resolve(456);
    await work;
    expect(job.state).toMatchObject({
      documentKey: document,
      result: 456,
      pending: false,
    });
  });
  it.each([
    ['timeout raw', 'timed out'],
    ['rate limit raw', 'rate limited'],
    ['too large raw', 'limit'],
    ['private exception text', 'failed'],
  ])('sanitizes %s', (message, expected) => {
    expect(researchError(new Error(message))).toContain(expected);
    expect(researchError(new Error(message))).not.toContain('raw');
  });
});

describe('bounded returned observations and presentation', () => {
  it('accepts signed marks and unavailable delta, rejects oversized or nonfinite ledgers', () => {
    const response = lifecycle();
    expect(validLifecycle(response)).toBe(true);
    response.ledger[0].legs[0].state = 'settled';
    expect(validLifecycle(response)).toBe(true);
    response.ledger[0].remaining_value = NaN;
    expect(validLifecycle(response)).toBe(false);
    response.ledger = Array.from({ length: 383 }, (_, day) => ({
      ...lifecycle().ledger[0],
      day,
    }));
    expect(validLifecycle(response)).toBe(false);
  });
  it('rejects unordered rows, oversized legs/warnings and incomplete attribution context', () => {
    let response = lifecycle();
    response.ledger.push(structuredClone(response.ledger[0]));
    expect(validLifecycle(response)).toBe(false);
    response = lifecycle();
    response.ledger[0].legs = Array(17).fill(response.ledger[0].legs[0]);
    expect(validLifecycle(response)).toBe(false);
    response = lifecycle();
    response.warnings = ['x'.repeat(1001)];
    expect(validLifecycle(response)).toBe(false);
    response = lifecycle();
    response.final_pnl = Infinity;
    expect(validLifecycle(response)).toBe(false);
  });
  it.each([
    [0, 3, 'ArrowLeft', 0],
    [0, 3, 'ArrowRight', 1],
    [2, 3, 'ArrowRight', 2],
    [2, 3, 'Home', 0],
    [0, 3, 'End', 2],
    [0, 0, 'End', null],
    [0, 3, 'Escape', null],
  ] as const)('navigates %d/%d with %s', (index, count, key, expected) => {
    expect(observationIndex(index, count, key)).toBe(expected);
  });
  it('plots returned values without pricing, including one observation and all-zero series', () => {
    expect(pathChart([]).paths).toEqual([]);
    expect(pathChart([{ day: 0, values: [0] }]).paths).toEqual(['M50,180']);
    const chart = pathChart([
      { day: 0, values: [-10, 0] },
      { day: 30, values: [20, 0] },
    ]);
    expect(chart.min).toBe(-10);
    expect(chart.max).toBe(20);
    expect(chart.x(0)).toBe(50);
    expect(chart.x(30)).toBe(630);
    expect(chart.paths).toEqual(['M50,180 L630,30', 'M50,130 L630,130']);
  });
});

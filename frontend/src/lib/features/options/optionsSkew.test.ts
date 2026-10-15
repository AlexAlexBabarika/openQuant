import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { clearAccessToken, setAccessToken } from '$lib/core/api';
import OptionsSkewEditor from '../../../components/options/OptionsSkewEditor.svelte';
import { createOptionsDraft } from './optionsTemplates';
import {
  compareSkew,
  editSkewPoint,
  skewComparisonRequests,
  skewPoints,
  skewSeries,
  transformSkew,
} from './optionsSkew';
import type { OptionsDraft } from './optionsTypes';

const transform = { parallelPP: 0, twistPP: 0, curvaturePP: 0 };
function draft(): OptionsDraft {
  const d = createOptionsDraft();
  d.spot = 100;
  d.volatility = 0.2;
  const leg = d.strategy.legs[0];
  d.strategy.legs = [
    { ...leg, strike: 90, quantity: -2, implied_volatility: 0 },
    { ...leg, strike: 100, implied_volatility: null },
    { ...leg, strike: 110, implied_volatility: 0.3, days_to_expiry: 60 },
    { ...leg, kind: 'put', strike: 110, implied_volatility: 0.25 },
    { ...leg, strike: 80, enabled: false, implied_volatility: 5 },
    {
      kind: 'underlying',
      strike: null,
      quantity: -12,
      entry_premium: 99,
      multiplier: 1,
      enabled: true,
    },
  ];
  return d;
}
afterEach(() => {
  vi.unstubAllGlobals();
  clearAccessToken();
});

describe('skew identity and atomic transforms', () => {
  it('keeps leg indices/right/horizon, excludes stock/disabled and preserves zero override', () => {
    const points = skewPoints(draft());
    expect(points.map(p => p.legIndex)).toEqual([0, 1, 2, 3]);
    expect(points[0]).toMatchObject({ iv: 0, inherited: false });
    expect(points[1]).toMatchObject({ iv: 0.2, inherited: true });
    expect(skewSeries(draft()).map(s => s.key)).toEqual([
      '30 days · call',
      '60 days · call',
      '30 days · put',
    ]);
  });
  it('resolves date-only leg expiry without using today or conflating expiries', () => {
    const d = draft();
    d.strategy.valuation_date = '2028-02-28';
    d.strategy.expiry_date = '2028-03-29';
    d.strategy.legs[2].expiry_date = '2028-03-01';
    d.strategy.legs[2].days_to_expiry = null;
    expect(skewPoints(d)[2]).toMatchObject({ days: 2, expiry: '2028-03-01' });
    expect(skewSeries(d)[1].key).toBe('2 days · call');
  });
  it('parallel-shifts declared base and each active IV but keeps inheritance and disabled IV', () => {
    const d = draft(),
      before = structuredClone(d);
    const next = transformSkew(d, { ...transform, parallelPP: 10 });
    expect(next.volatility).toBeCloseTo(0.3);
    expect(next.strategy.legs[0].implied_volatility).toBeCloseTo(0.1);
    expect(next.strategy.legs[1].implied_volatility).toBeNull();
    expect(next.strategy.legs[2].implied_volatility).toBeCloseTo(0.4);
    expect(next.strategy.legs[4].implied_volatility).toBe(5);
    expect(next.strategy.legs[5]).toEqual(d.strategy.legs[5]);
    expect(d).toEqual(before);
  });
  it('applies twist and curvature by declared normalized strike distance, not financial pricing', () => {
    const d = draft();
    d.strategy.legs[0].implied_volatility = 0.2;
    const next = transformSkew(d, {
      parallelPP: 0,
      twistPP: 5,
      curvaturePP: 10,
    });
    expect(next.volatility).toBe(0.2);
    expect(next.strategy.legs[0].implied_volatility).toBeCloseTo(0.25);
    expect(next.strategy.legs[1].implied_volatility).toBeNull();
    expect(next.strategy.legs[2].implied_volatility).toBeCloseTo(0.45);
    expect(next.strategy.legs[3].implied_volatility).toBeCloseTo(0.4);
  });
  it('materializes inherited wing IVs and retains explicit IV equal to base', () => {
    const d = draft();
    d.strategy.legs[0].implied_volatility = undefined;
    d.strategy.legs[1].implied_volatility = 0.2;
    const next = transformSkew(d, { ...transform, curvaturePP: 5 });
    expect(next.strategy.legs[0].implied_volatility).toBeCloseTo(0.25);
    expect(next.strategy.legs[1].implied_volatility).toBe(0.2);
  });
  it('does not invent slope/curvature when all active strikes equal spot', () => {
    const d = draft();
    d.strategy.legs.forEach(l => {
      if (l.kind !== 'underlying') l.strike = 100;
    });
    const next = transformSkew(d, {
      ...transform,
      twistPP: 500,
      curvaturePP: 500,
    });
    expect(next).toEqual(d);
  });
  it.each([-1, 501, NaN, Infinity])(
    'rejects invalid point percent %s without mutation',
    percent => {
      const d = draft(),
        before = structuredClone(d);
      expect(() => editSkewPoint(d, 0, percent / 100)).toThrow();
      expect(d).toEqual(before);
    },
  );
  it('distinguishes explicit zero, explicit 500%, null reset and absent inheritance', () => {
    const d = draft();
    delete d.strategy.legs[1].implied_volatility;
    expect(skewPoints(d)[1].inherited).toBe(true);
    editSkewPoint(d, 0, 0);
    expect(d.strategy.legs[0].implied_volatility).toBe(0);
    editSkewPoint(d, 0, 5);
    expect(d.strategy.legs[0].implied_volatility).toBe(5);
    editSkewPoint(d, 0, null);
    expect(skewPoints(d)[0].iv).toBe(0.2);
  });
  it.each([4, 5, 99])('rejects editing inactive/non-option leg %s', index =>
    expect(() => editSkewPoint(draft(), index, 0.2)).toThrow(),
  );
  it.each([
    { ...transform, parallelPP: -1 },
    { ...transform, parallelPP: 500 },
    { ...transform, curvaturePP: -500 },
    { ...transform, twistPP: NaN },
    { ...transform, parallelPP: 501 },
  ])('rejects invalid transforms atomically: %j', t => {
    const d = draft(),
      before = structuredClone(d);
    expect(() => transformSkew(d, t)).toThrow();
    expect(d).toEqual(before);
  });
  it('preserves signed quantities, premiums, dates and chain provenance', () => {
    const d = draft();
    d.strategy.legs[0].source = {
      provider: 'tradier',
      environment: 'sandbox',
      underlying: 'XYZ',
      contract_symbol: 'XYZ-PROBE',
      fetched_at: '2026-10-15T12:00:00Z',
      bid_as_of: null,
      ask_as_of: '2026-10-15T11:59:00Z',
    };
    const next = transformSkew(d, { ...transform, parallelPP: 1 });
    expect(
      next.strategy.legs.map(({ implied_volatility: _, ...leg }) => leg),
    ).toEqual(d.strategy.legs.map(({ implied_volatility: _, ...leg }) => leg));
  });
});

describe('canonical backend-only skew comparison', () => {
  it('creates isolated bounded requests; flattens only enabled overrides, never premiums', () => {
    const d = draft(),
      before = structuredClone(d);
    const requests = skewComparisonRequests(d);
    expect(requests.flat.strategy.legs[0].implied_volatility).toBeNull();
    expect(requests.skew.strategy.legs[0].implied_volatility).toBe(0);
    expect(requests.flat.strategy.legs[4].implied_volatility).toBe(5);
    expect(requests.flat.scenarios).toEqual([]);
    expect(requests.flat.surface).toBeNull();
    expect(requests.flat.strategy.legs.map(l => l.entry_premium)).toEqual(
      d.strategy.legs.map(l => l.entry_premium),
    );
    requests.flat.strategy.name = 'Changed';
    expect(d).toEqual(before);
    expect(requests.skew.strategy.name).toBe(before.strategy.name);
  });
  it('rejects invalid drafts before transport', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const d = draft();
    d.volatility = NaN;
    await expect(compareSkew(d, new AbortController().signal)).rejects.toThrow(
      'volatility',
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses the canonical analyze endpoint twice with shared cancellation and no account token', async () => {
    const fetch = vi
      .fn()
      .mockImplementation(
        async (_url, init) =>
          new Response(
            JSON.stringify({ request: JSON.parse(init.body), warnings: [] }),
          ),
      );
    vi.stubGlobal('fetch', fetch);
    setAccessToken('test-placeholder');
    const signal = new AbortController().signal;
    const result = await compareSkew(draft(), signal);
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetch.mock.calls) {
      expect(url).toMatch(/\/options\/analyze$/);
      expect(init.signal).toBe(signal);
      expect(init.method).toBe('POST');
      expect(init.headers.has('Authorization')).toBe(false);
    }
    expect(result.flat.request.strategy.legs[0].implied_volatility).toBeNull();
    expect(result.skew.request.strategy.legs[0].implied_volatility).toBe(0);
  });
  it('forwards cancellation to both canonical requests', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, init) =>
          new Promise((_resolve, reject) =>
            init.signal.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            ),
          ),
      ),
    );
    const controller = new AbortController();
    const run = compareSkew(draft(), controller.signal);
    controller.abort();
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('renders controls, expiry/right separation and read-only state without submitting or editing', () => {
    const fetch = vi.fn(),
      onEdit = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const html = render(OptionsSkewEditor, {
      props: {
        draft: draft(),
        documentKey: 'guest:document:1',
        onEdit,
        readOnly: true,
      },
    }).body;
    expect(html).toContain('30 days · call');
    expect(html).toContain('60 days · call');
    expect(html).toContain('30 days · put');
    expect(html).toContain('Read-only source mode');
    expect(html).toContain('fieldset disabled');
    expect(html).toContain('aria-describedby');
    expect(html).toContain('tabindex="0"');
    expect(onEdit).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { clearAccessToken, setAccessToken } from '$lib/core/api';
import OptionsStressLab from '../../../components/options/OptionsStressLab.svelte';
import { createOptionsDraft } from './optionsTemplates';
import {
  applyStressScenario,
  greekDifferences,
  researchDifference,
  runStress,
  STRESS_PRESETS,
  stressErrors,
  stressEvidence,
  stressRequests,
} from './optionsStress';
import type { StressResult, StressSettings } from './optionsStress';

const settings = (): StressSettings => ({ ...STRESS_PRESETS[0] });
const draft = () => {
  const d = createOptionsDraft();
  d.spot = 100;
  return d;
};
afterEach(() => {
  vi.unstubAllGlobals();
  clearAccessToken();
});

describe('bounded explicit hypothetical stress', () => {
  it('supplies all three requested editable assumptions without executing', () => {
    expect(STRESS_PRESETS).toHaveLength(3);
    expect(STRESS_PRESETS[0]).toMatchObject({
      spotChangePct: 5,
      ivShiftPP: -10,
    });
    expect(STRESS_PRESETS[1]).toMatchObject({
      spotChangePct: -20,
      ivShiftPP: 20,
    });
    expect(STRESS_PRESETS[2]).toMatchObject({
      spotChangePct: 0,
      elapsedDays: 7,
      ivShiftPP: 0,
    });
  });
  it.each([-100, -101, 1001, NaN, Infinity])(
    'rejects invalid spot change %s without clipping',
    gap =>
      expect(
        stressErrors(draft(), { ...settings(), spotChangePct: gap })
          .spotChangePct,
      ).toBeTruthy(),
  );
  it('bounds absolute hypothetical spot as well as percentage', () => {
    const d = draft();
    d.spot = 1000000;
    expect(stressErrors(d, settings()).spotChangePct).toBeTruthy();
    expect(
      stressErrors(d, { ...settings(), spotChangePct: 0 }).spotChangePct,
    ).toBeUndefined();
    expect(
      stressErrors(draft(), { ...settings(), spotChangePct: -99.99 })
        .spotChangePct,
    ).toBeUndefined();
  });
  it('caps elapsed time at first active expiry, not common or longest expiry', () => {
    const d = draft();
    d.strategy.legs[0].days_to_expiry = 2;
    d.strategy.legs.push({ ...d.strategy.legs[0], days_to_expiry: 60 });
    expect(
      stressErrors(d, { ...settings(), elapsedDays: 2 }).elapsedDays,
    ).toBeUndefined();
    expect(
      stressErrors(d, { ...settings(), elapsedDays: 2.001 }).elapsedDays,
    ).toBeTruthy();
  });
  it('does not clip preset to zero-day horizon', () => {
    const d = draft();
    d.strategy.days_to_expiry = 0;
    expect(stressErrors(d, settings()).elapsedDays).toBeTruthy();
    expect(
      stressErrors(d, { ...settings(), elapsedDays: 0 }).elapsedDays,
    ).toBeUndefined();
    expect(settings().elapsedDays).toBe(1);
  });
  it('validates each enabled IV and declared base, excluding disabled IV from shift bounds', () => {
    const d = draft();
    d.strategy.legs[0].implied_volatility = 0;
    expect(stressErrors(d, settings()).ivShiftPP).toBeTruthy();
    d.strategy.legs[0].implied_volatility = 4.95;
    expect(stressErrors(d, STRESS_PRESETS[1]).ivShiftPP).toBeTruthy();
    d.strategy.legs[0].implied_volatility = 0.5;
    d.volatility = 0;
    expect(stressErrors(d, settings()).ivShiftPP).toBeTruthy();
    d.volatility = 0.2;
    d.strategy.legs.push({
      ...d.strategy.legs[0],
      enabled: false,
      implied_volatility: 5,
    });
    expect(stressErrors(d, STRESS_PRESETS[1])).toEqual({});
  });
  it.each([NaN, Infinity, -101, 101])('rejects invalid IV shift %s', iv =>
    expect(
      stressErrors(draft(), { ...settings(), ivShiftPP: iv }).ivShiftPP,
    ).toBeTruthy(),
  );
  it.each([NaN, Infinity, -1])('rejects invalid elapsed days %s', elapsedDays =>
    expect(
      stressErrors(draft(), { ...settings(), elapsedDays }).elapsedDays,
    ).toBeTruthy(),
  );
  it('requires nonblank bounded labels', () => {
    for (const name of ['', ' ', 'x'.repeat(81)])
      expect(stressErrors(draft(), { ...settings(), name }).name).toBeTruthy();
  });
  it('builds a matching fixed-entry baseline and first-expiry stress without changing live inputs', () => {
    const d = draft();
    d.strategy.legs[0].quantity = -3;
    d.strategy.entry_fee_per_contract = 2;
    d.strategy.legs[0].implied_volatility = 0.3;
    d.strategy.legs[0].source = {
      provider: 'tradier',
      environment: 'sandbox',
      contract_symbol: 'XYZ',
      underlying: 'XYZ',
      fetched_at: '2026-10-15T12:00:00Z',
      bid_as_of: null,
      ask_as_of: null,
    };
    const before = structuredClone(d),
      requests = stressRequests(d, settings());
    expect(requests.baseline.spot).toBe(100);
    expect(requests.stress.spot).toBe(105);
    expect(requests.baseline.strategy).toEqual(requests.stress.strategy);
    expect(requests.stress.strategy).toEqual(d.strategy);
    expect(requests.stress.volatility).toBe(d.volatility);
    expect(requests.stress.strategy.legs[0].implied_volatility).toBe(0.3);
    expect(requests.baseline.spot_grid).toEqual([0, 100]);
    expect(requests.stress.spot_grid).toEqual([0, 105]);
    expect(requests.baseline.scenarios).toEqual([]);
    expect(requests.stress.scenarios).toEqual([
      { name: settings().name, elapsed_days: 1, iv_shift_pp: -10 },
    ]);
    expect(requests.baseline.surface).toBeNull();
    expect(d).toEqual(before);
  });
  it('uses bounded exact spot probes even for a 201-point original grid', () => {
    const d = draft();
    d.spot_grid = Array.from({ length: 201 }, (_, i) => i);
    const requests = stressRequests(d, settings());
    expect(requests.stress.spot_grid).toEqual([0, 105]);
    expect(d.spot_grid).toHaveLength(201);
  });
  it('applies only explicit time/IV scenario, not spot/IV/premiums or live execution', () => {
    const d = draft(),
      original = structuredClone(d);
    d.scenarios = [];
    applyStressScenario(d, settings());
    expect(d.scenarios).toHaveLength(1);
    expect({ ...d, scenarios: original.scenarios }).toEqual(original);
    applyStressScenario(d, { ...settings(), elapsedDays: 2 });
    expect(d.scenarios).toHaveLength(1);
    expect(d.scenarios[0].elapsed_days).toBe(2);
  });
  it('does not silently discard a full set of draft scenarios', () => {
    const d = draft();
    d.scenarios = [1, 2, 3].map(i => ({
      name: `S${i}`,
      elapsed_days: 0,
      iv_shift_pp: 0,
    }));
    const before = structuredClone(d);
    expect(() => applyStressScenario(d, settings())).toThrow('three');
    expect(d).toEqual(before);
  });
});

describe('canonical stress evidence, transport and static controls', () => {
  it('preserves true zero and propagates unavailable Greeks/differences', () => {
    expect(researchDifference(0, 0)).toBe(0);
    expect(researchDifference(1, -2)).toBe(3);
    for (const missing of [null, undefined, NaN, Infinity]) {
      expect(researchDifference(missing, 0)).toBeNull();
      expect(researchDifference(0, missing)).toBeNull();
    }
    expect(
      greekDifferences(
        { delta: null, gamma: 0, theta: null, vega: 0, rho: 0 },
        { delta: 2, gamma: 0, theta: -1, vega: null, rho: 1 },
      ),
    ).toEqual({ delta: null, gamma: 0, theta: null, vega: null, rho: -1 });
  });
  it('selects exact shock-spot scenario P&L, not current/theoretical or neighbor P&L', () => {
    const result = {
      baseline: { summary: { pnl_today: 100 } },
      stress: {
        spot_grid: [0, 105],
        request: { spot: 105 },
        scenarios: [
          {
            pnl: [-500, 0],
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
    } as unknown as StressResult;
    expect(stressEvidence(result)).toMatchObject({
      pnl: 0,
      pnlDifference: -100,
      greeks: { delta: null },
    });
    result.stress.request.spot = 106;
    expect(stressEvidence(result).pnl).toBeNull();
    expect(stressEvidence(result).pnlDifference).toBeNull();
    result.stress.scenarios = [];
    expect(stressEvidence(result).greeks).toBeNull();
  });
  it('sends exact bounded snapshots to canonical analyze twice with one AbortSignal, without credentials', async () => {
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
    const signal = new AbortController().signal,
      d = draft();
    const running = runStress(d, settings(), signal);
    d.spot = 300;
    const result = await running;
    expect(result.baseline.request.spot).toBe(100);
    expect(result.stress.request.spot).toBe(105);
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetch.mock.calls) {
      expect(url).toMatch(/\/options\/analyze$/);
      expect(init.signal).toBe(signal);
      expect(init.headers.has('Authorization')).toBe(false);
    }
  });
  it('rejects invalid requests without contacting backend', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const d = draft();
    d.strategy.legs[0].quantity = 0;
    await expect(
      runStress(d, settings(), new AbortController().signal),
    ).rejects.toThrow('quantity');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('propagates cancelled canonical requests without computing substitute evidence', async () => {
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
    const run = runStress(draft(), settings(), controller.signal);
    controller.abort();
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('renders all presets, native keyboard controls, field feedback and read-only state without execution', () => {
    const fetch = vi.fn(),
      onEdit = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const html = render(OptionsStressLab, {
      props: {
        draft: draft(),
        onEdit,
        documentKey: 'guest:document:1',
        readOnly: true,
      },
    }).body;
    for (const preset of STRESS_PRESETS) expect(html).toContain(preset.name);
    expect(html).toContain('fieldset disabled');
    expect(html).toContain('aria-describedby');
    expect(html).toContain('Read-only source mode');
    expect(fetch).not.toHaveBeenCalled();
    expect(onEdit).not.toHaveBeenCalled();
  });
});

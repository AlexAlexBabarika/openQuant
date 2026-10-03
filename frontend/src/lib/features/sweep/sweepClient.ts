/**
 * HTTP wrappers for the /sweeps API. Injected into SweepState so tests can stub
 * the network. Mirrors the fetch style used elsewhere in the app.
 */
import type { ParamSchema, SweepClient, SweepProgress } from './types';
import type { BacktestResult } from '$lib/features/backtest/types';

const base = ''; // same-origin; adjust if the app proxies the API under a prefix

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const httpSweepClient: SweepClient = {
  async schema(code) {
    const res = await fetch(`${base}/sweeps/schema`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    return (await json<{ schema: ParamSchema }>(res)).schema;
  },
  async start(form) {
    const res = await fetch(`${base}/sweeps`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(form),
    });
    return json<{ sweep_id: string }>(res);
  },
  async poll(sweepId) {
    return json<SweepProgress>(await fetch(`${base}/sweeps/${sweepId}`));
  },
  async cancel(sweepId) {
    const res = await fetch(`${base}/sweeps/${sweepId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
  },
  async loadTrial(sweepId, trialId, form) {
    const q = new URLSearchParams({
      symbol: form.symbol,
      provider: form.provider,
      code: form.code,
      period: form.period ?? '1y',
      interval: form.interval ?? '1d',
    });
    return json<BacktestResult>(
      await fetch(`${base}/sweeps/${sweepId}/trial/${trialId}?${q}`),
    );
  },
};

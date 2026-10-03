import { describe, expect, it, vi } from 'vitest';
import { runAndRecord } from '../../../components/strategy/PortfolioPanel.svelte';
import { PortfolioState } from '../portfolio/portfolioState.svelte';
import type { PortfolioRunResponse } from '../portfolio/portfolioClient';

const CTX = { provider: 'yfinance', period: '1y', interval: '1d' } as const;
const response = (id: string) =>
  ({
    status: 'ok',
    meta: { run_id: id },
    symbols: ['AAPL'],
    stderr: '',
  }) as PortfolioRunResponse;

describe('portfolio run history', () => {
  it('does not re-record the previous successful run when the next attempt fails', async () => {
    const client = {
      run: vi
        .fn()
        .mockResolvedValueOnce(response('old'))
        .mockRejectedValueOnce(new Error('No bars')),
      ingest: vi.fn(),
    };
    const portfolio = new PortfolioState(client);
    const history = { record: vi.fn() };
    portfolio.add('AAPL');
    await runAndRecord(portfolio, 'code', CTX, history);
    await runAndRecord(portfolio, 'code', CTX, history);
    expect(history.record).toHaveBeenCalledOnce();
    expect(portfolio.runError).toBe('No bars');
  });

  it('uses completed run symbols even if the universe changes while awaiting the response', async () => {
    let resolve!: (value: PortfolioRunResponse) => void;
    const client = {
      run: vi.fn(
        () =>
          new Promise<PortfolioRunResponse>(r => {
            resolve = r;
          }),
      ),
      ingest: vi.fn(),
    };
    const portfolio = new PortfolioState(client);
    const history = { record: vi.fn() };
    portfolio.add('AAPL');
    const pending = runAndRecord(portfolio, 'code', CTX, history);
    portfolio.clear();
    portfolio.add('MSFT');
    resolve(response('new'));
    await pending;
    expect(history.record).toHaveBeenCalledWith(
      expect.objectContaining({ run_id: 'new', label: 'AAPL' }),
    );
  });
});

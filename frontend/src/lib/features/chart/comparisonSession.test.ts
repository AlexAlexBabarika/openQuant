import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComparisonController } from './comparisonController.svelte';
import { listComparisons, type ComparisonRecord } from './comparisonsApi';

vi.mock('svelte', async importOriginal => ({
  ...(await importOriginal<typeof import('svelte')>()),
  onDestroy: vi.fn(),
}));
vi.mock('./comparisonsApi', () => ({
  listComparisons: vi.fn(),
  createComparison: vi.fn(),
  deleteComparison: vi.fn(),
  updateComparison: vi.fn(),
}));

const record: ComparisonRecord = {
  id: 'comparison-1',
  main_symbol: 'AAPL',
  comparison_symbol: 'MSFT',
  provider: 'csv',
  color: '#ffffff',
  series_type: 'line',
  position: 0,
  created_at: '2026-01-01T00:00:00Z',
};

function setup(userId: string | null = 'user-1') {
  const onError = vi.fn();
  const session = { userId };
  const controller = new ComparisonController({
    userId: () => session.userId,
    mainSymbol: () => 'AAPL',
    period: () => '1mo',
    interval: () => '1d',
    mainProvider: () => 'yfinance',
    onError,
  });
  return { controller, session, onError };
}

afterEach(() => vi.resetAllMocks());

describe('comparison session loading', () => {
  it('does not request saved comparisons or report an error while signed out', async () => {
    const { controller, onError } = setup(null);
    await controller.load('AAPL');
    expect(listComparisons).not.toHaveBeenCalled();
    expect(controller.comparisons).toEqual([]);
    expect(controller.isLoading).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });

  it('loads saved comparisons after sign-in and clears them after sign-out', async () => {
    const { controller, session } = setup(null);
    await controller.load('AAPL');
    session.userId = 'user-1';
    vi.mocked(listComparisons).mockResolvedValueOnce([record]);
    await controller.load('AAPL');
    expect(listComparisons).toHaveBeenCalledExactlyOnceWith('AAPL');
    expect(controller.comparisons.map(c => c.id)).toEqual([record.id]);
    session.userId = null;
    await controller.load('AAPL');
    expect(controller.comparisons).toEqual([]);
    expect(listComparisons).toHaveBeenCalledTimes(1);
  });

  it.each([null, 'user-2'])(
    'ignores a response for a previous user (%s)',
    async nextUser => {
      let resolve!: (records: ComparisonRecord[]) => void;
      vi.mocked(listComparisons).mockReturnValueOnce(
        new Promise(done => {
          resolve = done;
        }),
      );
      const { controller, session, onError } = setup();
      const pending = controller.load('AAPL');
      session.userId = nextUser;
      vi.mocked(listComparisons).mockResolvedValueOnce([]);
      await controller.load('AAPL');
      resolve([record]);
      await pending;
      expect(controller.comparisons).toEqual([]);
      expect(controller.isLoading).toBe(false);
      expect(onError).not.toHaveBeenCalled();
    },
  );

  it('ignores a response for a previous chart symbol', async () => {
    let resolve!: (records: ComparisonRecord[]) => void;
    vi.mocked(listComparisons).mockReturnValueOnce(
      new Promise(done => {
        resolve = done;
      }),
    );
    const { controller } = setup();
    const pending = controller.load('AAPL');
    vi.mocked(listComparisons).mockResolvedValueOnce([]);
    await controller.load('NVDA');
    resolve([record]);
    await pending;
    expect(controller.comparisons).toEqual([]);
  });

  it('does not show a late request error after sign-out', async () => {
    let reject!: (error: Error) => void;
    vi.mocked(listComparisons).mockReturnValueOnce(
      new Promise((_, fail) => {
        reject = fail;
      }),
    );
    const { controller, session, onError } = setup();
    const pending = controller.load('AAPL');
    session.userId = null;
    await controller.load('AAPL');
    reject(new Error('Missing Authorization header'));
    await pending;
    expect(onError).not.toHaveBeenCalled();
  });

  it('still reports failures for the current authenticated user', async () => {
    vi.mocked(listComparisons).mockRejectedValueOnce(
      new Error('Server unavailable'),
    );
    const { controller, onError } = setup();
    await controller.load('AAPL');
    expect(onError).toHaveBeenCalledExactlyOnceWith('Server unavailable');
    expect(controller.isLoading).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { createTrialShareUrl, readTrialShareConfig } from './sharing';
import type { TrialConfig, TrialStrategyId } from './types';

const config: TrialConfig = {
  strategy_id: 'backtest-billionaire',
  commission_bps: 1,
  slippage_bps: 5,
};
const search =
  '?trial=1&v=1&strategy=backtest-billionaire&commission=1&slippage=5';

describe('trial share links', () => {
  it('creates canonical public URLs with only the allowed configuration fields', () => {
    const url = createTrialShareUrl(
      config,
      'https://example.com/private/path?api_key=secret#code',
    );
    expect(url).toBe(`https://example.com/${search}`);
    expect(readTrialShareConfig(new URL(url).search)).toEqual(config);
  });

  it.each([
    'backtest-billionaire',
    'overcaffeinated-trader',
    'boring-benchmark',
  ] as const)('round-trips %s with zero and maximum costs', strategy_id => {
    const input = { strategy_id, commission_bps: 0, slippage_bps: 50 };
    expect(
      readTrialShareConfig(
        new URL(createTrialShareUrl(input, 'http://example.com')).search,
      ),
    ).toEqual(input);
  });

  it('canonicalizes numbers and ignores unrelated query fields', () => {
    const parsed = readTrialShareConfig(
      `${search.replace('commission=1', 'commission=1.00')}&code=secret&workspace=1`,
    );
    expect(parsed).toEqual(config);
    expect(
      createTrialShareUrl(
        { ...config, commission_bps: -0 },
        'https://example.com',
      ),
    ).toContain('commission=0&slippage=5');
    expect(
      readTrialShareConfig(search.replace('slippage=5', 'slippage=5e-1'))
        ?.slippage_bps,
    ).toBe(0.5);
  });

  it.each([
    '',
    '?trial=1',
    search.replace('v=1', 'v=2'),
    search.replace('v=1', 'v=01'),
    search.replace('trial=1', 'trial=0'),
    search.replace('strategy=backtest-billionaire', 'strategy=evil'),
    search.replace('strategy=backtest-billionaire', 'strategy=constructor'),
    `${search}&v=1`,
    `${search}&commission=1`,
    `${search}&strategy=boring-benchmark`,
    search.replace('&slippage=5', ''),
  ])('rejects missing, ambiguous or unsupported fields: %s', value => {
    expect(readTrialShareConfig(value)).toBeNull();
  });

  it.each([
    'NaN',
    'Infinity',
    '-Infinity',
    '1e999',
    '-0.01',
    '50.0001',
    '51',
    '',
    '%20',
    '0x10',
    'null',
    '5px',
    '1%265',
    '%3Cscript%3E',
  ])('rejects malformed or out-of-range costs: %s', value => {
    expect(
      readTrialShareConfig(
        search.replace('commission=1', `commission=${value}`),
      ),
    ).toBeNull();
    expect(
      readTrialShareConfig(search.replace('slippage=5', `slippage=${value}`)),
    ).toBeNull();
  });

  it.each([NaN, Infinity, -Infinity, -1, 50.01])(
    'refuses to create invalid numeric URLs: %s',
    value => {
      expect(() =>
        createTrialShareUrl(
          { ...config, commission_bps: value },
          'https://example.com',
        ),
      ).toThrow();
      expect(() =>
        createTrialShareUrl(
          { ...config, slippage_bps: value },
          'https://example.com',
        ),
      ).toThrow();
    },
  );

  it('refuses unknown IDs even if a caller bypasses the TypeScript contract', () => {
    expect(() =>
      createTrialShareUrl(
        { ...config, strategy_id: 'bad' as TrialStrategyId },
        'https://example.com',
      ),
    ).toThrow();
  });

  it.each([
    'javascript:alert(1)',
    'file:///private/results',
    'https://user:secret@example.com',
    'invalid',
  ])('refuses non-public URL bases: %s', base => {
    expect(() => createTrialShareUrl(config, base)).toThrow();
  });
});

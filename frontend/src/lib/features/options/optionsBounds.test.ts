import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MAX_CHAIN_EXPIRATIONS,
  MAX_CHAIN_QUOTES,
  MAX_DAYS,
  MAX_FINDER_EVALUATIONS,
  MAX_OPTION_CONTRACTS,
  MAX_PATH_POINTS,
  MAX_PRICE,
  MAX_UNDERLYING_SHARES,
  SYMBOL_PATTERN,
} from './optionsBounds';

const backend = (file: string) =>
  readFileSync(
    new URL(`../../../../../backend/derivatives/${file}`, import.meta.url),
    'utf8',
  );
const int = (text: string) => Number(text.replace(/_/g, ''));
function declared(source: string, pattern: RegExp): string {
  const match = source.match(pattern);
  if (!match) throw new Error(`Backend bound not found: ${pattern}`);
  return match[1];
}

describe('options bounds match the backend models', () => {
  const models = backend('models.py');
  const research = backend('research_models.py');
  const chains = backend('chains.py');

  it('prices and days', () => {
    expect(int(declared(models, /^Price = .*le=([\d_]+)/m))).toBe(MAX_PRICE);
    expect(int(declared(models, /^PositivePrice = .*le=([\d_]+)/m))).toBe(
      MAX_PRICE,
    );
    expect(int(declared(models, /^Days = .*le=([\d_]+)/m))).toBe(MAX_DAYS);
  });

  it('leg sizes', () => {
    const quantity = declared(
      models,
      /quantity: int = Field\(([\s\S]*?)\n    \)/,
    );
    expect(int(declared(quantity, /le=([\d_]+)/))).toBe(MAX_UNDERLYING_SHARES);
    expect(int(declared(quantity, /options <=(\d+) contracts/))).toBe(
      MAX_OPTION_CONTRACTS,
    );
    expect(int(declared(quantity, /underlying <=(\d+) shares/))).toBe(
      MAX_UNDERLYING_SHARES,
    );
  });

  it('research limits', () => {
    expect(int(declared(research, /^MAX_PATH_POINTS = ([\d_]+)/m))).toBe(
      MAX_PATH_POINTS,
    );
    expect(int(declared(research, /^MAX_FINDER_EVALUATIONS = ([\d_]+)/m))).toBe(
      MAX_FINDER_EVALUATIONS,
    );
    expect(int(declared(research, /^MAX_CHAIN_QUOTES = ([\d_]+)/m))).toBe(
      MAX_CHAIN_QUOTES,
    );
    expect(
      int(
        declared(
          research,
          /expirations: list\[ChainDate\] = Field\(max_length=(\d+)\)/,
        ),
      ),
    ).toBe(MAX_CHAIN_EXPIRATIONS);
    expect(int(declared(chains, /len\(expirations\) > (\d+)/))).toBe(
      MAX_CHAIN_EXPIRATIONS,
    );
  });

  it('symbol pattern', () => {
    expect(declared(research, /^Symbol = .*pattern=r"([^"]+)"/m)).toBe(
      SYMBOL_PATTERN.source.replace('\\/', '/'),
    );
  });
});

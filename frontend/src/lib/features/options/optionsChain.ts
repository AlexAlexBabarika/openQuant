import type {
  OptionLeg,
  OptionsDraft,
  OptionsContractSource,
} from './optionsTypes';
import type { ChainQuote, ChainResponse } from './optionsResearchTypes';
import { calendar, optionsErrors, quoteTimestamp } from './optionsValidation';

export type ChainPremiumChoice = '' | 'bid' | 'ask' | 'mid' | 'custom';
export interface ChainImportSettings {
  side: 'buy' | 'sell';
  size: number;
  premiumChoice: ChainPremiumChoice;
  customPremium: number;
  multiplier: number;
  valuationDate: string;
  ivChoice: '' | 'draft' | 'quote' | 'custom';
  customIv: number;
  acknowledgeModel: boolean;
  acknowledgeQuote: boolean;
  setUnderlying: boolean;
}
export type ChainSort =
  | 'strike'
  | 'bid'
  | 'ask'
  | 'spread'
  | 'volume'
  | 'open_interest';
export interface ChainFilters {
  kind: 'all' | 'call' | 'put';
  minStrike: number | null;
  maxStrike: number | null;
  sort: ChainSort;
  descending: boolean;
  page: number;
}
export const CHAIN_PAGE_SIZE = 50;
const price = (n: number | null): n is number =>
  n !== null && Number.isFinite(n) && n >= 0 && n <= 1e6;

export function chainSpread(quote: ChainQuote): number | null {
  return price(quote.bid) && price(quote.ask) ? quote.ask - quote.bid : null;
}

/** Backend chain errors carry fixed, credential-free guidance (re-save key, rate limit, timeout). */
export function chainFailureMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : 'Chain request failed. Check sign-in, API key settings and provider availability, then retry explicitly. No credentials or provider response bodies are shown.';
}

/** Quote arithmetic only, never theoretical pricing or an entry-price default. */
export function chainPremium(
  quote: ChainQuote,
  choice: ChainPremiumChoice,
  custom: number,
): number | null {
  if (choice === 'custom') return price(custom) ? custom : null;
  if (choice === 'bid')
    return price(quote.bid) && quoteTimestamp(quote.bid_as_of)
      ? quote.bid
      : null;
  if (choice === 'ask')
    return price(quote.ask) && quoteTimestamp(quote.ask_as_of)
      ? quote.ask
      : null;
  if (
    choice === 'mid' &&
    price(quote.bid) &&
    price(quote.ask) &&
    quote.bid <= quote.ask &&
    quoteTimestamp(quote.bid_as_of) &&
    quoteTimestamp(quote.ask_as_of)
  )
    return (quote.bid + quote.ask) / 2;
  return null;
}

export function needsChainModelAcknowledgment(quote: ChainQuote): boolean {
  return (
    quote.source.observed_exercise_style !== 'european' ||
    quote.source.observed_settlement !== 'cash'
  );
}

export function chainFilterErrors(
  filters: ChainFilters,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of ['minStrike', 'maxStrike'] as const) {
    if (filters[field] !== null && !price(filters[field]))
      errors[field] = 'Use a strike from 0 to 1000000 USD, or leave blank.';
  }
  if (
    filters.minStrike !== null &&
    filters.maxStrike !== null &&
    filters.minStrike > filters.maxStrike
  )
    errors.maxStrike = 'Maximum strike must be at least minimum strike.';
  return errors;
}

export function chainRows(response: ChainResponse, filters: ChainFilters) {
  if (response.quotes.length > 2000)
    throw new Error('Chain quote bound exceeded.');
  const rows = response.quotes.filter(
    q =>
      (filters.kind === 'all' || q.kind === filters.kind) &&
      (filters.minStrike === null || q.strike >= filters.minStrike) &&
      (filters.maxStrike === null || q.strike <= filters.maxStrike),
  );
  const value = (q: ChainQuote) =>
    filters.sort === 'spread' ? chainSpread(q) : q[filters.sort];
  rows.sort((a, b) => {
    const av = value(a),
      bv = value(b);
    const aKnown = av !== null && Number.isFinite(av),
      bKnown = bv !== null && Number.isFinite(bv);
    if (aKnown !== bKnown) return aKnown ? -1 : 1;
    const order =
      aKnown && bKnown ? (av! - bv!) * (filters.descending ? -1 : 1) : 0;
    return order || a.contract_symbol.localeCompare(b.contract_symbol);
  });
  const pages = Math.max(1, Math.ceil(rows.length / CHAIN_PAGE_SIZE));
  const page = Math.max(0, Math.min(pages - 1, Math.trunc(filters.page) || 0));
  return {
    quotes: rows.slice(page * CHAIN_PAGE_SIZE, (page + 1) * CHAIN_PAGE_SIZE),
    total: rows.length,
    pages,
    page,
  };
}

/** Whitelist bounded provenance only; no raw responses, keys or legacy quote fields. */
function sourceFor(quote: ChainQuote): OptionsContractSource {
  return {
    provider: quote.source.provider,
    environment: quote.source.environment,
    contract_symbol: quote.contract_symbol,
    underlying: quote.underlying,
    fetched_at: quote.source.fetched_at,
    bid_as_of: quote.bid_as_of,
    ask_as_of: quote.ask_as_of,
    observed_exercise_style: quote.source.observed_exercise_style ?? 'unknown',
    observed_settlement: quote.source.observed_settlement ?? 'unknown',
  };
}

export function proposeChainImport(
  draft: OptionsDraft,
  quote: ChainQuote,
  settings: ChainImportSettings,
): { draft: OptionsDraft | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (draft.strategy.legs.length >= 16)
    errors.legs =
      'The draft already has 16 legs (disabled rows count). Remove one explicitly before import.';
  const underlying = draft.strategy.underlying?.trim();
  if (underlying && underlying.toUpperCase() !== quote.underlying.toUpperCase())
    errors.underlying = `Contract underlying ${quote.underlying} differs from draft ${underlying}. Import cannot change an existing identity.`;
  if (!underlying && !settings.setUnderlying)
    errors.underlying =
      'Explicitly confirm setting the blank draft underlying to this contract identity.';
  if (
    quote.contract_symbol !== quote.source.contract_symbol ||
    quote.underlying !== quote.source.underlying
  )
    errors.source = 'Contract identity and provenance disagree; fetch again.';
  if (needsChainModelAcknowledgment(quote) && !settings.acknowledgeModel)
    errors.acknowledgeModel =
      'Acknowledge the European cash-settled hypothetical model before import; American assignment and physical delivery are not modeled.';
  const premium = chainPremium(
    quote,
    settings.premiumChoice,
    settings.customPremium,
  );
  if (premium === null)
    errors.premiumChoice =
      'Explicitly choose a usable timestamped bid/ask/mid, or enter a custom premium from 0 to 1000000 USD/unit. Mid requires non-crossed paired quotes and both side timestamps.';
  if (
    settings.premiumChoice !== '' &&
    settings.premiumChoice !== 'custom' &&
    !settings.acknowledgeQuote
  )
    errors.acknowledgeQuote =
      'Confirm using the displayed observation as a hypothetical entry; its timestamps may be stale and are not verified.';
  if (
    !Number.isInteger(settings.size) ||
    settings.size < 1 ||
    settings.size > 10000
  )
    errors.size = 'Use 1–10000 contracts; Buy/Sell controls the sign.';
  if (!['buy', 'sell'].includes(settings.side))
    errors.side = 'Choose Buy or Sell.';
  if (
    !Number.isInteger(settings.multiplier) ||
    settings.multiplier < 1 ||
    settings.multiplier > 1000
  )
    errors.multiplier =
      'Explicitly supply a multiplier of 1–1000 units per contract.';
  if (quote.multiplier !== null && settings.multiplier !== quote.multiplier)
    errors.multiplier =
      'Multiplier differs from the observed contract. Use the reported multiplier, or author a separate manual contract.';
  const valuation = calendar(settings.valuationDate),
    expiry = calendar(quote.expiration);
  if (valuation === null)
    errors.valuationDate =
      'Supply an explicit valid UTC valuation date; fetch time is not a valuation date.';
  if (
    draft.strategy.valuation_date &&
    settings.valuationDate !== draft.strategy.valuation_date
  )
    errors.valuationDate =
      'Use the existing draft valuation date. Change it explicitly in the parent editor first.';
  if (
    valuation !== null &&
    (expiry === null ||
      expiry < valuation ||
      (expiry - valuation) / 86400000 > 3650)
  )
    errors.expiration =
      'Expiry must be a valid UTC date 0–3650 days after the explicit valuation.';
  if (!['draft', 'quote', 'custom'].includes(settings.ivChoice))
    errors.ivChoice =
      'Explicitly choose inherited draft IV, observed IV, or a custom annual fraction.';
  const iv =
    settings.ivChoice === 'quote'
      ? quote.implied_volatility
      : settings.ivChoice === 'custom'
        ? settings.customIv
        : null;
  if (
    (settings.ivChoice === 'quote' || settings.ivChoice === 'custom') &&
    (iv === null || !Number.isFinite(iv) || iv < 0 || iv > 5)
  )
    errors.ivChoice =
      'Chosen IV must be known and between 0 and 5 as an annual fraction (0 is valid).';
  if (Object.keys(errors).length) return { draft: null, errors };
  const next = structuredClone(draft);
  const leg: OptionLeg = {
    kind: quote.kind,
    quantity: settings.size * (settings.side === 'sell' ? -1 : 1),
    strike: quote.strike,
    entry_premium: premium!,
    multiplier: settings.multiplier,
    enabled: true,
    // Days resolve from expiry_date; storing them too breaks the leg when the valuation date moves.
    expiry_date: quote.expiration,
    days_to_expiry: null,
    implied_volatility: iv,
    source: sourceFor(quote),
  };
  next.strategy.template = 'custom';
  next.strategy.underlying = underlying || quote.underlying;
  next.strategy.valuation_date = settings.valuationDate;
  next.strategy.legs.push(leg);
  for (const [key, message] of Object.entries(optionsErrors(next)))
    errors[`draft.${key}`] = message;
  return { draft: Object.keys(errors).length ? null : next, errors };
}

export function applyChainImport(
  draft: OptionsDraft,
  quote: ChainQuote,
  settings: ChainImportSettings,
): boolean {
  const proposed = proposeChainImport(draft, quote, settings);
  if (!proposed.draft) return false;
  draft.strategy = proposed.draft.strategy;
  return true;
}

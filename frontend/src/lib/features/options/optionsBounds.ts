/**
 * Request bounds the options backend enforces, stated once for the frontend.
 * The source of truth is `backend/derivatives/models.py`, `research_models.py`
 * and `chains.py`; `optionsBounds.test.ts` fails if the two sides drift.
 */

/** USD ceiling for a spot, strike, premium, bid or ask. */
export const MAX_PRICE = 1_000_000;
/** Calendar days to expiry, and any horizon measured in them. */
export const MAX_DAYS = 3650;
/** Absolute contracts on one option leg. */
export const MAX_OPTION_CONTRACTS = 10_000;
/** Absolute shares on one underlying leg. */
export const MAX_UNDERLYING_SHARES = 1_000_000;
/** Observations in a supplied or generated spot path. */
export const MAX_PATH_POINTS = 366;
export const MAX_FINDER_EVALUATIONS = 2000;
export const MAX_CHAIN_QUOTES = 2000;
export const MAX_CHAIN_EXPIRATIONS = 128;
export const SYMBOL_PATTERN = /^[A-Za-z0-9.^_/-]{1,32}$/;

# Read-only Tradier options chains

Configure **Tradier (production, read-only chains)** or **Tradier Sandbox
(delayed chains)** in the existing account API Keys settings. Keys use the
existing per-user encrypted server storage and are never returned by chain
endpoints, copied to draft storage, or sent by the browser with chain requests.
Production and sandbox use distinct provider identifiers (`tradier` and
`tradier_sandbox`); neither falls back to another account, environment or shared
token. Migration `002_add_tradier_api_key_providers.sql` extends the existing
PostgreSQL enum; normal startup applies it transactionally. No new dependency,
environment variable, shared token, OAuth flow or subscription is required.

An account token issued by OpenQuant is required for every chain GET:

- `/options/chains/status` checks only whether this user's stored environment
  keys can be resolved. `available` means a configured read-only request can be
  attempted, **not** that Tradier credentials, data entitlement or freshness have
  been verified. This action does not contact Tradier.
- `/options/chains/expirations?symbol=AAPL&environment=sandbox` retrieves valid
  expiration dates, sorted ascending, at most 128.
- `/options/chains/chain?symbol=AAPL&expiration=2027-01-15&environment=sandbox`
  retrieves at most 2000 contracts, deterministically ordered by strike, kind and
  contract symbol. Input symbols use the frozen 1–32 character symbol grammar.
  Environment is required and expiration is an actual ISO calendar date.

Requests only call `GET /v1/markets/options/expirations` and
`GET /v1/markets/options/chains` on the fixed HTTPS hosts `api.tradier.com` or
`sandbox.tradier.com`. Expirations are requested with `includeAllRoots=true`
(Tradier marks it required), so weekly roots such as SPXW are listed. Redirects,
environment proxy credentials and cookies are disabled. There are no order/account/position/subscription/streaming endpoints,
no account attachment, historical replay, automatic polling, or broker execution.
Do not treat configuring a data token as connecting a brokerage account.

## Honest normalization and model limitations

- `bid_date` and `ask_date` are independently converted from documented epoch
  milliseconds to timezone-aware UTC ISO timestamps. Missing/invalid/future
  times, and times before 2000-01-01 (for example epoch seconds read as
  milliseconds), remain null. No unit guessing, trade-time substitution, or fetch-time
  substitution occurs. `fetched_at` only describes this retrieval. There is no
  assertion that production quotes are currently fresh or executable.
- Zero bid, IV, volume and open interest survive as zero. Missing, boolean,
  string, nonfinite, negative or out-of-bound numeric values remain null.
  Fractional counts/multipliers are unavailable, not rounded. Unknown multiplier
  is null, **not** 100. Invalid required identity/strike/expiry rows are omitted
  with a warning; mismatched underlying or expiration rows cannot be relabelled.
  Duplicate contract identities are omitted entirely, not arbitrarily merged.
  Adjusted contracts, whose `root_symbol` is the underlying plus digits (AAPL1),
  are omitted with a warning: their deliverable is not a standard 100 shares.
- One-sided, crossed and untimed quotes remain visible with warnings; this does
  not authorize midpoint application. Side times remain separate in provenance.
  The legacy manual quote fields still require paired sides and a real shared
  timestamp, so chain UI must not fabricate `quote_as_of`.
- IV uses only the supplied ORATS `greeks.mid_iv`, as an annual fraction; it is
  not recomputed, backfilled from a different IV field, or calibrated locally.
  Greeks/IV update independently of quotes, and IV freshness is not established.
  Sandbox data is normally 15-minute delayed and Greeks may be unavailable.
- The documented chain response does **not** establish exercise style or
  settlement. Both source classifications are `unknown`, including equities
  and indices; no ticker-based American/European or physical/cash inference is
  made. European USD cash-settled research is an explicit approximation and is
  **not** an executable equivalent for American or physical contracts. It models
  neither early assignment nor physical settlement obligations.
- Contract selection is a separate explicit UI proposal. Unknown premiums,
  multipliers or valuation anchors require user input; fetching cannot overwrite
  a draft or turn provider metadata into a fill claim.

## Resource and privacy bounds

No response/quote cache exists, so no cached data is shared across users or
environments. Successful HTTP responses are `Cache-Control: no-store, private`
and vary by Authorization. The process-local sliding limit is 30 requests per
account per environment per minute (and a separate status bucket). The limiter
holds at most 4096 active buckets and expires idle entries. Multiple server
workers multiply this application limit; Tradier also enforces its own per-token
limits, including other applications using the same token.

Each process admits eight active chain/status operations and four simultaneous
blocking encrypted-key lookups; slots fail fast instead of building a work queue.
Blocking key lookup retains its own slot until its thread really exits even if a
client has cancelled. Client disconnect and overall 15-second deadline cancel
the async provider task; HTTP has a 10-second total, 3-second connect and
5-second socket-read timeout. Response parsing stops at 4 MiB of **decoded**
content and at 10000 input records; oversized responses fail safely. Output caps
are explicit and truncated output is disclosed, not presented as a complete chain.
GET bodies, duplicate/undeclared query parameters, and queries over 1024 bytes
are rejected; the empty-body read has a one-second deadline. Provider errors,
raw bodies, request Authorization and credentials
are never included in adapter logs or HTTP errors. Public errors are fixed text
with appropriate retry/status hints; no retry loop multiplies provider traffic.

## Integration and evidence

Include `backend.routes.options_chain_routes.router` in the full application's
FastAPI app. No addition is needed to the manual options router or Python
sandbox. Chain components use the frozen `optionsResearchApi.ts` GET functions
and their AbortSignal/generation fencing; authentication remains in `apiJson`.
The fresh-schema assertions in `.github/workflows/backend.yml` must expect
migrations `[1, 2]` and two ledger rows (or discover the count dynamically).

The focused `backend/tests/test_options_chain*.py` suite uses invented data and
mock transport, plus the actual encrypted-key resolver with a fake database.
No real token is available, no live quote/entitlement/latency assertion is made,
and offline tests do not establish redistribution rights or commercial access.
PostgreSQL 16.14 migration checks covered a fresh schema, legacy-schema adoption,
an existing migration-001 ledger, idempotent reruns, preservation of an existing
API-key row and insertion of both new providers.

Official references reviewed for this adapter:

- https://docs.tradier.com/reference/brokerage-api-markets-get-options-chains
- https://docs.tradier.com/reference/brokerage-api-markets-get-options-expirations
- https://docs.tradier.com/docs/endpoints
- https://docs.tradier.com/docs/authentication
- https://docs.tradier.com/docs/quotes
- https://docs.tradier.com/docs/market-data
- https://docs.tradier.com/docs/rate-limiting

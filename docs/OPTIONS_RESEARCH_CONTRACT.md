# Options research wire and ownership contract v1

This is the shared foundation, **not a claim that the seven downstream units or
integrated workbench are implemented or verified**. Canonical validation is in
`backend/derivatives/models.py` and `research_models.py`; TypeScript mirrors are
`optionsTypes.ts` and `optionsResearchTypes.ts`. `optionsResearchApi.ts` is the
only research/chain browser transport. Wire fields are snake_case. All model
numbers are strict, finite, signed where appropriate; extra fields are rejected.
Missing/null is unavailable/default, never zero. USD totals, USD/unit premiums,
signed contracts, units/contract multipliers, signed underlying shares, annual
IV/rate/drift/yield fractions, IV shifts in percentage points and ACT/365 remain
the existing conventions. No financial pricing runs in the frontend.

## Ownership and handoffs

Only the foundation agent creates the normal shared PR; all agents use remote
git handoffs. Downstream work starts from the reported foundation commit and
must not replace these contracts without coordinating with integration.

| Owner | Files/responsibility |
| --- | --- |
| Foundation | Existing derivatives `models.py`, `analytics.py`, `runner.py`, `__init__.py`; new `research_models.py`; frontend core types, validation, persistence, Python export/help, leg editor and scenario helpers; shared research types/API; foundation tests and this document |
| Payoff editing | New controlled interactive-payoff component/helpers/tests; no edits to shared core or OptionsCharts/OptionsPanel |
| Volatility skew | New controlled skew component/helpers/tests; no frontend pricing approximations |
| Event stress | New controlled stress presets component/helpers/tests; presets are hypothetical assumptions, not event forecasts |
| Finder | `backend/derivatives/finder.py`, finder component/helpers/tests; pure `find_strategies` entrypoint |
| Lifecycle/hedge | `backend/derivatives/lifecycle.py`, `hedge.py`, lifecycle/hedge components/helpers/tests; pure `evaluate_lifecycle`, `simulate_hedge` |
| Probability/tail risk | `backend/derivatives/distribution.py`, distribution component/helpers/tests; pure `analyze_distribution` |
| Provider chain | Chain adapter/route implementation, encrypted-key provider enum/migration/settings registration for `tradier` and `tradier_sandbox`, chain component/helpers/tests |
| Parent/integration | Register research routes, wire OptionsPanel/OptionsCharts and expiry authoring, submitted exports/readouts, integration tests/full suites/build and approved browser validation |

New UI filenames should be reserved by each downstream prompt; the table reserves
responsibility, not permission to edit another owner's existing files. Foundation
does not create research implementation stubs, change auth/security/AST policies,
or edit OptionsPanel/OptionsCharts. Existing sandbox restrictions remain intact.

## Canonical expiry semantics

`OptionLeg.days_to_expiry?: number|null` and `expiry_date?: YYYY-MM-DD|null`
are optional. Omitted/null overrides inherit `strategy.days_to_expiry` (legacy
default 30). A leg date alone resolves its days against `strategy.valuation_date`;
if both leg days and date are present they must agree exactly. All horizons are
0–3650 calendar days; fractional day-only horizons are supported. A common
`strategy.expiry_date` still requires the valuation date and exact agreement
with default strategy days. A valuation date without a common date is permitted
only with a leg date. Disabled legs are validated too. Underlying legs cannot
carry expiry overrides or option source metadata. Calendar/diagonal template
labels are descriptive only, never alternate pricing formulas.

Every current/scenario leg mark and Greek uses its own remaining time. Ordinary
`/options/analyze`, `/options/python`, scenarios and elapsed-time surfaces stop
at `first_expiry_days` among enabled options (stock-only uses default days).
No past expiry intrinsic is invented from a later spot. At that horizon front
legs are `expiry_intrinsic`, later options `model_mark`, shares `underlying` and
disabled legs `disabled`. Scenario `legs` include that state, remaining time,
signed value/P&L and Greeks at the submitted current spot.

Returned `horizon` contains `kind`, `first_expiry_days`, `last_expiry_days`,
`elapsed_days` (first expiry), `exact_terminal_available`, and indexed `legs`.
`horizon_pnl` is a **sampled first-expiry mark** aligned with `spot_grid`; it is
not an exact piecewise-linear terminal curve in a mixed-expiry strategy.
For mixed expiries: `expiry_curve=[]`, `expiry_pnl=[]`, `max_profit=max_loss=null`,
`profit_unbounded=loss_unbounded=null`, `breakevens=[]`, `zero_intervals=[]`.
Null unbounded flags mean unknown/not applicable, **not** unbounded risk or safe
risk. The UI must use submitted `horizon.exact_terminal_available` to disable old
terminal readouts, charts, exports and editing overlays. Never fall back to a
linear sampled terminal curve for mixed expiries. Exact single-expiry vertices,
roots, zero intervals, extrema and Greek null propagation are unchanged.

Optional leg `source` is a bounded `OptionsContractSource`: Tradier/environment,
contract symbol, underlying, fetch timestamp, independent nullable bid/ask quote
timestamps, and observed exercise/delivery classifications. This metadata never
changes entry premiums, model exercise style or settlement. An American/physical
listed contract remains a **European cash-settled research approximation** here.
No automatic American valuation or assignment claim is permitted.

## HTTP and execution boundaries

Research POSTs below are provider-free/guest-accessible and do not save artifacts.
They use the same inherited bounded worker/time/concurrency controls as options
analysis; integration must bound request bytes (128 KiB), output bytes (1 MiB),
wall time (5 seconds) and cancellation/replacement generations. Oversized output
is an explicit error, not silently truncated evidence. Typed list/cell caps below
apply before expensive computation. Any child process semaphore must release
on timeout/error. Browser abort prevents publishing results; it does not promise
server process cancellation. HTTP errors: 422 validation, 400 unsupported/invalid
research assumptions, 408 timeout, 413 oversize, 429 rate limit, 503 saturation.
Never relax sandbox/AST guards or security policies to pass these features.

Trusted pure entrypoints accept their request model or a dict, revalidate before
computation and return the named Pydantic response. They have no network, database,
filesystem, provider key, import injection or execution callback. They are not new
untrusted-Python sandbox helpers. Implementations import canonical BSM/payoff
helpers from `analytics.py`; do not copy pricing formulas into JS or other modules.

### POST /options/research/finder

`find_strategies(FinderRequest|dict) -> FinderResponse` in `finder.py`.
Request: `analysis` (canonical context including explicit premiums/fees), `universe`
(1–24 enabled quantity=+1 option legs, no underlying), `thesis` bullish/bearish/neutral,
`constraints` with required nonnegative `max_entry_debit`, `max_loss` (≤1e12 USD),
`max_total_contracts` (1–100, default 10) and `max_legs` (1–4, default 4), strictly
increasing `scenario_spots` (1–9), `scoring="mean_scenario_pnl_v1"`, `limit` (1–20,
default 10), `max_evaluations` (1–2000, default 2000).

Enumerate deterministic finite unit-size candidate combinations (long/short single
calls/puts, same-expiry verticals, straddles/strangles, iron condors); never imply
the universe/search is exhaustive or optimally sized. Candidate leg count/absolute
contracts, canonical debit and exact finite max loss must satisfy constraints.
Reject unknown/mixed/unbounded max loss, not coerce it to zero. Filter thesis by
canonical current delta sign (>0 bullish, <0 bearish, either for neutral); neutral
means no directional filter, not guaranteed delta-neutral. Score is arithmetic
mean of canonical **common-expiry P&L** at explicit scenario spots; no subjective
probability or expected-return claim. Tie break lower max loss, lower entry debit,
then stable canonical leg signature. Count every evaluated candidate before
constraint filtering. Duplicated contracts/combinations must not duplicate output.

Response echoes request/provenance/scoring, ≤20 candidates with stable id/rank/score,
canonical candidate `request`, `summary`, ≤9 `{spot,elapsed_days,pnl}` evidence,
`searched_count`, `eligible_count`, `search_truncated`, warnings. Empty is a valid
no-match result, not an error. Applying a candidate is an explicit parent edit,
never automatic mutation when search finishes.

### Shared path

`ResearchPath` is discriminated by `source`. `supplied` has 1–366 `{day,spot}`
points, starting day 0 at `analysis.spot`, strictly increasing days, spots 0–1e6.
`synthetic` has `seed` uint32 (default 1), `horizon_days` >0–3650, `steps` 1–365
(default 30), `annual_drift` −1–1 (default 0), `annual_volatility` 0–5 (default .2),
`generator="gbm_seeded_v1"`. The owner documents a deterministic seeded generator;
no claim of historical calibration or reproducibility across generator versions.
Synthetic generation starts at submitted spot. Overflow/out-of-domain paths are
explicit validation errors; do not clip spots or silently change drift/volatility.
Paths must cover every active option expiry. Zero-day expiry settles at day zero.

### POST /options/research/lifecycle

`evaluate_lifecycle(LifecycleRequest|dict) -> LifecycleResponse` in `lifecycle.py`.
Request: `{analysis,path}`. Insert every active option expiry in the path. For an
expiry between supplied/generated observations, linearly interpolate **spot**,
record `left_day`, `right_day` and `observation="linear_interpolation"`; exact
observations are labelled `supplied` or `synthetic`. This is an explicit hypothetical
settlement assumption, not observed history. No expiry is silently skipped.

Settle each option once: quantity × multiplier × canonical intrinsic is the
signed cash flow; no physical shares appear. After expiry, option mark/Greeks
are zero (state `settled`), never repriced at later spot. Shares remain shares.
Each ≤382 ledger point returns day/spot, step settlement cash flow, cumulative
settlement cash, remaining signed model/share value, total P&L, and ≤16 indexed
leg marks with state/remaining_days/value/Greeks. Total P&L = cumulative settlements
+ remaining value − canonical fixed net entry cost. ≤16 settlement records include
intrinsic/unit and signed flow. Response echoes request/provenance, evaluated
path, settlements, ledger, net_entry_cost, final_pnl, warnings. No financing,
dividend cash flows, assignment, reinvestment or fee duplication.

### POST /options/research/hedge

`simulate_hedge(HedgeRequest|dict) -> HedgeResponse` in `hedge.py`. Request extends
lifecycle with `policy` (mode none/daily/interval/delta_threshold; default daily,
`interval_days` >0–3650 default 1, `delta_threshold` >0–1e6 equivalent shares
default 10, `max_abs_shares` >0–1e7 default 1e6) and `costs` (`per_share` 0–1000,
`fixed_per_trade` 0–10000, `slippage_bps` 0–1000; all default zero).

Rebalance using **only current/past** available marks. Target hedge shares negate
whole-strategy delta including existing underlying legs; hedge shares are an
additional independent ledger, never a second copy of strategy stock. Initial
rebalance is allowed; transaction costs apply to entry, every nonzero trade and
final liquidation. `none` opens no hedge. Daily/interval policies are evaluated
at original path observations when a calendar-day/interval boundary has elapsed;
do not invent trades using future interpolation observations. Disclose sparse
observation-constrained schedules; a sparse path is not a continuous daily hedge.
Threshold compares residual strategy delta + current hedge shares. Undefined
active delta means skip/reported `undefined_delta`, not assumed zero; share cap
skips with `share_limit`, not a hidden clipped strategy. At final path point
liquidate all hedge shares, including costs, with no subsequent rebalance.

Each ≤382 hedge ledger point has day/spot, strategy_delta, hedge_shares,
traded_shares, trade_cash_flow (−trade × spot, excluding costs), transaction_cost,
hedge_cash (trade flows minus costs), hedge_value (shares × spot), unhedged_pnl,
hedged_pnl, action. Hedged P&L = lifecycle P&L + hedge cash + hedge value. Response
includes canonical lifecycle, final hedged/unhedged comparison and attribution:
strategy_pnl + hedge_trading_pnl − transaction_costs = total_pnl; financing and
dividends explicitly zero. No return on idle cash, borrowing debit, hidden
reinvestment or lookahead. This is a discrete hypothetical path, not replication
accuracy or historical execution evidence.

### POST /options/research/distribution

`analyze_distribution(DistributionRequest|dict) -> DistributionResponse` in
`distribution.py`. Request `analysis`, explicit `measure` risk_neutral/user_drift,
`annual_drift` required only for user_drift (−1–1); `confidence` (.5,1), default .95;
`bins` 10–100 default 40; `integration_points` 256–16384 default 4096;
`tail_probability` 1e−9–.01 default 1e−6. Reject mixed active expiries explicitly.
Risk-neutral drift = rate − continuous yield; reject resolved drifts outside the
bounded response range, rather than silently clipping. Terminal spot lognormal
uses **declared analysis.volatility**, not an arbitrary leg IV. All leg IVs still
affect initial model marks; fixed entry premiums/fees determine terminal P&L.
Risk-neutral probabilities are model-implied, not real-world forecasts.

Return normalized P&L bins summing to 1, strict probability(P&L>0), expected P&L,
≤9 sorted `{probability,pnl}` quantiles (include lower-tail 1−confidence), confidence,
`value_at_risk=max(0,-lower_tail_quantile)` and
`expected_shortfall=max(0,-lower_tail_mean_pnl)` in USD. Discrete atom tail means
must allocate fractional atom mass at the confidence boundary. Zero IV/time gives
one deterministic unit-probability bin and exact P&L/quantiles/tails. Return resolved
drift, horizon, terminal_log_sigma, deterministic flag, integration method
`deterministic` or `normal_midpoint_quadrature_v1`, actual integration_points,
truncated_probability, normalization_mass, nullable numerical_error_estimate and
warnings. Nonzero-time integration uses a bounded symmetric normal-domain midpoint
quadrature and discloses truncation/renormalization; numerical estimates are not
confidence guarantees. Null error estimate is unknown, not exact zero. No historical
probability, risk-free-return or guaranteed-loss claim.

### Authenticated read-only chain GETs

All require token-derived account authentication and that user's encrypted key.
Never attach guest records to an account or cache across account/environment.
`production` uses provider identifier `tradier`; `sandbox` uses `tradier_sandbox`.
Use existing encrypted API-key storage; provider owner registers both identifiers.
Read official Tradier documentation before provider calls. No order/brokerage,
subscription, account attachment or historical chain endpoint is in scope.

- `/options/chains/status`: `ChainStatusResponse.environments`, two records with
  provider/environment/configured/available/sanitized message; no token validation
  details or secret. Available is not market-data entitlement or freshness proof.
- `/options/chains/expirations?symbol=&environment=`:
  `ChainExpirationsResponse` provider/environment/symbol/fetched_at, ≤128 sorted
  valid expiration dates, truncated, warnings.
- `/options/chains/chain?symbol=&expiration=&environment=`:
  `ChainResponse` provider/environment/symbol/expiration/fetched_at, ≤2000 quotes,
  truncated, warnings. Symbols match `[A-Za-z0-9.^_/-]{1,32}`. Environment is required.

Each `ChainQuote` includes contract_symbol, underlying, kind call/put, positive
strike, expiration, nullable multiplier, nullable bid/ask, **separate nullable
bid_as_of/ask_as_of**, nullable IV fraction, nullable volume/open_interest, and
bounded source. Source has fetch time and independently observed classification
american/european/unknown and cash/physical/unknown. Unknown multiplier is not 100,
missing quote is not zero; crossed/one-sided quotes remain visibly unusable for
midpoint application. Fetch time must **never** be substituted for quote time.
Do not infer exercise/delivery classification from provider defaults or symbol.
Truncation is deterministic and disclosed. Every timestamp is timezone-aware ISO.
No raw provider bodies, credentials, request Authorization or provider errors are
logged/returned. External errors are sanitized with a retryable public message;
use explicit timeouts, bounded parsing, account-scoped rate limits and cache scope.

Chain selection only proposes explicit draft changes through onEdit. Selecting
a contract cannot silently apply midpoint, IV or a fabricated expiry anchor.
Require explicit premium/multiplier/valuation date if unknown. Source provenance
may be retained without copying incomplete quotes into legacy manual bid/ask fields
(those still require paired sides and a real shared quote timestamp). Side times
belong in source, never a synthesized manual quote_as_of. Keep unsupported model
classification visible before confirming research approximation.

## Exact controlled component contracts

Every new authoring component (payoff edit, skew, stress presets, finder, chain,
lifecycle/hedge, distribution) accepts `OptionsAuthoringToolProps`:

```ts
{ draft: OptionsDraft;
  onEdit: (update: (draft: OptionsDraft) => void) => void;
  readOnly?: boolean; }
```

Research/chain components additionally accept required `documentKey: string`
(`OptionsResearchToolProps`). Payoff editing may additionally accept
`analysis?: OptionsAnalysis|null` to render submitted exact vertices; it must not
price locally or draw a false exact mixed-expiry curve. All controls derive
current authoring state from draft. Proposed mutations are callbacks to parent
onEdit for undo/history, validation, staleness, account-scoped recovery and named
draft persistence. Do not mutate props or a Python source buffer. readOnly disables
**every** mutation action/gesture and explains why; it does not convert Python
source to an editable visual draft. Parent alone switches source modes explicitly.

Use the named typed API calls with AbortSignal. Keep local submitted snapshots
(structured clone request before await), separate from live drafts. On submit,
cancel prior flight and increment generation. On replacement, documentKey/account
change or unmount cancel and fence both success/error/finally. A completed result
is labelled with returned submitted context; draft/settings changes mark it stale.
No auto-submission on drag, slider, typing, component mount or account transition.
Provide explicit Submit/Apply/Cancel and field-specific error paths; preserve
previous result while refreshing and distinguish empty, initial, pending, stale,
cancelled and failed states. Results remain session-local, not falsely persisted
or cloud-saved. Recovered drafts never execute source or research automatically.

Native compact Svelte 5 controls, associated labels/units and keyboard equivalents
for all gestures are mandatory. Do not rely on hover, color or a tooltip for values.
Keep focus visible in forced colors, light/dark themes, 360px/short-height and 200%
zoom reflow. Tables/plots may use labelled keyboard-scrollable bounded regions;
core controls/actions must remain reachable. Parent handles browser validation.

## Foundation validation and integration gates

Foundation PR is opened **before** local tests as requested; body must state tools,
integration and verification are still in progress. Then focused finance/unit/API
and core TS tests, pre-commit, lint/type checks run and corrections are pushed.
Integration owns full backend/frontend suites/build, mixed-expiry chart/export
readout gating, lifecycle/hedge/distribution/finder invariants, account/environment
isolation and approved recorded UI testing. Do not claim the entire expansion done
based only on this foundation or passing pure tests.

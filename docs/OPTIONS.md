# Manual European options research

OpenQuant's `backend.derivatives` module analyzes an explicit multi-leg position
from manual inputs. It returns theoretical Black–Scholes–Merton (BSM) marks,
exact expiry P&L geometry, signed strategy/per-leg Greeks, time/IV scenarios and
bounded P&L surfaces. It does not fetch an options chain, execute a trade or replay
historical options prices.
No account, provider key, network request or new dependency is required for the
direct Python analysis shown here.

### Multi-expiry extension

Options may override `days_to_expiry` and/or `expiry_date` per leg, with dates
anchored to `strategy.valuation_date`. Missing overrides inherit the strategy
default; paired days/dates must agree exactly. Calendar/diagonal labels are
supported. Every leg's current and scenario mark/Greeks uses its own time horizon.
Ordinary scenarios/surfaces cannot cross the first active option expiry.

The exact terminal geometry descriptions below apply **only to common expiry**.
Mixed expiries return `horizon.exact_terminal_available=false`, sampled
`horizon_pnl` at the first expiry, empty `expiry_curve`/`expiry_pnl` and empty
breakevens/zero intervals. Maximum profit/loss and unbounded flags are null
(unavailable, not zero or infinite). At the first expiry front options use intrinsic
while later options remain model marks. Through-expiry settlement requires explicit
lifecycle paths, not a later common-spot scenario. See
[the frozen research/API and ownership contract](OPTIONS_RESEARCH_CONTRACT.md)
for the downstream finder, lifecycle, hedge, probability and read-only chain tools.

## Supported scope and provenance

- European, cash-settled, USD calls and puts with default/per-leg expiry, plus explicit
  underlying share hedges. All prices and P&L amounts are USD.
- Constant annual IV per option leg (falling back to the declared request IV),
  continuously compounded rate and continuous dividend yield;
  calendar time is ACT/365. These are manual assumptions, not calibrated forecasts.
- Today and scenario curves are theoretical valuations; expiry curves are exact
  terminal intrinsic cash flows minus fixed entry cost. A scenario is not a
  historical observation or a forecast probability.
- The returned model provenance is `black_scholes_merton`, version `1`,
  `input_source: "manual"`, `exercise_style: "european"`, `settlement: "cash"`,
  `day_basis: "ACT/365"`. Synthetic/example inputs are illustrations, not provider
  snapshots, market quotes, executable opportunities or historical evidence.
- No American exercise valuation, early exercise/assignment, physical delivery,
  margin/liquidation, futures execution, brokerage connection, order routing or
  historical options execution is implemented by this module.
- P&L excludes financing, cash dividends received on share hedges, exit fees and
  slippage. Continuous yield affects option marks; it does not create a cash
  dividend ledger. A manually entered credit is not an assertion that the trade
  could have been filled.

## Direct Python API

Run trusted Python from the repository root with the existing environment:

```python
from backend.derivatives import (
    OptionLeg,
    OptionStrategy,
    OptionsAnalysis,
    OptionsAnalysisRequest,
    OptionsScenario,
    analyze_options,
)

request = OptionsAnalysisRequest(
    strategy=OptionStrategy(
        name="Manual iron condor",
        template="iron_condor",
        days_to_expiry=30,
        entry_fee_per_contract=0,
        legs=[
            OptionLeg(kind="put", quantity=1, strike=80, entry_premium=1),
            OptionLeg(kind="put", quantity=-1, strike=90, entry_premium=3),
            OptionLeg(kind="call", quantity=-1, strike=110, entry_premium=3),
            OptionLeg(kind="call", quantity=1, strike=120, entry_premium=1),
        ],
    ),
    spot=100,
    volatility=0.20,
    rate=0.03,
    dividend_yield=0,
    spot_grid=[0, 80, 86, 90, 100, 110, 114, 120, 200],
    scenarios=[OptionsScenario(name="10 days +5 IV pp", elapsed_days=10, iv_shift_pp=5)],
)

result = analyze_options(request)  # A plain request dict is accepted too.
assert result.summary.entry_credit == 400
assert result.summary.max_profit == 400
assert result.summary.max_loss == 600
assert result.summary.breakevens == [86, 114]
assert result.scenarios[0].remaining_days == 20
assert result.scenarios[0].volatility == 0.25

payload = result.model_dump(mode="json")
encoded = result.model_dump_json()
restored = OptionsAnalysis.model_validate_json(encoded)
input_schema = OptionsAnalysisRequest.model_json_schema()
output_schema = OptionsAnalysis.model_json_schema()
```

`analyze_options(dict_or_model) -> OptionsAnalysis` validates even previously
constructed or subsequently mutated request models. Invalid inputs raise
`pydantic.ValidationError`. Wire names are snake_case, without aliases; all
resolved defaults are echoed in `result.request`. The module neither saves a run
nor creates a research archive. This document specifies the direct Python/model
API. The native workbench and bounded HTTP worker use that same contract.

## Workbench and HTTP API

Open **Strategy → Options**, choose **Open Options workbench** in the command
palette, or use **Options on <symbol>** under the chart's current symbol. Templates are editable configurations, not special payoff formulas.
The visual draft re-analyzes 300 ms after edits settle, once its inputs are valid;
template chips apply at once and Undo restores the previous legs. Python source
never runs by itself: use Run or Ctrl/⌘+Enter, or explicitly export the editor
draft to the panel's Python mode.
The price-domain charts show exact common-expiry P&L, theoretical today/scenario P&L,
and selectable today-model Greek curves with keyboard and exact-value readouts.
The result retains its submitted inputs; editing the draft marks it stale.
The display grid follows the strategy: it spans the enabled strikes, spot and
expiration breakevens with padding (35% of their span, at least 6% of spot) and
refits when spot or the leg layout changes, until a grid is entered by hand.
**Fit** returns to the fitted grid; the chart names a spot or strike it cannot show.

Spot and the underlying name follow the chart's loaded symbol: a new symbol moves
spot to its last close (rounded to cents), while price updates on the same symbol
only offer **Update to …**. Typing a spot, or restoring or importing a draft, stops
following; **Use <symbol>** or **Options on <symbol>** resumes it. Only a template
whose legs are untouched re-centers on the new spot; edited legs keep their
strikes, premiums and overrides. A hidden Options panel never analyzes by itself. New workbench drafts are valued today with one expiry date and a days
readout; days-only drafts still load and can switch to dates. IV, rate and yield
are entered as percentages and sent as annual fractions.

The editor exposes underlying identity, common valuation/expiry defaults, per-leg
expiry/IV overrides and manual bid/ask timestamps. Quotes are unverified and never
replace entry premiums unless explicitly applying a valid midpoint. Template and added
legs start at the model price, read from the per-leg theoretical value of an
ordinary `/options/analyze` request, and are repriced the same way, before
analysis, whenever their contract or the assumptions change. A typed premium, an
applied midpoint or an imported contract is manual and never changes by itself;
**Use model price** returns a leg to the model. These tags live only in the
browser and are never sent. Legs are a
compact table with one header row: a Buy/Sell toggle coloured by side, size,
type, strike and premium, and a row menu for reordering, duplicating, disabling
and removing. Multiplier, IV override and manual quotes open per row. Narrow
panels show each leg as a two-line card. Buy/Sell, duplicate/reorder and bounded
undo/redo operate on signed canonical inputs. Submitted risk totals remain separate from
current edits. Common-expiry paths use exact backend vertices, not sparse sampled lines.
Mixed-expiry first-expiry curves are backend model-marked samples for remaining
legs, not terminal risk limits: maxima, breakevens, zero intervals and exact
terminal vertices are unavailable. This distinction also appears in comparisons,
risk readouts, CSV context and reproducibility reports.

### Eight interactive research tools

The payoff chart provides drag-to-edit strikes with per-leg selection, numeric and
keyboard alternatives and snapping. While a handle moves, and until the edited
draft is analyzed, the chart draws the draft's expiration payoff live (exact
intrinsic arithmetic, single expiry only) and shows the submitted curves faintly;
today and scenario curves are never priced in the browser. Releasing applies one
edit through the parent's undo/history; the draft then re-analyzes and
model-priced premiums follow the new strike.

Research tools are tabs under the payoff chart, starting with the scenario lab
(Scenarios, Skew, Stress, Probability, Lifecycle, Hedging, Find a trade, Live
chain). One tool is mounted at a time, and each names the analysis it reads:

| Tool | Explicit action and scope |
| --- | --- |
| Volatility skew | Per-expiry/right IV points and parallel/twist/curvature transforms; compare declared flat IV against canonical skew marks before applying. Premiums are not rewritten. |
| Hypothetical event stress | Editable event presets and bounded spot/time/IV shocks; compare signed P&L/Greek changes at submitted spots. These are assumptions, not event forecasts. |
| Constrained strategy finder | Search a finite user-authored contract universe and explicit scenario spots under debit/loss/quantity limits, then apply a selected candidate. Score is arithmetic mean scenario P&L, not probability-weighted expected return. Neutral means **no directional delta filter**, not delta neutrality. |
| Read-only provider chain | Signed-in users explicitly fetch configured Tradier production/sandbox expirations and chain observations. Select contracts and confirm hypothetical conversion; no executable order or account attachment. |
| Multi-expiry lifecycle | Per-leg expiry authoring and explicit-premium calendar/diagonal presets; evaluate a bounded supplied or seeded synthetic spot path. Show expiry settlements, remaining marks and cash separately; scrub/playback navigates returned observations without repricing. |
| Delta-hedging path | Compare one declared none/daily/interval/delta-threshold policy against unhedged on the same hypothetical path, including share/cash actions, costs and returned attribution. Not a live hedge or historical backtest. |
| Probability & tail risk | Explicit risk-neutral or user-drift lognormal assumptions; returned terminal-price probability mass and exact payoff vertices, positive-P&L probability, quantiles, VaR and expected shortfall. Mixed-expiry terminal distributions are rejected. |

All pricing, paths, rankings and distributions come from canonical backend
calculations; charts only present returned data. Zero and unavailable remain
distinct. Research evidence is session-local, not saved account research. Tools
require explicit submissions and expose pending/cancel/error/stale evidence states.
Account/guest, auth-session, loaded-document and source-mode changes remount/fence
private tool state. Query changes cancel pending research; late replies cannot
publish after scope changes or unmount. Python mode exposes only the successfully
submitted request read-only, and hides tools when source diverges; it never runs
tools against the unrelated visual draft.

Provider status means configured requests may be attempted, not verified freshness,
entitlement or redistribution rights. Independent side quote times, null bid/ask/IV,
source and environment are preserved; fetch time is not quote time. Tokens stay in
server-side encrypted key storage, never drafts or exported observations. Import
requires explicit acknowledgement that real US American exercise and physical
delivery are not modeled by the hypothetical European cash-settled contract. See
[provider setup and limits](OPTIONS_CHAIN_PROVIDER.md).

Research POST endpoints `/options/research/{finder,lifecycle,hedge,distribution}`
are guest-accessible with the shared worker/rate/input budget and five-second
worker deadline; their response envelope is capped at 1 MiB. The largest combined
leg/path shapes may return an actionable 413 rather than truncate or round
financial data. Reduce observations/legs and retry. Authenticated bounded GET
routes are `/options/chains/{status,expirations,chain}`. Neither API is injected
into untrusted Python. Legacy analysis/Python bounds below remain unchanged.

Distribution statistics are conditional on the disclosed retained normal window.
Omitted-tail mass and absolute-P&L/expected-P&L truncation bounds are reported;
half-resolution expected-P&L sensitivity is not a rigorous probability, quantile,
VaR or expected-shortfall error guarantee. No brokerage execution, subscriptions,
live account attachment, historical options replay or American assignment model.

The scenario lab provides explicit time/IV sliders and bounded spot/time or
spot/IV heatmaps. Apply configures the draft, which then re-analyzes. Python-mode
heatmaps render submitted cells read-only, without submitting editor assumptions.
Per-leg monetary/Greek tables and session-only pins (up to three) expose signed
contributions and comparison contexts. Different assumptions are not presented
as directly comparable performance. CodeMirror supports sandbox helper
completions, scoped run shortcuts and bounded stdout; custom source is replaced
only by the confirmed editor-export action.

Each guest/account browser scope has separate working recovery and up to ten
named drafts. Recovery autosaves after 500 ms and restores explicitly, without
running Python. Named updates/renames retain three prior revisions. Versioned
JSON bundles support validated manual import/export; submitted CSV and JSON
reports retain canonical context and source/stdout where present. These are
private local files, not encrypted, cloud-synced or included in server backups.

- `POST /options/analyze`: send `OptionsAnalysisRequest` as JSON; receive
  `OptionsAnalysis` directly, including `greeks_grid` aligned with `spot_grid`.
- `POST /options/python`: send only `{ "source": "..." }`; receive the same
  analysis, with optional `stdout`. The source assigns
  `result = analyze_options(request_dictionary)`. Injected `OptionLeg(**kwargs)`
  and `OptionStrategy(**kwargs)` validate and return dictionaries. The injected
  `analyze_options` returns a dictionary, unlike the trusted module's model.
  No imports of `backend.derivatives` or unrestricted modules are allowed. Keep
  `result` unmodified: the worker validates its finite JSON, vertices, leg
  identities/resolved IVs and surface dimensions, then compares it to canonical
  Python analysis. User-authored source runs in a spawned worker, not the server
  process. Scenarios and surfaces use dictionaries in this injected namespace.

For example, in the panel's Python mode:

```python
strategy = OptionStrategy(
    name="Long call", days_to_expiry=30,
    legs=[OptionLeg(kind="call", quantity=1, strike=100, entry_premium=5)],
)
result = analyze_options({
    "strategy": strategy, "spot": 100, "volatility": 0.2,
    "spot_grid": [80, 90, 100, 110, 120],
})
```

Both endpoints are guest-accessible, provider-free, rate-limited, and spawn a
worker with a five-second timeout and at most two concurrent workers per server
process. Bodies are bounded to 128 KiB; Python source to 20,000 characters,
combined printed output to 16 KiB, and worker JSON to 256 KiB. Invalid source or
result returns 400, malformed inputs 422, timeout 408, oversized bodies 413,
rate limits 429 and saturated workers 503. Browser cancellation does not
terminate the server computation; the server timeout still applies.

The inherited AST/resource/socket controls are **best effort, not a strong
security boundary**. The existing resource helper does not enforce memory in
the process; deployment isolation and container/cgroup memory limits remain
necessary for untrusted source. This feature is not hosted multi-tenant approval.

### Input contract and limits

All models forbid extra fields and nonfinite numbers; numeric strings and boolean
stand-ins for numbers are rejected. Quantities/multipliers are strict integers.
Disabled legs are still validated.

| Field | Meaning / bounds / default |
| --- | --- |
| `strategy.name` | Nonblank, at most 120 characters; default `"Custom options"` |
| `strategy.template` | Informational label; default `"custom"` |
| `strategy.days_to_expiry` | 0–3650 calendar days, fractional days allowed; default 30 |
| `strategy.underlying` | Optional manual identity label, nonblank and at most 80 characters; default `null`, no instrument lookup or provider verification |
| `strategy.valuation_date`, `strategy.expiry_date` | Optional paired valid calendar dates, exact `YYYY-MM-DD`; default `null`. Nonnegative date difference must equal the explicitly submitted/defaulted `days_to_expiry` |
| `strategy.currency`, `strategy.exercise_style`, `strategy.settlement` | Only `"USD"`, `"european"`, `"cash"`, respectively; these are also the defaults |
| `strategy.entry_fee_per_contract` | 0–10000 USD per enabled option contract, once at entry; default 0 |
| `strategy.legs` | 1–16 legs, at least one enabled |
| `leg.kind` | `"call"`, `"put"` or `"underlying"` |
| `leg.quantity` | Nonzero signed integer; options up to ±10000 contracts, stock up to ±1000000 shares; positive long, negative short |
| `leg.strike` | Options require a positive strike up to 1000000 USD; underlying requires `null` (default) |
| `leg.entry_premium` | 0–1000000 USD per underlying unit; stock entry price for an underlying leg; default 0 |
| `leg.multiplier` | 1–1000 units per option contract, default 100; an underlying leg requires explicit 1 |
| `leg.enabled` | Boolean, default `true`; disabled legs have no cost, mark, Greek or geometry contribution |
| `leg.implied_volatility` | Optional option IV fraction, 0–5; default `null` resolves to request `volatility`. Underlying legs require `null` |
| `leg.bid`, `leg.ask` | Optional paired manual USD/unit quote values, 0–1000000 and `bid <= ask`; both default `null`. A supplied pair requires `quote_as_of`; underlying legs forbid both |
| `leg.quote_as_of` | Optional manual timezone-aware ISO timestamp, at most 64 characters; default `null`. Timestamp-only metadata is accepted. Underlying legs forbid it |
| `spot` | Current positive USD spot up to 1000000; required |
| `volatility` | Annual fraction, 0–5; default 0.20 means 20% IV |
| `rate` | Annual continuously compounded fraction, −1 to 1; default 0.03 |
| `dividend_yield` | Annual continuous fraction, −1 to 1; default 0 |
| `spot_grid` | Required 2–201 strictly increasing USD spots, each 0–1000000; zero is allowed in the grid, not as current `spot` |
| `scenarios` | 0–3 uniquely named scenarios; default empty list |
| `scenario.name` | Nonblank, at most 80 characters; required |
| `scenario.elapsed_days` | 0 through expiry inclusive; default 0 |
| `scenario.iv_shift_pp` | Additive −100 to +100 IV percentage points; shifted declared request IV and every resolved enabled option IV must remain 0–5; default 0 |
| `surface` | Optional `null` (default) or `{axis, spots, steps}`; result always includes a nullable `surface` |
| `surface.axis` | Only `"elapsed_days"` or `"iv_shift_pp"` |
| `surface.spots` | 2–41 strictly increasing finite USD spots, each 0–1000000; independent of the 2–201-point curve grid |
| `surface.steps` | 2–21 strictly increasing finite numbers: elapsed calendar days from 0 through common expiry, or additive −100 to +100 IV pp subject to all shifted IV bounds |

`iv_shift_pp=5` means 20% IV becomes 25%, not a 5% relative increase and not
an IV fraction of 5. Remaining days are `days_to_expiry - elapsed_days`.
Scenarios never advance beyond expiry, change entry premiums or charge fees again.
They shift each enabled option's resolved IV in parallel, preserving differences
between explicit IVs rather than replacing them with an average. The output
scenario `volatility` is the shifted **declared request IV**, even when all legs
have explicit IVs. Disabled leg IVs are still validated as inputs but do not limit
a scenario/surface shift; the declared request IV always does.

Dates are optional common-contract metadata, not per-leg expiries. Interpret
them as calendar dates (UTC calendar convention in editor integrations), not
local timestamps. The backend does not infer days from dates, consult a current
clock or certify freshness: a 30-day date pair with omitted `days_to_expiry` uses
the existing default 30, while a 31-day pair requires explicit 31. Dates do not
support mixed expiries; fractional horizons remain available without dates.

`quote_as_of` requires a `T`, hours/minutes, optional seconds/fractional seconds,
and `Z` or an explicit `+/-HH:MM` offset, e.g. `2024-02-28T14:15:16.125Z`.
Invalid calendar dates/times, missing offsets, unpaired bid/ask, crossed quotes,
nonfinite values and out-of-range IVs are rejected, including on disabled legs.
Quote timestamps are echoed as entered, not normalized to UTC or checked against
valuation dates. Old or future timestamp metadata is not proof of usable data.
**Manual quotes never alter `entry_premium`**: a midpoint/premium choice must be
an explicit input edit, not automatic repricing. There is no live chain fetch,
provider verification, quote freshness assessment or executable fill guarantee.

Supported template labels are `custom`, `long_call`, `long_put`, `call_vertical`,
`put_vertical`, `straddle`, `strangle`, `iron_condor`, `iron_butterfly`,
`covered_call`, `protective_put`. **Explicit legs control the math.** A label does
not enforce geometry or certify hedge coverage/safety. A conventional covered
call has long shares and short calls; a protective put has long shares and long
puts. Matching shares equal `abs(option quantity) * option multiplier`, not merely
the number of contracts. Verticals use opposite same-kind legs; straddles use the
same call/put strike, strangles different strikes. A condor has outer long wings
and inner shorts; an iron butterfly uses equal inner put/call strikes. Editing
legs may invalidate that description without changing the label.

### Cash-flow signs and exact expiry geometry

For enabled legs, with signed quantity `q`, multiplier `m`, entry premium `p`:

```text
gross_entry_cost = sum(q * m * p)
entry_fees = sum(abs(q) * entry_fee_per_contract)   # options only
net_entry_cost = gross_entry_cost + entry_fees
entry_debit = max(net_entry_cost, 0)
entry_credit = max(-net_entry_cost, 0)
P&L = signed marked position value - fixed net_entry_cost
```

Fees are **not** multiplied by contract multiplier; share hedges incur no entry
fee in this model. Call terminal value per unit is `max(S-K, 0)`, put value is
`max(K-S, 0)`, underlying value is `S`. Long/short signs apply to both premium
cash flows and terminal/marked values. Fees can turn a small credit into a debit.

`expiry_curve` is the exact sparse-grid-safe polyline over the submitted
`spot_grid` domain. Its sorted unique `{spot, pnl}` vertices include both domain
endpoints, all enabled in-domain option strikes and all in-domain isolated
breakevens. Disabled/out-of-domain strikes are excluded. Adjacent vertices can
be joined linearly without hiding a strike kink; `expiry_pnl` remains aligned
with the original grid and must not be treated as an exact polyline on a coarse
grid. For one long 100-strike call, premium 5, multiplier 100, zero fees and
`spot_grid: [50, 150]`:

```json
{
  "expiry_pnl": [-500, 4500],
  "expiry_curve": [
    {"spot": 50, "pnl": -500},
    {"spot": 100, "pnl": -500},
    {"spot": 105, "pnl": 0},
    {"spot": 150, "pnl": 4500}
  ]
}
```

Global extrema, isolated roots and zero intervals still come from the full
nonnegative-spot domain, not just these display vertices. Do not add isolated
roots at the boundaries of a zero interval.

`summary.max_profit` and `max_loss` are nonnegative achievable expiry gain/loss
over **all** `S >= 0`, not extrema of the display grid and not today's model
marks. Zero means there is no achievable gain/loss, respectively. `null` means
unbounded and is paired with `profit_unbounded` / `loss_unbounded`; never display
it as zero. A long put's upside is bounded because spot cannot fall below zero;
a short call can have unbounded loss. A bounded expiry loss is not a margin or
assignment-risk guarantee.

`summary.breakevens` contains sorted isolated expiry roots, including a root at
zero if applicable; roots may lie beyond the entire input/display grid.
`summary.zero_intervals` contains closed `{start, end}` regions where expiry P&L
is identically zero; `end: null` means positive infinity. Their boundaries are
not duplicated as isolated roots. Offsetting positions may have a zero interval
`[0, infinity)` rather than infinitely many individual breakevens.

For the zero-fee condor above, expiry P&L is −600 at/below 80 and at/above 120,
+400 between 90 and 110, linear on the wings, and zero at 86/114. These values
derive from entry credit 400 minus the 1000 USD wing width exposure. Raising
fees to 2.50 per option contract gives fees 10, credit/max profit 390, max loss
610 and breakevens 86.1/113.9. These are illustrative manual cash flows.

### Output and Greek units

`OptionsAnalysis` returns `request`, `model`, `summary`, `spot_grid`, `today_pnl`,
`expiry_pnl`, `expiry_curve`, `legs`, `surface`, `scenarios`, `greeks`,
`greeks_grid`, `greek_units`, and `warnings`. `today_pnl`, `expiry_pnl`, scenario
`pnl` and `greeks_grid` align one-to-one with the returned `spot_grid`; expiry
vertices and surface cells have their own coordinates. Summary also includes
`theoretical_value_today` and `pnl_today` at the submitted current spot.
Scenario output includes `name`, `elapsed_days`, `remaining_days`, resolved
`volatility` fraction, `pnl` and `greeks`; the original IV shift stays in
`request.scenarios`.

Greeks are signed **whole-strategy** exposures, weighted by `quantity * multiplier`,
not per-contract numbers. They are evaluated at `request.spot`, including scenario
Greeks, not at every grid point.

| Greek | Returned unit |
| --- | --- |
| `delta` | USD per USD spot (equivalent shares) |
| `gamma` | Delta per USD spot |
| `theta` | USD per **calendar day elapsed**, not per year or trading day |
| `vega` | USD per **1 IV percentage point**; derivative with respect to IV fraction divided by 100 |
| `rho` | USD per **1 rate percentage point**; derivative with respect to rate fraction divided by 100 |

At zero time, option marks use exact terminal intrinsic payoff. At zero IV before
expiry, they instead use discounted deterministic payoff, e.g. a call is
`max(S*exp(-q*T) - K*exp(-r*T), 0)`, with `T=days/365`. It is not generally equal
to undiscounted terminal intrinsic value.

Option Greeks are deliberately unreported (`null`) at expiry and zero IV;
numerical singularities also produce null components. Any undefined active leg
component makes that strategy Greek null, even with a share hedge. Stock-only
positions retain delta equal to shares and the other Greeks zero, including at
expiry/zero IV. Disabled legs never propagate null. Preserve null versus zero in
tables/charts and retain the returned warnings.

`legs` is always emitted in the original input order, including disabled rows.
Each row contains `leg_index` (zero-based), `enabled`,
`resolved_implied_volatility`, `gross_entry_cost`, `entry_fees`, `net_entry_cost`,
`theoretical_value_today`, `pnl_today` and `greeks`. Monetary fields are signed
**total USD contributions**, not per-unit/contract prices. Their sums reproduce
the corresponding summary fields (subject to floating-point tolerance). Leg
Greeks are likewise quantity/multiplier-weighted; finite components sum to the
strategy component, while any undefined active component propagates `null`.
Disabled money/Greek components are zero, not null; their resolved IV still
reflects stored/fallback inputs. Share rows have resolved IV `null`, zero fees,
delta equal to signed shares and the other Greeks zero.

### P&L surface API

For example, add one of these configurations to a validated 30-day request:

```json
{
  "surface": {
    "axis": "elapsed_days",
    "spots": [80, 100, 120],
    "steps": [0, 15, 30]
  }
}
```

Or use `{"axis": "iv_shift_pp", "spots": [80, 100, 120], "steps": [-5, 0, 5]}`
when the declared base and every resolved enabled IV support those shifts.
`result.surface` echoes `axis`, `spots` and `steps`, plus `pnl`: **rows are steps,
columns are spots**, at most 21 × 41 = 861 finite signed-total-USD cells.

- `elapsed_days`: evaluate at `days_to_expiry - step`, keeping each resolved IV.
  The final expiry row uses exact intrinsic cash flows, not a stochastic forecast.
- `iv_shift_pp`: evaluate at the current time, shifting all resolved enabled IVs
  and the declared request IV by `step / 100`. It is a parallel shift, not an IV
  term structure or separate-expiry analysis.
- Step zero reproduces today's P&L at the same spots. Premiums and entry fees
  are fixed across all cells; fees are never charged again. Cells exclude the
  same financing/dividend/exit-cost/slippage effects as curves.
- No surface requested means `result.surface: null`. No cell probabilities,
  surface Greeks, provider observations or historical execution are returned.
  A zero-day horizon cannot request a time surface: two distinct in-range time
  steps do not exist. Omit it instead of duplicating zero or crossing expiry.

The new request fields are optional/defaulted for legacy requests. New canonical
backend responses always emit `expiry_curve`, `legs` and `surface` through both
HTTP endpoints and sandbox exports. Frontend extension types are additive/optional
for older draft fixtures; consumers must distinguish absent legacy fields from
zero, from null/unavailable Greeks and from an unrequested surface. Use returned
request/axes/leg identities for results, never revised draft coordinates.

## Python analysis is not historical execution or arbitrary imports

The direct-module example uses trusted local Python. It does not authorize
user-authored sandbox code to import `backend.derivatives` or arbitrary modules.
The Options worker injects only narrow model builders and the shared analyzer;
existing stock, portfolio and Robustness sandbox/execution rules remain unchanged.
Do not treat BSM P&L/Greeks as stock backtest equity, fills, return series,
historical options execution or a new brokerage ledger. American assignment and
futures remain deferred rather than hidden execution modes.

## Drafts, accounts and evidence boundaries

The pure analyzer has no persistence or account identity. An editable draft is
not completed evidence: display results from the returned `request`, and mark
them stale after input edits instead of relabeling old results with new controls.

The Options panel explicitly saves/restores named, bounded browser-local drafts
under its own guest/account key. Account changes clear in-memory results and fence
obsolete requests; guest drafts are not adopted by a signed-in account. Options
drafts are separate from the stock script library, research shelf and existing
account recovery bundle. They are not cloud-synced, encrypted or server-authorized
artifacts. Results are not persisted; rerun a restored draft to obtain analysis.

Scoped working recovery, versioned libraries, comparison pins and downloadable
artifacts are frontend integration concerns reconciled separately from this
backend contract. Any restore/import of inputs or Python source must remain
explicit and must not execute source automatically. Local scope keys, a copied
CSV/report or an Options-only export do not transfer server authorization or
constitute a PostgreSQL/data-root/runtime-secret backup. Keep guest and account
records separate; account switching must fence pending results as well as data.

OpenQuant's existing research shelf uses separate guest/account browser-local
storage. Browser account namespaces are not encrypted storage or cloud sync and
do not establish server authorization. Existing authenticated saved historical
research is account-private and server-local; guest historical runs are not
durably saved as account artifacts. These are boundaries of the existing
research workbench, not a claim that options analysis is saved into historical
run storage or included in a comprehensive backup. Clearing
browser storage can remove local research. Legacy/guest records must never be
silently claimed by another account. See [research recovery](RESEARCH_RECOVERY.md)
for the separate browser and server backup boundaries.

## Independent financial regression checks

From the repository root:

```bash
.venv/bin/python -m pytest backend/tests/test_options_analytics.py backend/tests/test_options_financial_regressions.py backend/tests/test_options_extensions.py backend/tests/test_options_runner.py backend/tests/test_options_routes.py -q
.venv/bin/ruff format --check backend/tests/test_options_financial_regressions.py backend/tests/test_options_extensions.py backend/tests/test_options_routes.py
.venv/bin/ruff check backend/tests/test_options_financial_regressions.py backend/tests/test_options_extensions.py backend/tests/test_options_routes.py
```

The independent suite uses discounted lognormal terminal-payoff integration
(Simpson quadrature split at exercise), standard BSM reference values, analytic
put-call/Greek parity and hand-derived piecewise expiry cash flows. It checks
long/short tails, multiple/no/tangent roots, zero regions, hedges, multipliers,
fees, disabled legs, finite-difference Greek units, zero/tiny time and IV,
nonfinite rejection, fixed-premium scenarios and seeded deterministic inputs.
Extension coverage independently checks heterogeneous resolved leg IVs and
finite-difference Greeks, parallel scenario shifts, sparse two-point expiry
vertices/arbitrary strike knots/zoomed domains, signed per-leg sums and null/zero
semantics, and each requested time/IV surface cell against payoff integration.
Boundary tests include exact paired common dates, manual quotes that do not
reprice premiums, legacy defaults, dimensions and shifted IV limits. Real spawned
exports and both actual HTTP endpoints preserve the full canonical contract;
maximum-count payloads (16 legs, 201 curve points, 3 scenarios, 861 cells) with
64-character quote metadata and a fully escaped 16 KiB stdout fixture fit the
unchanged 256 KiB worker envelope cap. These fixtures are regression evidence,
not an exhaustive proof of every possible response size or sandbox isolation.
These are shell-level mathematical regressions, not browser validation or
real-market calibration.

Model references: Black & Scholes, “The Pricing of Options and Corporate
Liabilities,” *Journal of Political Economy* 81(3), 637–654 (1973),
[doi:10.1086/260062](https://doi.org/10.1086/260062); Merton, “Theory of Rational
Option Pricing,” *Bell Journal of Economics and Management Science* 4(1),
141–183 (1973), [doi:10.2307/3003143](https://doi.org/10.2307/3003143). These model
assumptions, not the references alone, determine the limits of the evidence.

# Manual European options research

OpenQuant's `backend.derivatives` module analyzes an explicit multi-leg position
from manual inputs. It returns theoretical Black–Scholes–Merton (BSM) marks,
exact expiry P&L geometry, signed strategy Greeks and time/IV scenarios. It does
not fetch an options chain, execute a trade or replay historical options prices.
No account, provider key, network request or new dependency is required for the
direct Python analysis shown here.

## Supported scope and provenance

- European, cash-settled, USD calls and puts with one shared expiry, plus explicit
  underlying share hedges. All prices and P&L amounts are USD.
- Constant annual IV, continuously compounded rate and continuous dividend yield;
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
API; it does not assert a REST endpoint, workbench editor or sandbox callable
exists merely because the pricing module exists.

### Input contract and limits

All models forbid extra fields and nonfinite numbers; numeric strings and boolean
stand-ins for numbers are rejected. Quantities/multipliers are strict integers.
Disabled legs are still validated.

| Field | Meaning / bounds / default |
| --- | --- |
| `strategy.name` | Nonblank, at most 120 characters; default `"Custom options"` |
| `strategy.template` | Informational label; default `"custom"` |
| `strategy.days_to_expiry` | 0–3650 calendar days, fractional days allowed; default 30 |
| `strategy.currency`, `strategy.exercise_style`, `strategy.settlement` | Only `"USD"`, `"european"`, `"cash"`, respectively; these are also the defaults |
| `strategy.entry_fee_per_contract` | 0–10000 USD per enabled option contract, once at entry; default 0 |
| `strategy.legs` | 1–16 legs, at least one enabled |
| `leg.kind` | `"call"`, `"put"` or `"underlying"` |
| `leg.quantity` | Nonzero signed integer; options up to ±10000 contracts, stock up to ±1000000 shares; positive long, negative short |
| `leg.strike` | Options require a positive strike up to 1000000 USD; underlying requires `null` (default) |
| `leg.entry_premium` | 0–1000000 USD per underlying unit; stock entry price for an underlying leg; default 0 |
| `leg.multiplier` | 1–1000 units per option contract, default 100; an underlying leg requires explicit 1 |
| `leg.enabled` | Boolean, default `true`; disabled legs have no cost, mark, Greek or geometry contribution |
| `spot` | Current positive USD spot up to 1000000; required |
| `volatility` | Annual fraction, 0–5; default 0.20 means 20% IV |
| `rate` | Annual continuously compounded fraction, −1 to 1; default 0.03 |
| `dividend_yield` | Annual continuous fraction, −1 to 1; default 0 |
| `spot_grid` | Required 2–201 strictly increasing USD spots, each 0–1000000; zero is allowed in the grid, not as current `spot` |
| `scenarios` | 0–3 uniquely named scenarios; default empty list |
| `scenario.name` | Nonblank, at most 80 characters; required |
| `scenario.elapsed_days` | 0 through expiry inclusive; default 0 |
| `scenario.iv_shift_pp` | Additive −100 to +100 IV percentage points; shifted IV must remain 0–5; default 0 |

`iv_shift_pp=5` means 20% IV becomes 25%, not a 5% relative increase and not
an IV fraction of 5. Remaining days are `days_to_expiry - elapsed_days`.
Scenarios never advance beyond expiry, change entry premiums or charge fees again.

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
`expiry_pnl`, `scenarios`, `greeks`, `greek_units`, and `warnings`. Every P&L array
aligns one-to-one with the returned `spot_grid`. Summary also includes
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

## Python analysis is not historical execution or arbitrary imports

The example uses trusted local Python. It does not authorize user-authored
sandbox code to import `backend.derivatives` or arbitrary modules. Existing stock,
portfolio and Robustness sandbox/execution rules remain unchanged. An options
worker integration must expose a narrow supported analysis callable under those
same sandbox conventions, not broaden allowed imports or disable AST guards.
Do not treat BSM P&L/Greeks as stock backtest equity, fills, return series,
historical options execution or a new brokerage ledger. American assignment and
futures remain deferred rather than hidden execution modes.

## Drafts, accounts and evidence boundaries

The pure analyzer has no persistence or account identity. An editable draft is
not completed evidence: display results from the returned `request`, and mark
them stale after input edits instead of relabeling old results with new controls.

OpenQuant's existing research shelf uses separate guest/account browser-local
storage. Browser account namespaces are not encrypted storage or cloud sync and
do not establish server authorization. Existing authenticated saved historical
research is account-private and server-local; guest historical runs are not
durably saved as account artifacts. These are boundaries of the existing
research workbench, not a claim that this analyzer saves options drafts/results,
syncs them, or writes options analysis into the historical run store. Clearing
browser storage can remove local research. Legacy/guest records must never be
silently claimed by another account. See [research recovery](RESEARCH_RECOVERY.md)
for the separate browser and server backup boundaries.

## Independent financial regression checks

From the repository root:

```bash
.venv/bin/python -m pytest backend/tests/test_options_analytics.py backend/tests/test_options_financial_regressions.py -q
.venv/bin/ruff format --check backend/tests/test_options_financial_regressions.py
.venv/bin/ruff check backend/tests/test_options_financial_regressions.py
```

The independent suite uses discounted lognormal terminal-payoff integration
(Simpson quadrature split at exercise), standard BSM reference values, analytic
put-call/Greek parity and hand-derived piecewise expiry cash flows. It checks
long/short tails, multiple/no/tangent roots, zero regions, hedges, multipliers,
fees, disabled legs, finite-difference Greek units, zero/tiny time and IV,
nonfinite rejection, fixed-premium scenarios and seeded deterministic inputs.
These are shell-level mathematical regressions, not browser validation or
real-market calibration.

Model references: Black & Scholes, “The Pricing of Options and Corporate
Liabilities,” *Journal of Political Economy* 81(3), 637–654 (1973),
[doi:10.1086/260062](https://doi.org/10.1086/260062); Merton, “Theory of Rational
Option Pricing,” *Bell Journal of Economics and Management Science* 4(1),
141–183 (1973), [doi:10.2307/3003143](https://doi.org/10.2307/3003143). These model
assumptions, not the references alone, determine the limits of the evidence.

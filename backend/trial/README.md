# Robustness examples backend

This is a deterministic educational robustness demo. It accepts only three curated
strategy IDs and two costs in `[0, 50]` basis points. It does not evaluate user
code, load market history, call providers, or write to a database.

The workbench labels the examples by their behavior: training-selected momentum,
two-bar frequent trading, and buy-and-hold. Existing strategy IDs and `/trial`
URLs remain compatible with earlier configuration links. Report-policy version
3 uses plain analytical strategy labels and finding titles; calculations are unchanged.

## Constructed scenario

`scenario.py` generates 360 daily UTC OHLCV bars using a local `random.Random`
seed. The first 240 bars alternate persistent positive and negative trends;
the last 120 bars have faster reversals and negative drift. Bounded seeded noise,
overnight gaps, valid high/low ranges, and illustrative volume are generated
locally. The split starts at bar 240 and is always chronological.

The scenario and regimes were designed by developers for teaching. They are
**synthetic, not real market history or independent evidence of market alpha**.
Calendar dates are labels, not a claim about prices on those dates. The generator
does not target or adjust strategy metrics; all reported numbers come from
`run_backtest`, its fills, equity curve, trades, and metrics.

## Evaluation policy

- Every full or holdout run starts with 10,000 currency units and a fresh strategy.
- Long-only fractional positions allocate 95% of cash before reserving for the
  maximum permitted commission/slippage and the generator's maximum next-open
  gap. This sizing policy stays the same at zero and nonzero costs. Buys do not
  borrow; sells close the held quantity.
- Orders use existing engine next-bar open fills; signals see only revealed bars.
- Commission uses effective-fill notional; slippage is adverse next-open bps.
  Additional half-spread is explicitly zero, not the engine's default spread.
- The momentum strategy selects a lookback from `[3, 6, 12, 24]` using **training
  only**, maximizing total return at chosen costs, with smaller lookback winning
  ties. That one parameter is frozen for baseline, realistic, and holdout runs.
- The frequent trader's two-bar holding period is fixed, not optimized. Its
  sensitivity grid is `[1, 2, 3]`. Momentum sensitivity uses the selected value
  and its immediate neighbors in the fixed training grid on holdout. Neither
  sensitivity grid selects another parameter.
- Buy-and-hold has `selected_parameter: null` and `sensitivity: []`.
- Full benchmark and realistic curves share the full dataset and costs. Holdout
  strategy and benchmark share the exact test segment and costs; both are funded
  separately from training and start flat without indicator warmup. Independent
  curves are never stitched together.
- Full-dataset results include the period used for training selection and are
  not wholly out-of-sample; the separate holdout is the chronological test.
- Returns and nonpositive drawdowns are fractions, equity timestamps Unix seconds,
  and cost/equity values currency units. Cost sums include each engine fill's
  commission, slippage, and spread cost. `trade_count` counts completed engine
  round trips, so an unclosed buy-and-hold position has zero completed trades.
- Final open positions are marked at the last close, not liquidated. Orders
  submitted on the last bar remain unfilled. No future bar is synthesized.
- Findings describe measured evidence, with conditional severity, never scores
  or certifications. Reading holdout sensitivity consumes that test as evidence.

## API and resource bounds

The router is registered in both `backend.app` (the full research app) and
`backend.trial_app` (the standalone curated demo). The router's prefix is `/trial`.
See the root README for verified standalone demo build and start commands.

- `GET /trial/catalog` returns the version-one catalog.
- `POST /trial/run` accepts `strategy_id`, `commission_bps` (default 1), and
  `slippage_bps` (default 5), rejecting extra fields, unknown IDs, booleans,
  strings, nonfinite floats and out-of-range costs with 422.
- Validation errors omit raw input and contexts so invalid nonfinite numbers or
  private submitted strings cannot be echoed into JSON responses.
- Work runs off the event loop in Starlette's threadpool. A process-local lock
  admits one trial operation at a time, without blocking worker threads waiting
  for the slot. Busy requests return 503 with `Retry-After: 1`.
- A 32-entry LRU stores immutable serialized reports. Each response deserializes
  a fresh model, so callers cannot mutate cached curves. There is no shared
  strategy, portfolio, dataframe, persistent report store, or provider state.
- Report identity hashes normalized configuration, dataset/scenario version,
  report-policy version, engine version, seed, and capital. It excludes engine
  UUIDs and wall-clock timestamps. Bump `DATASET_VERSION` when changing generated
  data and `REPORT_VERSION` when changing strategies, selection, or reporting
  policy; the backtest engine has its own `ENGINE_VERSION`.

The cache and slot are per process, not distributed rate limits. Distinct cost
configurations can still generate new bounded work. A shared link re-runs a
configuration on the installed versions; it is not a permanent hosted report.

## Tests

From the repository root, run `python -m pytest backend/tests/test_trial*.py`.
Router tests mount a tiny FastAPI app and need neither database startup nor
provider credentials. Existing backtest tests additionally exercise the reused
engine. See `CONTRIBUTING.md` for format, lint, typing and pre-commit commands.

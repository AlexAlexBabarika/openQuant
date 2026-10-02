"""Measured trial evidence from the existing next-bar-fill backtest engine."""

from __future__ import annotations

import hashlib
import json
from functools import lru_cache
from threading import Lock

import polars as pl

from backend.backtesting.costs import (
    BpsCommission,
    Costs,
    FixedBpsHalfSpread,
    FixedBpsSlippage,
)
from backend.backtesting.engine import run_backtest
from backend.backtesting.strategy import Strategy
from backend.backtesting.types import BacktestResult
from backend.backtesting.version import ENGINE_VERSION
from backend.trial.models import (
    EquityPoint,
    Finding,
    Holdout,
    RunSummary,
    SelectedParameter,
    SensitivityPoint,
    StrategyId,
    TrialCatalog,
    TrialConfig,
    TrialDataset,
    TrialReport,
    TrialStrategy,
)
from backend.trial.scenario import (
    DATASET_ID,
    DATASET_LABEL,
    DATASET_VERSION,
    SEED,
    TRAINING_BARS,
    scenario_frame,
)
from backend.trial.strategies import (
    CADENCE_GRID,
    DEFAULT_HOLDING_BARS,
    LOOKBACK_GRID,
    BuyAndHold,
    FragileMomentum,
    FrequentTrader,
)

STARTING_CASH = 10_000.0
REPORT_VERSION = "1"
CACHE_SIZE = 32
_REPORT_LOCK = Lock()
STRATEGIES = (
    TrialStrategy(
        id="backtest-billionaire",
        name="Backtest Billionaire",
        description="A momentum lookback picked for its best training return.",
        lesson="A parameter that wins an audition may struggle in a new regime.",
    ),
    TrialStrategy(
        id="overcaffeinated-trader",
        name="Overcaffeinated Trader",
        description="Buy, hold two bars, sell, repeat. The broker stays busy.",
        lesson="Frequent trading gives small execution costs many chances to add up.",
    ),
    TrialStrategy(
        id="boring-benchmark",
        name="Boring Benchmark",
        description="Buy once on the next open and hold. No parameter audition.",
        lesson="A simple reference belongs beside every more elaborate strategy.",
    ),
)


def catalog() -> TrialCatalog:
    return TrialCatalog(strategies=list(STRATEGIES))


def costs_for(config: TrialConfig) -> Costs:
    return Costs(
        slippage=FixedBpsSlippage(config.slippage_bps),
        commission=BpsCommission(config.commission_bps),
        spread=FixedBpsHalfSpread(0),
    )


def make_strategy(strategy_id: StrategyId, parameter: int | None) -> Strategy:
    if strategy_id == "backtest-billionaire":
        if parameter is None:
            raise ValueError("momentum requires a training-selected lookback")
        return FragileMomentum(parameter)
    if strategy_id == "overcaffeinated-trader":
        return FrequentTrader(DEFAULT_HOLDING_BARS if parameter is None else parameter)
    return BuyAndHold()


def evaluate(
    frame: pl.DataFrame,
    strategy_id: StrategyId,
    costs: Costs,
    parameter: int | None = None,
) -> BacktestResult:
    return run_backtest(
        frame=frame,
        strategy=make_strategy(strategy_id, parameter),
        starting_cash=STARTING_CASH,
        costs=costs,
        seed=SEED,
        strategy_id=strategy_id,
        data_version=DATASET_VERSION,
    )


def select_lookback(training: pl.DataFrame, costs: Costs) -> int:
    scores = [
        (
            evaluate(
                training, "backtest-billionaire", costs, lookback
            ).metrics.total_return,
            lookback,
        )
        for lookback in LOOKBACK_GRID
    ]
    return max(scores, key=lambda item: (item[0], -item[1]))[1]


def summarize(result: BacktestResult) -> RunSummary:
    return RunSummary(
        total_return=result.metrics.total_return,
        max_drawdown=result.metrics.max_drawdown,
        trade_count=len(result.trades),
        total_cost=sum(
            fill.commission + fill.slippage + fill.spread_cost for fill in result.fills
        ),
        equity=[
            EquityPoint(t=int(point.time.timestamp()), value=point.equity)
            for point in result.equity_curve
        ],
    )


def report_id(config: TrialConfig) -> str:
    identity = {
        "schema_version": 1,
        "report_version": REPORT_VERSION,
        "dataset_id": DATASET_ID,
        "dataset_version": DATASET_VERSION,
        "engine_version": ENGINE_VERSION,
        "seed": SEED,
        "starting_cash": STARTING_CASH,
        "config": config.model_dump(),
    }
    canonical = json.dumps(
        identity, sort_keys=True, separators=(",", ":"), allow_nan=False
    )
    return hashlib.sha256(canonical.encode()).hexdigest()


def build_report(config: TrialConfig) -> TrialReport:
    frame = scenario_frame()
    training = frame.slice(0, TRAINING_BARS)
    holdout = frame.slice(TRAINING_BARS)
    costs = costs_for(config)
    selected: SelectedParameter | None = None
    parameter: int | None = None
    grid: tuple[int, ...] = ()
    assumptions = [
        "All runs start with 10,000 currency units, long-only fractional shares, and no leverage.",
        "Entries allocate 95% of available cash before a reserve for the maximum allowed costs and bounded next-open gap; this sizing rule is identical at every cost setting.",
        "Signals use only revealed closes; market orders fill on the following bar's open.",
        "Commission is bps of effective fill notional; slippage is adverse bps of the next open. Additional spread is zero.",
        "Trade count means completed round trips. Open positions are marked at the final close, not liquidated; pending last-bar orders remain unfilled.",
        "Drawdown is a nonpositive peak-to-trough fraction; returns are fractions, not percentages.",
        "Full-dataset runs and separate holdout runs each start with 10,000. The independently funded curves are never stitched.",
        "Holdout starts flat with no training position, cash, or indicator history carried across the split.",
        "The frictionless baseline uses the same strategy parameter as the chosen-cost run.",
        "Full-dataset curves include the training period used for selection and are not wholly out-of-sample; the separately funded holdout is the chronological test.",
    ]
    if config.strategy_id == "backtest-billionaire":
        parameter = select_lookback(training, costs)
        selected = SelectedParameter(name="lookback_bars", value=parameter)
        index = LOOKBACK_GRID.index(parameter)
        grid = LOOKBACK_GRID[max(0, index - 1) : index + 2]
        assumptions.append(
            "Lookback is selected only from training by highest total return at chosen costs over the fixed grid [3, 6, 12, 24]; ties choose the smaller value. The selected value and its immediate fixed-grid neighbors are shown on holdout for sensitivity, never retuning."
        )
    elif config.strategy_id == "overcaffeinated-trader":
        parameter = DEFAULT_HOLDING_BARS
        selected = SelectedParameter(name="holding_bars", value=parameter)
        grid = CADENCE_GRID
        assumptions.append(
            "Holding period is fixed at two bars, not optimized. Fixed neighboring periods [1, 2, 3] are measured on holdout at chosen costs for sensitivity."
        )
    else:
        assumptions.append(
            "Buy-and-hold has no selected parameter and an empty sensitivity list."
        )

    baseline = summarize(
        evaluate(frame, config.strategy_id, Costs.frictionless(), parameter)
    )
    realistic_result = evaluate(frame, config.strategy_id, costs, parameter)
    realistic = summarize(realistic_result)
    benchmark = summarize(evaluate(frame, "boring-benchmark", costs))
    test_strategy = summarize(evaluate(holdout, config.strategy_id, costs, parameter))
    test_benchmark = summarize(evaluate(holdout, "boring-benchmark", costs))
    sensitivity = []
    for value in grid:
        summary = summarize(evaluate(holdout, config.strategy_id, costs, value))
        sensitivity.append(
            SensitivityPoint(
                parameter_value=value,
                total_return=summary.total_return,
                max_drawdown=summary.max_drawdown,
            )
        )
    gap = test_strategy.total_return - test_benchmark.total_return
    findings = [
        Finding(
            id="constructed-evidence",
            severity="info",
            title="A teaching exhibit, not a market alibi",
            detail="These developer-designed synthetic OHLCV regimes are educational, not real market history or independent evidence of market alpha.",
        ),
        Finding(
            id="execution-costs",
            severity="warning" if realistic.total_cost > 0 else "info",
            title="The broker kept the receipts"
            if realistic.total_cost > 0
            else "Frictionless is an assumption",
            detail=(
                f"{len(realistic_result.fills)} full-dataset fills incurred {realistic.total_cost:.2f} currency units in engine-recorded costs. "
                f"Return at chosen costs: {realistic.total_return:.2%}; frictionless: {baseline.total_return:.2%}. "
                "The difference also includes cash-sizing and compounding effects; it is not a direct subtraction of the cost sum."
            ),
        ),
        Finding(
            id="holdout-comparison",
            severity="warning" if gap < 0 else "info",
            title="The chronological cross-examination",
            detail=(
                f"On the same separately funded holdout, strategy return was {test_strategy.total_return:.2%} "
                f"versus buy-and-hold {test_benchmark.total_return:.2%}, a {gap * 100:+.2f} percentage-point difference. "
                "Both used identical starting cash, dates and chosen costs."
            ),
        ),
    ]
    if config.strategy_id == "backtest-billionaire":
        training_summary = summarize(
            evaluate(training, config.strategy_id, costs, parameter)
        )
        findings.append(
            Finding(
                id="training-selection",
                severity="warning"
                if test_strategy.total_return < training_summary.total_return
                else "info",
                title="The audition is not the verdict",
                detail=(
                    f"Training alone selected lookback {parameter} with {training_summary.total_return:.2%} return. "
                    f"Untouched holdout returned {test_strategy.total_return:.2%}. "
                    "These segments have different lengths and constructed regimes; their returns are not directly comparable forecasts."
                ),
            )
        )
    if sensitivity:
        low = min(point.total_return for point in sensitivity)
        high = max(point.total_return for point in sensitivity)
        findings.append(
            Finding(
                id="parameter-sensitivity",
                severity="warning" if low < 0 < high else "info",
                title="Small knobs, measured consequences",
                detail=f"The fixed holdout parameter grid produced returns from {low:.2%} to {high:.2%} at chosen costs. These observations do not select a new parameter.",
            )
        )
    return TrialReport(
        report_id=report_id(config),
        strategy=next(
            strategy for strategy in STRATEGIES if strategy.id == config.strategy_id
        ),
        dataset=TrialDataset(
            id=DATASET_ID,
            version=DATASET_VERSION,
            label=DATASET_LABEL,
            start=frame["timestamp"][0].isoformat(),
            end=frame["timestamp"][-1].isoformat(),
            split_date=holdout["timestamp"][0].isoformat(),
            training_bars=training.height,
            holdout_bars=holdout.height,
        ),
        config=config,
        baseline=baseline,
        realistic=realistic,
        benchmark=benchmark,
        holdout=Holdout(strategy=test_strategy, benchmark=test_benchmark),
        sensitivity=sensitivity,
        selected_parameter=selected,
        findings=findings,
        assumptions=assumptions,
        limitations=[
            "The scenario was deliberately constructed by developers to teach regime change and execution friction. It is not independent evidence of market alpha or a profitability certification.",
            "One synthetic instrument and one chronological split do not establish robustness across markets or future conditions.",
            "Bounded gaps and noise, smooth fills and unlimited fractional-share liquidity omit many real risks; volume is illustrative and does not constrain fills.",
            "No taxes, dividends, funding costs, latency, order-book impact or forced final liquidation are modeled.",
            "Looking at holdout sensitivity consumes that test as evidence; selecting a parameter from it would require a new untouched evaluation segment.",
            "Shared configurations re-run locally against the installed scenario and engine versions; they are not permanent hosted reports or investment advice.",
        ],
    )


class TrialBusyError(Exception):
    """The process's one bounded trial computation slot is occupied."""


@lru_cache(maxsize=CACHE_SIZE)
def _cached_report(config: TrialConfig) -> str:
    return build_report(config).model_dump_json()


def get_report(config: TrialConfig) -> TrialReport:
    if not _REPORT_LOCK.acquire(blocking=False):
        raise TrialBusyError
    try:
        return TrialReport.model_validate_json(_cached_report(config))
    finally:
        _REPORT_LOCK.release()

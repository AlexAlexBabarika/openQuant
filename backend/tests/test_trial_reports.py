"""Engine reconciliation and honest trial-evaluation invariants."""

from __future__ import annotations

import json
import math
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

import polars as pl
import pytest

import backend.trial.report as reports
from backend.backtesting.costs import Costs
from backend.trial.models import TrialConfig
from backend.trial.report import (
    CACHE_SIZE,
    STARTING_CASH,
    STRATEGIES,
    build_report,
    costs_for,
    evaluate,
    get_report,
    select_lookback,
    summarize,
)
from backend.trial.scenario import (
    HOLDOUT_BARS,
    MAX_OPEN_GAP,
    TRAINING_BARS,
    scenario_frame,
)
from backend.trial.strategies import CADENCE_GRID, LOOKBACK_GRID


@pytest.mark.parametrize("holding_bars", CADENCE_GRID)
def test_frequent_trader_holds_the_advertised_number_of_bars(
    holding_bars: int,
) -> None:
    result = evaluate(
        scenario_frame(),
        "overcaffeinated-trader",
        Costs.frictionless(),
        holding_bars,
    )
    assert result.trades
    assert all(trade.bars_held == holding_bars for trade in result.trades)
    assert all(fill.fill_index == fill.submitted_index + 1 for fill in result.fills)


def test_scenario_is_deterministic_valid_ohlcv_with_bounded_gaps() -> None:
    frame = scenario_frame()
    assert frame.equals(scenario_frame())
    assert frame.height == TRAINING_BARS + HOLDOUT_BARS
    assert frame["timestamp"].is_sorted()
    assert frame["timestamp"].n_unique() == frame.height
    rows = frame.iter_rows(named=True)
    previous_close = 100.0
    for row in rows:
        assert 0 < row["low"] <= min(row["open"], row["close"])
        assert row["high"] >= max(row["open"], row["close"])
        assert row["volume"] > 0
        assert abs(row["open"] / previous_close - 1) <= MAX_OPEN_GAP + 1e-12
        assert all(
            math.isfinite(row[key])
            for key in ("open", "high", "low", "close", "volume")
        )
        previous_close = row["close"]


@pytest.mark.parametrize("strategy", STRATEGIES, ids=lambda strategy: strategy.id)
def test_all_summary_fields_reconcile_to_engine(strategy) -> None:
    config = TrialConfig(strategy_id=strategy.id)
    report = build_report(config)
    frame = scenario_frame()
    costs = costs_for(config)
    parameter = (
        int(report.selected_parameter.value) if report.selected_parameter else None
    )
    pairs = [
        (
            report.baseline,
            evaluate(frame, strategy.id, Costs.frictionless(), parameter),
        ),
        (report.realistic, evaluate(frame, strategy.id, costs, parameter)),
        (report.benchmark, evaluate(frame, "boring-benchmark", costs)),
        (
            report.holdout.strategy,
            evaluate(frame.slice(TRAINING_BARS), strategy.id, costs, parameter),
        ),
        (
            report.holdout.benchmark,
            evaluate(frame.slice(TRAINING_BARS), "boring-benchmark", costs),
        ),
    ]
    for summary, result in pairs:
        assert summary == summarize(result)
        assert summary.total_return == pytest.approx(
            summary.equity[-1].value / STARTING_CASH - 1
        )
        assert summary.total_cost == pytest.approx(
            sum(
                fill.commission + fill.slippage + fill.spread_cost
                for fill in result.fills
            )
        )
        assert summary.trade_count == len(result.trades)
        peak = STARTING_CASH
        drawdown = 0.0
        for point, engine_point in zip(summary.equity, result.equity_curve):
            assert point.t == int(engine_point.time.timestamp())
            assert point.value == engine_point.cash + engine_point.holdings
            peak = max(peak, point.value)
            drawdown = min(drawdown, point.value / peak - 1)
        assert summary.max_drawdown == drawdown


@pytest.mark.parametrize("strategy", STRATEGIES, ids=lambda strategy: strategy.id)
@pytest.mark.parametrize("bps", [0.0, 50.0])
def test_no_leverage_shorts_or_same_bar_fills(strategy, bps: float) -> None:
    config = TrialConfig(strategy_id=strategy.id, commission_bps=bps, slippage_bps=bps)
    frame = scenario_frame()
    parameter = (
        select_lookback(frame.slice(0, TRAINING_BARS), costs_for(config))
        if strategy.id == "backtest-billionaire"
        else None
    )
    for segment in (frame, frame.slice(TRAINING_BARS)):
        result = evaluate(segment, strategy.id, costs_for(config), parameter)
        assert result.fills
        for fill in result.fills:
            assert fill.quantity > 0
            assert fill.fill_index == fill.submitted_index + 1
            assert fill.reference_price == result.bars[fill.fill_index].open
        for point in result.equity_curve:
            assert point.cash >= 0
            assert point.holdings >= 0
            assert point.holdings <= point.equity


@pytest.mark.parametrize("strategy", STRATEGIES, ids=lambda strategy: strategy.id)
def test_repeat_determinism_and_finite_json(strategy) -> None:
    config = TrialConfig(strategy_id=strategy.id)
    first = build_report(config)
    assert first.model_dump_json() == build_report(config).model_dump_json()
    assert get_report(config).model_dump_json() == first.model_dump_json()
    json.dumps(first.model_dump(), allow_nan=False)
    for bps in (0.0, 50.0):
        json.dumps(
            build_report(
                TrialConfig(
                    strategy_id=strategy.id, commission_bps=bps, slippage_bps=bps
                )
            ).model_dump(),
            allow_nan=False,
        )


def test_training_selection_uses_chosen_costs_and_is_independent_of_holdout(
    monkeypatch,
) -> None:
    config = TrialConfig(
        strategy_id="backtest-billionaire", commission_bps=25, slippage_bps=50
    )
    original = scenario_frame()
    training = original.slice(0, TRAINING_BARS)
    scores = {
        value: evaluate(
            training, config.strategy_id, costs_for(config), value
        ).metrics.total_return
        for value in LOOKBACK_GRID
    }
    expected = max(LOOKBACK_GRID, key=lambda value: (scores[value], -value))
    first = build_report(config)
    assert first.selected_parameter is not None
    assert first.selected_parameter.value == expected
    changed_holdout = original.slice(TRAINING_BARS).with_columns(
        (pl.col("close") * 0.5).alias("close")
    )
    changed = pl.concat([training, changed_holdout])
    observed_training: list[pl.DataFrame] = []
    select = reports.select_lookback

    def spy(frame: pl.DataFrame, costs: Costs) -> int:
        observed_training.append(frame)
        return select(frame, costs)

    monkeypatch.setattr(reports, "scenario_frame", lambda: changed)
    monkeypatch.setattr(reports, "select_lookback", spy)
    second = build_report(config)
    assert second.selected_parameter == first.selected_parameter
    assert len(observed_training) == 1
    assert observed_training[0].equals(training)
    assert second.holdout.strategy != first.holdout.strategy


def test_selection_ties_choose_smaller_lookback() -> None:
    training = (
        scenario_frame()
        .slice(0, TRAINING_BARS)
        .with_columns(pl.lit(100.0).alias("close"))
    )
    assert select_lookback(training, Costs.frictionless()) == min(LOOKBACK_GRID)


@pytest.mark.parametrize("strategy", STRATEGIES, ids=lambda strategy: strategy.id)
def test_same_segment_benchmark_independent_funding_and_sensitivity(strategy) -> None:
    config = TrialConfig(strategy_id=strategy.id)
    report = build_report(config)
    assert report.realistic.equity[0].value == STARTING_CASH
    assert report.benchmark.equity[0].value == STARTING_CASH
    assert report.holdout.strategy.equity[0].value == STARTING_CASH
    assert report.holdout.benchmark.equity[0].value == STARTING_CASH
    assert [point.t for point in report.realistic.equity] == [
        point.t for point in report.benchmark.equity
    ]
    assert [point.t for point in report.holdout.strategy.equity] == [
        point.t for point in report.holdout.benchmark.equity
    ]
    assert len(report.realistic.equity) == TRAINING_BARS + HOLDOUT_BARS
    assert len(report.holdout.strategy.equity) == HOLDOUT_BARS
    assert report.holdout.strategy.equity[0].t == int(
        datetime.fromisoformat(report.dataset.split_date).timestamp()
    )
    assert (
        report.realistic.equity[TRAINING_BARS - 1].t
        < report.holdout.strategy.equity[0].t
    )
    for point in report.sensitivity:
        measured = evaluate(
            scenario_frame().slice(TRAINING_BARS),
            strategy.id,
            costs_for(config),
            int(point.parameter_value),
        )
        assert point.total_return == measured.metrics.total_return
        assert point.max_drawdown == measured.metrics.max_drawdown
    if strategy.id == "boring-benchmark":
        assert report.selected_parameter is None
        assert report.sensitivity == []
        assert report.realistic == report.benchmark
        assert report.holdout.strategy == report.holdout.benchmark
    else:
        assert report.selected_parameter is not None
        if strategy.id == "backtest-billionaire":
            index = LOOKBACK_GRID.index(int(report.selected_parameter.value))
            assert [point.parameter_value for point in report.sensitivity] == list(
                LOOKBACK_GRID[max(0, index - 1) : index + 2]
            )
        selected = next(
            point
            for point in report.sensitivity
            if point.parameter_value == report.selected_parameter.value
        )
        assert selected.total_return == report.holdout.strategy.total_return


def test_frequent_trader_zero_and_nonzero_cost_evidence() -> None:
    free = build_report(
        TrialConfig(
            strategy_id="overcaffeinated-trader", commission_bps=0, slippage_bps=0
        )
    )
    paid = build_report(TrialConfig(strategy_id="overcaffeinated-trader"))
    assert free.baseline == free.realistic
    assert free.realistic.total_cost == 0
    assert paid.realistic.total_cost > 0
    assert paid.realistic.total_return < free.realistic.total_return
    assert paid.realistic.trade_count > 50
    assert paid.baseline == free.baseline


def test_report_identity_covers_config_and_versions(monkeypatch) -> None:
    config = TrialConfig(strategy_id="boring-benchmark")
    original = reports.report_id(config)
    assert original == reports.report_id(
        TrialConfig(
            strategy_id="boring-benchmark", commission_bps=1.0, slippage_bps=5.0
        )
    )
    assert original != reports.report_id(
        TrialConfig(strategy_id="boring-benchmark", commission_bps=2)
    )
    assert original != reports.report_id(
        TrialConfig(strategy_id="boring-benchmark", slippage_bps=6)
    )
    assert original != reports.report_id(
        TrialConfig(strategy_id="overcaffeinated-trader")
    )
    for name in ("DATASET_VERSION", "ENGINE_VERSION", "REPORT_VERSION"):
        with monkeypatch.context() as scoped:
            scoped.setattr(reports, name, "changed")
            assert original != reports.report_id(config)
    assert reports.report_id(
        TrialConfig(strategy_id="boring-benchmark", commission_bps=-0.0)
    ) == reports.report_id(
        TrialConfig(strategy_id="boring-benchmark", commission_bps=0.0)
    )


def test_cache_is_bounded_and_returns_isolated_models() -> None:
    reports._cached_report.cache_clear()
    config = TrialConfig(strategy_id="boring-benchmark")
    first = get_report(config)
    first.realistic.equity.clear()
    second = get_report(config)
    assert len(second.realistic.equity) == TRAINING_BARS + HOLDOUT_BARS
    assert reports._cached_report.cache_info().hits == 1
    for value in range(CACHE_SIZE + 1):
        get_report(TrialConfig(strategy_id="boring-benchmark", commission_bps=value))
    assert reports._cached_report.cache_info().currsize == CACHE_SIZE


def test_busy_computation_fails_without_waiting() -> None:
    with reports._REPORT_LOCK:
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(
                get_report, TrialConfig(strategy_id="boring-benchmark")
            )
            with pytest.raises(reports.TrialBusyError):
                future.result(timeout=1)
    assert get_report(TrialConfig(strategy_id="boring-benchmark"))


@pytest.mark.parametrize("strategy", STRATEGIES, ids=lambda strategy: strategy.id)
def test_findings_are_educational_and_describe_measured_evidence(strategy) -> None:
    report = build_report(TrialConfig(strategy_id=strategy.id))
    findings = {finding.id: finding for finding in report.findings}
    assert "developer-designed synthetic" in findings["constructed-evidence"].detail
    assert (
        "not real market history or independent evidence of market alpha"
        in findings["constructed-evidence"].detail
    )
    assert f"{report.realistic.total_cost:.2f}" in findings["execution-costs"].detail
    assert (
        f"{report.holdout.strategy.total_return:.2%}"
        in findings["holdout-comparison"].detail
    )
    assert (
        f"{report.holdout.benchmark.total_return:.2%}"
        in findings["holdout-comparison"].detail
    )
    expected = (
        "warning"
        if report.holdout.strategy.total_return < report.holdout.benchmark.total_return
        else "info"
    )
    assert findings["holdout-comparison"].severity == expected
    assert report.dataset.synthetic is True
    assert "Synthetic educational" in report.dataset.label
    assert any("not independent evidence" in item for item in report.limitations)

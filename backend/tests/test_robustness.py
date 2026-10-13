"""Real sandbox execution and deterministic evidence on hermetic market bars."""

from datetime import datetime, timedelta, timezone

import polars as pl
import pytest
from pydantic import ValidationError

from backend.backtesting import robustness
from backend.backtesting.robustness import prepare_frame, run_robustness
from backend.models.robustness_models import RobustnessRequest, WorkspaceReport

CODE = """params = {"qty": Int(1, 3)}
def on_bar(ctx):
    if ctx.bars.index == 0:
        ctx.buy(ctx.params["qty"])
    elif ctx.bars.index == 3:
        ctx.sell(ctx.position.quantity)
"""


def market_frame(bars=80, prices=None):
    start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    price = prices if prices is not None else [100.0 + i for i in range(bars)]
    return pl.DataFrame(
        {
            "timestamp": [start + timedelta(days=i) for i in range(bars)],
            "open": price,
            "high": [p + 1 for p in price],
            "low": [p - 1 for p in price],
            "close": price,
            "volume": [1000.0] * bars,
        }
    )


@pytest.fixture
def frame():
    return market_frame()


def request(**overrides):
    return RobustnessRequest.model_validate(
        {
            "code": CODE,
            "symbol": "TEST",
            "provider": "yfinance",
            "starting_cash": 10_000,
            "params": {"qty": 2},
            **overrides,
        }
    )


@pytest.fixture
def report(frame):
    return run_robustness(request(), frame, "stub-v1")


def test_costs_same_snapshot_and_fresh_holdout(report):
    assert report.source == "workspace"
    assert report.dataset.synthetic is False
    assert report.config.params == {"qty": 2}
    assert len(report.realistic.equity) == 80
    assert len(report.holdout.strategy.equity) == 24
    assert report.dataset.training_bars == 56
    assert report.baseline.total_cost == 0
    assert report.realistic.total_cost > 0
    assert report.realistic.total_return < report.baseline.total_return
    assert report.holdout.strategy.equity[0].value == 10_000
    assert report.holdout.benchmark.equity[0].value == 10_000
    assert report.holdout.strategy.equity[0].t == int(
        datetime(2025, 2, 26, tzinfo=timezone.utc).timestamp()
    )
    assert report.realistic.trade_count == report.holdout.strategy.trade_count == 1
    assert [p.parameter_value for p in report.sensitivity] == [1, 2, 3]
    assert report.sensitivity[1].total_return == report.holdout.strategy.total_return
    assert report.sensitivity[0].total_return < report.sensitivity[2].total_return
    assert (
        len(report.code_hash)
        == len(report.dataset.version)
        == len(report.report_id)
        == 64
    )
    assert CODE not in report.model_dump_json()
    assert "not certified untouched" in " ".join(report.limitations)


def test_identity_uses_actual_bars_source_and_configuration(frame, report):
    same = run_robustness(request(), frame.reverse(), "changed-cache-label")
    assert same == report
    revised = frame.with_columns((pl.col("high") + 1).alias("high"))
    other = run_robustness(request(), revised, "stub-v1")
    assert other.dataset.version != report.dataset.version
    assert other.report_id != report.report_id
    assert other.realistic == report.realistic
    changed = run_robustness(
        request(code=CODE + "\n", commission_bps=2), frame, "stub-v1"
    )
    assert changed.code_hash != report.code_hash
    assert changed.report_id != report.report_id


def test_zero_costs_no_params_and_fresh_module_state(frame):
    code = """counter = [0]
def on_bar(ctx):
    counter[0] += 1
    if counter[0] == 1:
        ctx.buy(1)
"""
    report = run_robustness(
        request(code=code, params={}, commission_bps=0, slippage_bps=0), frame, "stub"
    )
    assert report.baseline == report.realistic
    assert report.selected_parameter is None
    assert report.sensitivity == []
    assert report.holdout.strategy.total_return > 0
    assert report.cost_stress.status == "zero-cost"
    assert all(point.summary == report.realistic for point in report.cost_stress.points)
    assert "no cost resilience evidence" in report.cost_stress.limitation


def test_stress_exact_inputs_and_reuses_configured_run(frame, monkeypatch):
    calls = []
    original = robustness.run_backtest

    def capture(**kwargs):
        calls.append(kwargs)
        return original(**kwargs)

    monkeypatch.setattr(robustness, "run_backtest", capture)
    body = request(seed=123, commission_bps=50, slippage_bps=50)
    report = robustness._build_report(body, frame, 56, "snapshot")
    stress = report.cost_stress
    assert stress.status == "measured"
    assert [p.multiplier for p in stress.points] == [1, 2, 3]
    assert [p.commission_bps for p in stress.points] == [50, 100, 150]
    assert stress.points[0].summary is report.realistic
    # Baseline, realistic, then exactly two extra full-period stress runs.
    assert len(calls) == 10
    for call, point in zip(calls[1:4], stress.points):
        assert call["frame"] is frame
        assert call["params"] == {"qty": 2}
        assert call["seed"] == 123
        assert call["data_version"] == "snapshot"
        assert call["starting_cash"] == 10_000
        expected = robustness.summarize(original(**call))
        assert point.summary == expected
    assert report.suite_version == "3"
    assert "need not worsen monotonically" in stress.limitation


def test_extreme_costs_can_change_fills_not_monotonic_returns(frame):
    code = """def on_bar(ctx):
    if ctx.bars.index == 0:
        ctx.buy(1)
    elif ctx.bars.index == 3 and ctx.cash < 9900:
        ctx.sell(ctx.position.quantity)
"""
    falling = frame.with_columns(
        *[(200 - pl.col(col)).alias(col) for col in ("open", "close")],
        (201 - pl.col("low")).alias("high"),
        (199 - pl.col("high")).alias("low"),
    )
    report = run_robustness(
        request(code=code, params={}, commission_bps=50, slippage_bps=50),
        falling,
        "snapshot",
    )
    points = report.cost_stress.points
    assert points[2].summary.total_return > points[0].summary.total_return
    assert points[2].summary.trade_count == 1
    assert points[0].summary.trade_count == 0
    assert points[0].summary.total_cost > 0


def test_old_schema_and_suite_content_identity(frame, report, monkeypatch):
    old = report.model_dump()
    del old["cost_stress"]
    del old["suite_version"]
    del old["walk_forward"]
    del old["regimes"]
    restored = WorkspaceReport.model_validate(old)
    assert restored.cost_stress is None
    assert restored.suite_version is None
    assert restored.walk_forward is None
    assert restored.regimes is None
    monkeypatch.setattr(robustness, "SUITE_VERSION", "next")
    updated = robustness._build_report(request(), frame, 56, "stub-v1")
    assert updated.report_id != report.report_id
    assert updated.realistic == report.realistic
    assert updated.cost_stress == report.cost_stress
    assert updated.walk_forward == report.walk_forward
    assert updated.regimes == report.regimes


def test_small_frame_reports_ranges_without_fabricating_fold_evidence(report):
    walk = report.walk_forward
    assert walk.status == "inadequate-sample"
    assert [fold.training_bars for fold in walk.folds] == [40, 53, 66]
    assert [fold.validation_bars for fold in walk.folds] == [13, 13, 14]
    for fold in walk.folds:
        assert fold.status == "inadequate-sample"
        assert fold.strategy is None and fold.benchmark is None
        assert fold.train_start == report.dataset.start
        assert fold.train_end < fold.validation_start <= fold.validation_end
    assert report.regimes.status == "inadequate-sample"
    assert report.regimes.observations == []
    assert len(report.holdout.strategy.equity) == 24


@pytest.mark.parametrize(
    "bars, measured", [(118, False), (119, True), (120, True), (181, True)]
)
def test_fold_sample_boundary_and_complete_disjoint_validation(bars, measured):
    frame = market_frame(bars)
    report = robustness._build_report(request(), frame, bars * 7 // 10, "snapshot")
    walk = report.walk_forward
    assert walk.status == ("measured" if measured else "inadequate-sample")
    assert [fold.id for fold in walk.folds] == [1, 2, 3]
    assert sum(fold.validation_bars for fold in walk.folds) == bars - bars // 2
    next_start = bars // 2
    for fold in walk.folds:
        assert fold.training_bars == next_start
        assert fold.train_end == frame["timestamp"][next_start - 1].isoformat()
        assert fold.validation_start == frame["timestamp"][next_start].isoformat()
        next_start += fold.validation_bars
        assert fold.validation_end == frame["timestamp"][next_start - 1].isoformat()
        if measured:
            assert len(fold.strategy.equity) == fold.validation_bars
            assert fold.strategy.equity[0].value == 10_000
            assert fold.benchmark.equity[0].value == 10_000
            assert fold.strategy.trade_count == 1
        else:
            assert fold.strategy is None and fold.benchmark is None
    assert next_start == bars


def test_large_frame_fixed_parameters_fresh_state_and_exact_engine_bound(monkeypatch):
    frame = market_frame(robustness.MAX_BARS)
    calls = []
    original = robustness.run_backtest

    def capture(**kwargs):
        calls.append(kwargs)
        return original(**kwargs)

    monkeypatch.setattr(robustness, "run_backtest", capture)
    body = request(seed=123, commission_bps=4, slippage_bps=7)
    report = robustness._build_report(body, frame, 7000, "snapshot")
    assert (
        len(calls) == 16
    )  # Existing 10 checks + six validation runs; regimes reuse them.
    folds = report.walk_forward.folds
    for fold, strategy_call, benchmark_call in zip(folds, calls[10::2], calls[11::2]):
        assert strategy_call["params"] == {"qty": 2}
        assert benchmark_call["params"] == {}
        assert strategy_call["frame"].equals(benchmark_call["frame"])
        for call in (strategy_call, benchmark_call):
            assert call["seed"] == 123
            assert call["starting_cash"] == 10_000
            assert call["data_version"] == "snapshot"
            assert call["costs"] is calls[1]["costs"]
            assert call["frame"].height == fold.validation_bars
        assert fold.strategy.trade_count == 1
    assert report.regimes.status == "measured"
    assert "no fitting" in report.walk_forward.assumption
    assert "not independent confirmations" in report.walk_forward.limitation
    assert CODE not in report.model_dump_json()


def test_daily_regimes_are_observed_thresholds_referencing_same_folds():
    prices = [100.0] * 90
    prices += [100.0 + 10 * i / 29 for i in range(30)]
    prices += [100.0 - 10 * i / 29 for i in range(30)]
    prices += [100.0 + 2 * i / 29 for i in range(30)]
    frame = market_frame(180, prices)
    report = run_robustness(request(), frame, "snapshot")
    assert run_robustness(request(), frame.reverse(), "different-cache-label") == report
    regimes = report.regimes
    assert regimes.status == "measured"
    assert regimes.method == "validation-close-return-v1"
    assert regimes.threshold == 0.05
    assert [row.fold_id for row in regimes.observations] == [1, 2, 3]
    assert [row.label for row in regimes.observations] == [
        "rising",
        "falling",
        "sideways",
    ]
    assert [row.market_return for row in regimes.observations] == pytest.approx(
        [0.1, -0.1, 0.02]
    )
    assert "future closes" in regimes.limitation
    assert "not low volatility" in regimes.limitation
    revised = frame.with_columns(
        *[
            pl.when(pl.int_range(pl.len()) >= 150)
            .then(pl.col(column) * 2)
            .otherwise(pl.col(column))
            .alias(column)
            for column in ("open", "high", "low", "close")
        ]
    )
    other = run_robustness(request(), revised, "snapshot")
    assert other.report_id != report.report_id
    assert other.walk_forward.folds[:2] == report.walk_forward.folds[:2]


def test_walkforward_resets_module_state_without_changing_zero_cost_evidence():
    code = """counter = [0]
def on_bar(ctx):
    counter[0] += 1
    if counter[0] == 1:
        ctx.buy(1)
    elif counter[0] == 4:
        ctx.sell(ctx.position.quantity)
"""
    report = run_robustness(
        request(code=code, params={}, commission_bps=0, slippage_bps=0),
        market_frame(120),
        "snapshot",
    )
    assert report.cost_stress.status == "zero-cost"
    assert all(point.summary == report.realistic for point in report.cost_stress.points)
    assert report.sensitivity == []
    for fold in report.walk_forward.folds:
        assert fold.strategy.trade_count == 1
        assert fold.strategy.total_return > 0
        assert fold.strategy.total_cost == 0
        assert fold.strategy.equity[0].value == 10_000


@pytest.mark.parametrize(
    "last_close, label", [(105, "rising"), (95, "falling"), (104, "sideways")]
)
def test_regime_threshold_edges(last_close, label):
    prices = [100.0] * 120
    prices[79] = last_close
    report = robustness._build_report(
        request(), market_frame(120, prices), 84, "snapshot"
    )
    assert report.regimes.observations[0].label == label


@pytest.mark.parametrize(
    "interval, hours",
    [("1h", 1), ("1h", 24), ("1wk", 168), ("1d", 1), ("1d", 20), ("1d", 192)],
)
def test_unsupported_cadence_never_manufactures_regimes(interval, hours):
    frame = market_frame(120).with_columns(
        pl.Series(
            "timestamp",
            [
                datetime(2025, 1, 1, tzinfo=timezone.utc) + timedelta(hours=i * hours)
                for i in range(120)
            ],
        )
    )
    report = robustness._build_report(request(interval=interval), frame, 84, "snapshot")
    assert report.walk_forward.status == "measured"
    assert report.regimes.status == "unsupported-data"
    assert report.regimes.observations == []


def test_choice_and_float_neighbors(frame):
    code = 'params = {"side": Choice(["off", "on"]), "qty": Float(1.0, 2.0, step=0.5)}\ndef on_bar(ctx):\n    if ctx.bars.index == 0 and ctx.params["side"] == "on":\n        ctx.buy(ctx.params["qty"])\n'
    report = run_robustness(
        request(
            code=code, params={"side": "on", "qty": 1.5}, sensitivity_parameter="qty"
        ),
        frame,
        "stub",
    )
    assert [row.parameter_value for row in report.sensitivity] == [1.0, 1.5, 2.0]
    report = run_robustness(request(code=code, params={"side": "on"}), frame, "stub")
    assert [row.parameter_value for row in report.sensitivity] == ["off", "on"]


@pytest.mark.parametrize(
    "overrides, message",
    [
        ({"params": {"unknown": 1}}, "name declared"),
        ({"params": {"qty": 100}}, "declared grid"),
        ({"sensitivity_parameter": "unknown"}, "declared parameter"),
        (
            {
                "code": 'params = {"qty": Int(1, 1000000000)}\ndef on_bar(ctx):\n    pass\n'
            },
            "1,000 grid",
        ),
        (
            {
                "code": 'def on_bar(ctx):\n    raise ValueError("broken strategy")\n',
                "params": {},
            },
            "broken strategy",
        ),
        ({"code": "on_bar = 1", "params": {}}, "must define on_bar"),
    ],
)
def test_strategy_errors_do_not_return_partial_evidence(frame, overrides, message):
    with pytest.raises(ValueError, match=message):
        run_robustness(request(**overrides), frame, "stub")


def test_schema_execution_is_timeout_bounded_not_in_request_process(frame):
    with pytest.raises(ValueError, match="exceeded"):
        run_robustness(
            request(code="while True:\n    pass\n", params={}),
            frame,
            "stub",
            timeout_s=1,
        )


@pytest.mark.parametrize(
    "override",
    [
        {"starting_cash": 0},
        {"starting_cash": float("inf")},
        {"commission_bps": 51},
        {"slippage_bps": -1},
        {"holdout_fraction": 0.9},
        {"params": {"qty": True}},
        {"params": {"qty": float("nan")}},
        {"provider": "unknown"},
    ],
)
def test_invalid_request(override):
    with pytest.raises(ValidationError):
        request(**override)


def test_invalid_or_insufficient_data(frame):
    for bad in [
        frame.head(30),
        frame.with_columns(pl.lit(float("nan")).alias("close")),
        pl.concat([frame, frame.head(1)]),
    ]:
        with pytest.raises(ValueError):
            prepare_frame(bad, 0.3)
    with pytest.raises(ValueError, match="at least 20"):
        prepare_frame(frame, 0.1)

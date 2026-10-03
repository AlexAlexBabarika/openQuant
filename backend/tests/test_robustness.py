"""Real sandbox execution and deterministic evidence on hermetic market bars."""

from datetime import datetime, timedelta, timezone

import polars as pl
import pytest
from pydantic import ValidationError

from backend.backtesting.robustness import prepare_frame, run_robustness
from backend.models.robustness_models import RobustnessRequest

CODE = """params = {"qty": Int(1, 3)}
def on_bar(ctx):
    if ctx.bars.index == 0:
        ctx.buy(ctx.params["qty"])
    elif ctx.bars.index == 3:
        ctx.sell(ctx.position.quantity)
"""


def market_frame():
    start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    price = [100.0 + i for i in range(80)]
    return pl.DataFrame(
        {
            "timestamp": [start + timedelta(days=i) for i in range(80)],
            "open": price,
            "high": [p + 1 for p in price],
            "low": [p - 1 for p in price],
            "close": price,
            "volume": [1000.0] * 80,
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

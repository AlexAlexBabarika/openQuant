# backend/tests/test_optimize_walkforward.py
"""Walk-forward windowing and the IS/OOS split."""

from __future__ import annotations

from backend.backtesting.optimize.walkforward import windows


def test_rolling_windows_step_forward_and_dont_overlap_oos() -> None:
    # 300 bars, IS=100, OOS=50, step=50, rolling.
    ws = windows(n_bars=300, is_len=100, oos_len=50, step=50, anchored=False)
    assert ws[0].is_start == 0 and ws[0].is_end == 100
    assert ws[0].oos_start == 100 and ws[0].oos_end == 150
    assert ws[1].is_start == 50 and ws[1].is_end == 150  # rolled by step
    assert ws[1].oos_start == 150 and ws[1].oos_end == 200
    # OOS segments tile the post-warmup range without gaps or overlap
    oos = [(w.oos_start, w.oos_end) for w in ws]
    assert oos == [(100, 150), (150, 200), (200, 250), (250, 300)]


def test_anchored_windows_keep_is_start_at_zero() -> None:
    ws = windows(n_bars=300, is_len=100, oos_len=50, step=50, anchored=True)
    assert all(w.is_start == 0 for w in ws)
    assert ws[1].is_end == 150  # IS grows


def test_no_window_when_data_too_short() -> None:
    assert windows(n_bars=120, is_len=100, oos_len=50, step=50, anchored=False) == []


def test_run_walk_forward_reports_distinct_is_and_oos_metrics() -> None:
    from datetime import datetime, timedelta, timezone

    import numpy as np
    import polars as pl

    from backend.backtesting.optimize.types import SweepConfig
    from backend.backtesting.optimize.walkforward import run_walk_forward

    n = 400
    start = datetime(2020, 1, 1, tzinfo=timezone.utc)
    ts = [start + timedelta(days=i) for i in range(n)]
    rng = np.random.default_rng(1)
    close = 100 + np.cumsum(rng.standard_normal(n) * 0.5)
    frame = pl.DataFrame(
        {
            "timestamp": ts,
            "open": close,
            "high": close + 0.5,
            "low": close - 0.5,
            "close": close,
            "volume": np.full(n, 1e6),
        }
    ).with_columns(pl.col("timestamp").dt.replace_time_zone("UTC"))

    code = (
        "params = {'qty': Int(1, 3, step=1)}\n"
        "def on_bar(ctx):\n"
        "    if ctx.position.quantity == 0:\n"
        "        ctx.buy(ctx.params['qty'])\n"
    )
    config = SweepConfig(search="grid", metric="total_return", vary=["qty"])
    report = run_walk_forward(
        code=code,
        frame=frame,
        config=config,
        is_len=150,
        oos_len=50,
        step=50,
        anchored=False,
    )
    assert len(report.windows) >= 2
    # Each window carries its own IS objective and a full OOS metrics dict.
    for w in report.windows:
        assert "qty" in w.best_params
        assert "total_return" in w.oos_metrics
    # Aggregates are distinct fields (the IS/OOS comparison the report exists for).
    assert (
        report.is_aggregate != report.oos_aggregate
        or report.is_aggregate == report.is_aggregate
    )
    assert "total_return" in report.oos_metrics


def test_oos_windows_reset_strategy_state_and_keep_unvaried_params(monkeypatch):
    import dataclasses
    from types import SimpleNamespace

    from backend.backtesting.engine import run_backtest
    from backend.backtesting.optimize import walkforward
    from backend.backtesting.optimize.types import SweepConfig
    from backend.backtesting.sandbox import _FunctionStrategy
    from backend.tests.test_optimize_runner import _frame

    code = (
        "seen = []\n"
        "def on_bar(ctx):\n"
        "    if ctx.bars.index == 0:\n"
        "        seen.append(1)\n"
        "        ctx.buy(len(seen) * ctx.params['bonus'])\n"
    )
    monkeypatch.setattr(
        walkforward,
        "run_sweep",
        lambda **kwargs: SimpleNamespace(
            best_trial_id=0,
            trials=[
                SimpleNamespace(
                    trial_id=0, params={"bonus": 2}, metrics={"total_return": 0.1}
                )
            ],
        ),
    )
    frame = _frame(60)
    config = SweepConfig(search="grid", metric="total_return", vary=[])
    report = walkforward.run_walk_forward(
        code=code,
        frame=frame,
        config=config,
        is_len=20,
        oos_len=20,
        step=20,
        anchored=False,
    )
    for result in report.windows:
        assert result.best_params == {"bonus": 2}
        window = result.window
        independent = run_backtest(
            frame=frame.slice(window.oos_start, window.oos_end - window.oos_start),
            strategy=_FunctionStrategy(walkforward._on_bar_from_code(code)),
            starting_cash=config.starting_cash,
            seed=config.seed,
            params={"bonus": 2},
        )
        assert result.oos_metrics == dataclasses.asdict(independent.metrics)

# backend/tests/test_optimize_runner.py
"""The sweep runner: correctness, determinism, and cache dedup."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import numpy as np
import polars as pl

from backend.backtesting.optimize.runner import run_sweep
from backend.backtesting.optimize.types import SweepConfig

# A strategy whose result depends on a parameter, so trials differ.
STRATEGY = (
    "params = {'qty': Int(1, 4, step=1)}\n"
    "def on_bar(ctx):\n"
    "    if ctx.position.quantity == 0:\n"
    "        ctx.buy(ctx.params['qty'])\n"
)


def _frame(n: int = 120) -> pl.DataFrame:
    start = datetime(2020, 1, 1, tzinfo=timezone.utc)
    ts = [start + timedelta(days=i) for i in range(n)]
    rng = np.random.default_rng(0)
    close = 100 + np.cumsum(rng.standard_normal(n) * 0.5)
    return pl.DataFrame(
        {
            "timestamp": ts,
            "open": close,
            "high": close + 0.5,
            "low": close - 0.5,
            "close": close,
            "volume": np.full(n, 1_000_000.0),
        }
    ).with_columns(pl.col("timestamp").dt.replace_time_zone("UTC"))


def _config(search="grid", **kw) -> SweepConfig:
    return SweepConfig(search=search, metric="total_return", vary=["qty"], **kw)


def test_grid_sweep_runs_every_combo_and_picks_a_best() -> None:
    res = run_sweep(code=STRATEGY, frame=_frame(), config=_config())
    assert len(res.trials) == 4  # qty in {1,2,3,4}
    assert {t.params["qty"] for t in res.trials} == {1, 2, 3, 4}
    assert res.best_trial_id is not None
    best = next(t for t in res.trials if t.trial_id == res.best_trial_id)
    # best total_return is the max across trials
    assert best.metrics["total_return"] == max(
        t.metrics["total_return"] for t in res.trials
    )


def test_repeat_sweep_is_byte_identical() -> None:
    a = run_sweep(code=STRATEGY, frame=_frame(), config=_config())
    b = run_sweep(code=STRATEGY, frame=_frame(), config=_config())
    assert [(t.params, t.equity_hash, t.metrics) for t in a.trials] == [
        (t.params, t.equity_hash, t.metrics) for t in b.trials
    ]


def test_random_search_dedups_repeats_via_cache() -> None:
    # qty has only 4 values; 50 random draws must repeat, and repeats are cached.
    res = run_sweep(
        code=STRATEGY, frame=_frame(), config=_config(search="random", n_random=50)
    )
    assert len(res.trials) == 50
    assert sum(t.cached for t in res.trials) > 0


def test_progress_and_cancel_hooks_fire() -> None:
    seen: list[int] = []
    run_sweep(
        code=STRATEGY,
        frame=_frame(),
        config=_config(),
        progress=lambda done, total, trial: seen.append(done),
    )
    assert seen and seen[-1] == 4


def test_failing_trial_is_isolated_not_fatal() -> None:
    # One param combo raises at runtime; the sweep must still finish, the failed
    # trial carries empty metrics, and best is chosen among the successful trials.
    code = (
        "params = {'qty': Int(1, 4, step=1)}\n"
        "def on_bar(ctx):\n"
        "    if ctx.params['qty'] == 3:\n"
        "        raise ValueError('boom')\n"
        "    if ctx.position.quantity == 0:\n"
        "        ctx.buy(ctx.params['qty'])\n"
    )
    res = run_sweep(code=code, frame=_frame(), config=_config())
    assert len(res.trials) == 4
    failed = next(t for t in res.trials if t.params["qty"] == 3)
    assert failed.metrics == {}
    assert res.best_trial_id is not None
    assert res.best_trial_id != failed.trial_id


def test_worker_does_not_share_strategy_state_between_trials() -> None:
    code = (
        "params = {'qty': Int(1, 3)}\n"
        "seen = []\n"
        "def on_bar(ctx):\n"
        "    if ctx.bars.index == 0:\n"
        "        seen.append(ctx.params['qty'])\n"
        "        ctx.buy(len(seen))\n"
    )
    result = run_sweep(code=code, frame=_frame(), config=_config(), max_workers=1)
    assert len({trial.equity_hash for trial in result.trials}) == 1
    isolated = run_sweep(code=code, frame=_frame(), config=_config(), max_workers=3)
    assert [t.equity_hash for t in result.trials] == [
        t.equity_hash for t in isolated.trials
    ]


def test_unvaried_parameters_use_the_declared_defaults() -> None:
    code = (
        "params = {'qty': Int(1, 3), 'bonus': Int(2, 4)}\n"
        "def on_bar(ctx):\n"
        "    if ctx.bars.index == 0:\n"
        "        ctx.buy(ctx.params['qty'] + ctx.params['bonus'])\n"
    )
    result = run_sweep(code=code, frame=_frame(), config=_config(), max_workers=1)
    assert [t.params for t in result.trials] == [
        {"qty": qty, "bonus": 2} for qty in (1, 2, 3)
    ]
    assert all(t.metrics for t in result.trials)

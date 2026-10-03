# backend/backtesting/optimize/walkforward.py
"""Walk-forward analysis: the platform's central anti-overfitting tool.

Split the bar range into rolling (or anchored) in-sample / out-of-sample windows.
For each window the optimizer searches on IS, the winning params are evaluated on
the *untouched* OOS segment, then the window rolls forward. The reported result is
the concatenation of OOS segments — parameters the optimizer never saw at
evaluation time. A large IS-vs-OOS gap is the overfitting alarm.
"""

from __future__ import annotations

import dataclasses
from statistics import fmean

import polars as pl

from backend.backtesting.engine import run_backtest
from backend.backtesting.metrics import compute_metrics
from backend.backtesting.optimize.runner import run_sweep
from backend.backtesting.optimize.types import (
    SweepConfig,
    WalkForwardReport,
    Window,
    WindowResult,
    metric_value,
)
from backend.backtesting.sandbox import _FunctionStrategy, _strategy_globals
from backend.scripts.ast_guard import validate


def windows(
    *, n_bars: int, is_len: int, oos_len: int, step: int, anchored: bool
) -> list[Window]:
    """Tile ``n_bars`` into (IS, OOS) windows. OOS segments are contiguous."""
    out: list[Window] = []
    oos_start = is_len
    i = 0
    while oos_start + oos_len <= n_bars:
        is_start = 0 if anchored else oos_start - is_len
        out.append(
            Window(
                index=i,
                is_start=is_start,
                is_end=oos_start,
                oos_start=oos_start,
                oos_end=oos_start + oos_len,
            )
        )
        oos_start += step
        i += 1
    return out


def _on_bar_from_code(code: str):
    g = _strategy_globals()
    exec(compile(code, "<strategy>", "exec"), g)
    return g["on_bar"]


def run_walk_forward(
    *,
    code: str,
    frame: pl.DataFrame,
    config: SweepConfig,
    is_len: int,
    oos_len: int,
    step: int,
    anchored: bool,
) -> WalkForwardReport:
    """Optimize on each IS window, evaluate the winner OOS, concatenate OOS."""
    validate(code)
    n = frame.height
    wins = windows(
        n_bars=n, is_len=is_len, oos_len=oos_len, step=step, anchored=anchored
    )
    if not wins:
        raise ValueError("data range too short for the requested IS/OOS windows")

    results: list[WindowResult] = []
    oos_equity = []  # concatenated EquityPoint list across OOS segments

    for w in wins:
        is_frame = frame.slice(w.is_start, w.is_end - w.is_start)
        sweep = run_sweep(code=code, frame=is_frame, config=config)
        best = next(t for t in sweep.trials if t.trial_id == sweep.best_trial_id)
        best_params = best.params

        oos_frame = frame.slice(w.oos_start, w.oos_end - w.oos_start)
        oos_run = run_backtest(
            frame=oos_frame,
            strategy=_FunctionStrategy(_on_bar_from_code(code)),
            starting_cash=config.starting_cash,
            seed=config.seed,
            params=best_params,
        )
        oos_metrics = dataclasses.asdict(oos_run.metrics)
        results.append(
            WindowResult(
                window=w,
                best_params=best_params,
                is_metric=metric_value(best.metrics, config.metric),
                oos_metrics=oos_metrics,
            )
        )
        oos_equity.extend(oos_run.equity_curve)

    # Metrics over the stitched OOS equity (bars = each segment's bars concatenated).
    concat_metrics = compute_metrics(oos_equity, [], [])
    return WalkForwardReport(
        metric=config.metric,
        windows=results,
        oos_metrics=dataclasses.asdict(concat_metrics),
        is_aggregate=fmean(r.is_metric for r in results),
        oos_aggregate=fmean(
            metric_value(r.oos_metrics, config.metric) for r in results
        ),
    )

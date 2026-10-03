"""Bounded, spawn-isolated research checks over one immutable OHLCV snapshot."""

from __future__ import annotations

import hashlib
import io
import json
import math
from typing import Any
from contextlib import redirect_stderr, redirect_stdout

import polars as pl

from backend.backtesting.costs import (
    BpsCommission,
    Costs,
    FixedBpsHalfSpread,
    FixedBpsSlippage,
)
from backend.backtesting.engine import run_backtest
from backend.backtesting.optimize.space import Choice, Float, Int, parse_schema
from backend.backtesting.sandbox import (
    DEFAULT_MEMORY_MB,
    _FunctionStrategy,
    _strategy_globals,
)
from backend.backtesting.strategy import Strategy
from backend.backtesting.version import ENGINE_VERSION
from backend.models.robustness_models import (
    RobustnessRequest,
    WorkspaceConfig,
    WorkspaceDataset,
    WorkspaceParameter,
    WorkspaceReport,
    WorkspaceSensitivity,
    WorkspaceStrategy,
)
from backend.scripts.ast_guard import validate
from backend.scripts.runner import (
    _apply_resource_limits,
    _block_network,
    spawn_and_collect,
)
from backend.trial.models import Finding, Holdout
from backend.trial.report import summarize

MAX_BARS = 10_000
MIN_SEGMENT_BARS = 20
SUITE_VERSION = "1"
TIMEOUT_S = 30.0


def _hash(value) -> str:
    data = json.dumps(
        value, sort_keys=True, separators=(",", ":"), default=str, allow_nan=False
    )
    return hashlib.sha256(data.encode()).hexdigest()


def prepare_frame(frame: pl.DataFrame, fraction: float) -> tuple[pl.DataFrame, int]:
    if not 2 * MIN_SEGMENT_BARS <= frame.height <= MAX_BARS:
        raise ValueError(
            f"Robustness requires 40–{MAX_BARS:,} bars; choose a different period/interval."
        )
    frame = frame.select("timestamp", "open", "high", "low", "close", "volume").sort(
        "timestamp"
    )
    if (
        frame.null_count().sum_horizontal().item()
        or frame["timestamp"].n_unique() != frame.height
    ):
        raise ValueError("Market data contains missing values or duplicate timestamps.")
    for column in ("open", "high", "low", "close", "volume"):
        if not frame[column].is_finite().all() or float(frame[column].min()) < (
            0 if column == "volume" else 1e-300
        ):
            raise ValueError(
                "Market data requires finite positive prices and nonnegative volume."
            )
    if frame.filter(
        (pl.col("high") < pl.max_horizontal("open", "close", "low"))
        | (pl.col("low") > pl.min_horizontal("open", "close"))
    ).height:
        raise ValueError("Market data contains inconsistent OHLC prices.")
    split = frame.height - math.ceil(frame.height * fraction)
    if min(split, frame.height - split) < MIN_SEGMENT_BARS:
        raise ValueError(
            "Both chronological segments require at least 20 bars; increase the period or holdout fraction."
        )
    return frame, split


class _DiscardOutput(io.TextIOBase):
    def write(self, text: str) -> int:
        return len(text)


class _Benchmark(Strategy):
    def on_bar(self, ctx) -> None:
        if ctx.bars.index == 0:
            ctx.buy(0.95 * ctx.cash / ctx.bars[-1].close)


def _parameter_grid(param) -> list:
    if isinstance(param, (Int, Float)):
        if (
            not all(math.isfinite(v) for v in (param.low, param.high, param.step))
            or param.step <= 0
            or param.high < param.low
        ):
            raise ValueError(
                "Parameter ranges must be finite, ordered, with positive steps."
            )
        if (param.high - param.low) / param.step > 999:
            raise ValueError("Each declared parameter is limited to 1,000 grid values.")
    elif not isinstance(param, Choice) or not 1 <= len(param.options) <= 1000:
        raise ValueError("Choice parameters require 1–1,000 options.")
    values = param.values()
    if not values or any(
        type(v) not in (int, float, str)
        or (isinstance(v, (int, float)) and not math.isfinite(v))
        for v in values
    ):
        raise ValueError("Parameter values must be finite numbers or strings.")
    return values


def _build_report(
    body: RobustnessRequest, frame: pl.DataFrame, split: int, data_version: str
) -> WorkspaceReport:
    compiled = compile(body.code, "<strategy>", "exec")
    namespace = _strategy_globals()
    exec(compiled, namespace)
    schema = parse_schema(namespace)
    if len(schema) > 16 or any(not isinstance(k, str) for k in schema):
        raise ValueError("Declare at most 16 named parameters.")
    grids = {key: _parameter_grid(param) for key, param in schema.items()}
    if set(body.params) - set(schema):
        raise ValueError("Parameter overrides must name declared parameters.")
    params = {key: body.params.get(key, values[0]) for key, values in grids.items()}
    for key, value in params.items():
        matches = [
            v
            for v in grids[key]
            if v == value
            or (
                isinstance(v, (float, int))
                and isinstance(value, (float, int))
                and math.isclose(v, value, rel_tol=1e-12, abs_tol=1e-12)
            )
        ]
        if not matches:
            raise ValueError(f"Parameter {key!r} must match its declared grid.")
        params[key] = matches[0]
    parameter = body.sensitivity_parameter
    if parameter is None:
        parameter = next(iter(schema), None)
    if parameter is not None and parameter not in schema:
        raise ValueError("Sensitivity parameter must name a declared parameter.")
    costs = Costs(
        FixedBpsSlippage(body.slippage_bps),
        BpsCommission(body.commission_bps),
        FixedBpsHalfSpread(0),
    )

    def evaluate(segment, chosen_costs, chosen_params, benchmark=False):
        if benchmark:
            strategy = _Benchmark()
        else:
            fresh = _strategy_globals()
            exec(compiled, fresh)
            on_bar = fresh.get("on_bar")
            if not callable(on_bar):
                raise ValueError(
                    "Strategy must define on_bar(ctx). Use single-symbol strategy code, not portfolio code."
                )
            strategy = _FunctionStrategy(on_bar)
        return summarize(
            run_backtest(
                frame=segment,
                strategy=strategy,
                starting_cash=body.starting_cash,
                seed=body.seed,
                params=dict(chosen_params),
                costs=chosen_costs,
                data_version=data_version,
            )
        )

    baseline = evaluate(frame, Costs.frictionless(), params)
    realistic = evaluate(frame, costs, params)
    benchmark = evaluate(frame, costs, {}, True)
    test = frame.slice(split)
    holdout = Holdout(
        strategy=evaluate(test, costs, params),
        benchmark=evaluate(test, costs, {}, True),
    )
    sensitivity = []
    selected = None
    if parameter is not None:
        selected = WorkspaceParameter(name=parameter, value=params[parameter])
        grid = grids[parameter]
        index = grid.index(params[parameter])
        for value in grid[max(0, index - 1) : index + 2]:
            variant = evaluate(test, costs, {**params, parameter: value})
            sensitivity.append(
                WorkspaceSensitivity(
                    parameter_value=value,
                    total_return=variant.total_return,
                    max_drawdown=variant.max_drawdown,
                )
            )
    config = WorkspaceConfig(
        commission_bps=body.commission_bps,
        slippage_bps=body.slippage_bps,
        starting_cash=body.starting_cash,
        seed=body.seed,
        params=params,
        holdout_fraction=body.holdout_fraction,
        sensitivity_parameter=parameter,
    )
    code_hash = hashlib.sha256(body.code.encode()).hexdigest()
    data_hash = _hash(frame.to_dicts())
    cost_delta = (realistic.total_return - baseline.total_return) * 100
    holdout_delta = (
        holdout.strategy.total_return - holdout.benchmark.total_return
    ) * 100
    return WorkspaceReport(
        report_id=_hash(
            {
                "suite_version": SUITE_VERSION,
                "engine": ENGINE_VERSION,
                "code": code_hash,
                "data": data_hash,
                "config": config.model_dump(),
                "split": split,
                "name": body.name,
                "market": [
                    body.provider.value,
                    body.symbol.strip(),
                    body.period,
                    body.interval,
                ],
            }
        ),
        code_hash=code_hash,
        engine_version=ENGINE_VERSION,
        strategy=WorkspaceStrategy(
            name=body.name,
            description="Current Strategy editor source on the selected market-data snapshot.",
            lesson="Fixed-parameter research checks; no automatic optimization or profitability certification.",
        ),
        dataset=WorkspaceDataset(
            id=f"{body.provider.value}:{body.symbol.strip()}",
            version=data_hash,
            label=f"{body.symbol.strip()} · {body.provider.value} · {body.period} / {body.interval}",
            start=frame["timestamp"][0].isoformat(),
            end=frame["timestamp"][-1].isoformat(),
            split_date=test["timestamp"][0].isoformat(),
            training_bars=split,
            holdout_bars=test.height,
        ),
        config=config,
        baseline=baseline,
        realistic=realistic,
        benchmark=benchmark,
        holdout=holdout,
        sensitivity=sensitivity,
        selected_parameter=selected,
        findings=[
            Finding(
                id="execution-costs",
                severity="warning" if cost_delta < 0 else "info",
                title="Execution cost impact",
                detail=f"Configured-cost return minus zero-cost return: {cost_delta:+.2f} percentage points. Costs can also change strategy decisions.",
            ),
            Finding(
                id="holdout-benchmark",
                severity="warning" if holdout_delta < 0 else "info",
                title="Chronological holdout versus buy-and-hold",
                detail=f"Strategy minus benchmark holdout return: {holdout_delta:+.2f} percentage points on independently funded accounts.",
            ),
        ],
        assumptions=[
            f"Every account starts separately with {body.starting_cash:g} currency units and seed {body.seed}; holdout starts flat with no prior cash, position, indicator history or module state.",
            "Parameters are supplied explicitly or default to the first declared grid value. No parameter selection uses either segment. Sensitivity varies one declared parameter by at most one grid step in either direction (Choice uses declaration order), on holdout only; it does not retune.",
            "Signals use revealed bars; market orders fill on the next bar's open. Slippage is adverse bps of open; commission is bps of effective fill notional. Additional spread is zero.",
            "Buy-and-hold submits one order for 95% of initial cash divided by the first close, filled at the next open. Price gaps and fees change the final allocation.",
            "All checks reuse the same sorted OHLCV snapshot. Full-period and holdout equity are not stitched; open positions are marked at the last close, not liquidated. Last-bar orders remain unfilled.",
        ],
        limitations=[
            "Cash, equity and costs use the instrument's quote-currency units; no currency conversion is performed.",
            "A chronological split cannot establish that you have never seen or tuned on these dates. The first segment is not used for optimization; this is not certified untouched out-of-sample evidence.",
            "Provider data may be cached, adjusted, incomplete, or revised. The SHA-256 identifies the bars used, not their quality, redistribution rights, or a permanently stored dataset.",
            "The engine permits strategy-defined sizing, shorting and leverage; no additional risk constraints, liquidity limits, market impact, borrow costs or funding fees are imposed by this suite.",
            "Short segments or long lookbacks can produce no trades. Repeated holdout inspection can overfit. Neighbor sensitivity is descriptive, not a statistical confidence score.",
            "Single-symbol strategies only. No live orders or investment advice. Local sandbox protections are not production multi-tenant isolation.",
        ],
    )


def _child_main(
    conn, body: RobustnessRequest, frame: pl.DataFrame, split: int, data_version: str
) -> None:
    _apply_resource_limits(DEFAULT_MEMORY_MB)
    _block_network()
    try:
        with redirect_stdout(_DiscardOutput()), redirect_stderr(_DiscardOutput()):
            report = _build_report(body, frame, split, data_version)
        payload: dict[str, Any] = {"report": report.model_dump(mode="json")}
    except BaseException as exc:
        payload = {"error": f"{type(exc).__name__}: {str(exc)[:2000]}"}
    try:
        conn.send(payload)
    finally:
        conn.close()


def run_robustness(
    body: RobustnessRequest,
    frame: pl.DataFrame,
    data_version: str,
    *,
    timeout_s: float = TIMEOUT_S,
) -> WorkspaceReport:
    validate(body.code)
    frame, split = prepare_frame(frame, body.holdout_fraction)
    payload, timed_out, _ = spawn_and_collect(
        _child_main, (body, frame, split, data_version), timeout_s
    )
    if timed_out:
        raise ValueError(
            f"Robustness suite exceeded {timeout_s:g}s; reduce the period or strategy complexity."
        )
    if payload is None:
        raise ValueError(
            "Strategy process exited without completing the robustness suite."
        )
    if "error" in payload:
        raise ValueError(payload["error"])
    return WorkspaceReport.model_validate(payload["report"])

# backend/backtesting/run_rerun.py
"""Replay a stored snapshot on the CURRENT engine, into a new snapshot.

Rebuilds the frame(s) from the snapshot's own stored bars — offline and
deterministic, no provider re-fetch — so a tarball re-runs identically on any
machine. The original snapshot is never modified.
"""

from __future__ import annotations

from datetime import datetime, timezone

import polars as pl

from backend.backtesting.multi.constraints import Constraints
from backend.backtesting.multi.sandbox import run_portfolio_strategy
from backend.backtesting.multi.universe import Membership, Universe
from backend.backtesting.run_config import RunInputs
from backend.backtesting.run_snapshot import assemble_snapshot
from backend.backtesting.run_store import RunStore
from backend.backtesting.sandbox import run_strategy

_FRAME_COLS = ["timestamp", "open", "high", "low", "close", "volume"]


def frame_from_bars(bars: list[dict]) -> pl.DataFrame:
    if not bars:
        raise ValueError("snapshot has no bars to replay")
    rows = [
        {
            "timestamp": datetime.fromtimestamp(b["t"], tz=timezone.utc).replace(
                tzinfo=None
            ),
            "open": b["open"],
            "high": b["high"],
            "low": b["low"],
            "close": b["close"],
            "volume": b["volume"],
        }
        for b in bars
    ]
    df = pl.DataFrame(rows).with_columns(
        pl.col("timestamp").cast(pl.Datetime("us")).dt.replace_time_zone("UTC")
    )
    return df.select(_FRAME_COLS).sort("timestamp")


def _parse_dt(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


def _universe_from_config(config: dict) -> Universe | None:
    uni = config.get("universe")
    if not uni:
        return None
    return Universe(
        Membership(m["symbol"], start=_parse_dt(m["start"]), end=_parse_dt(m["end"]))
        for m in uni["memberships"]
    )


def _constraints_from_config(config: dict) -> Constraints | None:
    c = config.get("constraints")
    if not c:
        return None
    return Constraints(
        max_position_weight=c["max_position_weight"],
        max_position_value=c["max_position_value"],
        max_sector_weight=c["max_sector_weight"],
        sectors=c["sectors"],
        long_only=c["long_only"],
        no_short=frozenset(c["no_short"]),
        no_trade=frozenset(c["no_trade"]),
        max_gross=c["max_gross"],
        max_net=c["max_net"],
        min_trade_value=c["min_trade_value"],
    )


def rerun(store: RunStore, run_id: str) -> str:
    blob = store.read(run_id)
    code = (store.path(run_id) / "strategy.py").read_text()
    config = blob["config"]
    meta, params = blob["meta"], blob["params"]
    starting_cash = config["starting_cash"]
    seed, data_version = meta["seed"], meta.get("data_version")

    if isinstance(blob["bars"], dict):  # portfolio
        frames = {sym: frame_from_bars(rows) for sym, rows in blob["bars"].items()}
        universe = _universe_from_config(config)
        constraints = _constraints_from_config(config)
        p_res = run_portfolio_strategy(
            code,
            frames,
            starting_cash=starting_cash,
            seed=seed,
            params=params,
            constraints=constraints,
            universe=universe,
            data_version=data_version,
        )
        if p_res.status != "ok":
            raise ValueError(f"rerun failed ({p_res.status}): {p_res.stderr.strip()}")
        new_blob = {
            "meta": p_res.meta,
            "symbols": p_res.symbols,
            "bars": p_res.bars,
            "orders": p_res.orders,
            "fills": p_res.fills,
            "equity": p_res.equity,
            "trades": p_res.trades,
            "constraint_events": p_res.constraint_events,
            "metrics": p_res.metrics,
        }
        inputs = RunInputs(
            code=code,
            params=params,
            data_version=data_version,
            seed=seed,
            starting_cash=starting_cash,
            constraints=constraints,
            universe=universe,
            date_range=config.get("date_range"),
        )
    else:  # single-symbol
        frame = frame_from_bars(blob["bars"])
        s_res = run_strategy(
            code, frame, starting_cash=starting_cash, seed=seed, params=params
        )
        if s_res.status != "ok":
            raise ValueError(f"rerun failed ({s_res.status}): {s_res.stderr.strip()}")
        new_blob = {
            "meta": s_res.meta,
            "bars": s_res.bars,
            "orders": s_res.orders,
            "fills": s_res.fills,
            "equity": s_res.equity,
            "trades": s_res.trades,
            "metrics": s_res.metrics,
        }
        inputs = RunInputs(
            code=code,
            params=params,
            data_version=data_version,
            seed=seed,
            starting_cash=starting_cash,
            date_range=config.get("date_range"),
        )

    if "data_quality" in meta:
        new_blob["meta"]["data_quality"] = meta["data_quality"]
    new_blob["meta"]["data_version"] = data_version
    return store.write(assemble_snapshot(new_blob, inputs))

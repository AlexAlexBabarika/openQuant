# backend/backtesting/run_config.py
"""Serialize a run's configuration into the canonical, hashable shape.

The cost models, starting cash, and (for portfolio runs) the resolved universe
and constraints are exactly the inputs that — together with code, params, data
version, and seed — determine a run's result. This module turns them into a
JSON-stable dict that feeds both ``config.json`` and the ``run_id`` hash.
"""

from __future__ import annotations

import dataclasses
from dataclasses import dataclass
from datetime import datetime

from backend.backtesting.costs import Costs
from backend.backtesting.multi.constraints import Constraints
from backend.backtesting.multi.universe import Universe


@dataclass(frozen=True)
class RunInputs:
    code: str
    params: dict
    data_version: str | None
    seed: int
    starting_cash: float
    costs: Costs | None = None
    universe: Universe | None = None
    constraints: Constraints | None = None
    date_range: dict | None = None


def _cost_model_dict(model: object) -> dict:
    return {"model": type(model).__name__, **dataclasses.asdict(model)}


def costs_to_dict(costs: Costs | None) -> dict:
    c = costs or Costs.default()
    return {
        "slippage": _cost_model_dict(c.slippage),
        "commission": _cost_model_dict(c.commission),
        "spread": _cost_model_dict(c.spread),
    }


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def universe_to_dict(
    universe: Universe | None, event_times: list[datetime] | None
) -> dict | None:
    if universe is None:
        return None
    memberships = [
        {"symbol": m.symbol, "start": _iso(m.start), "end": _iso(m.end)}
        for m in universe.memberships()
    ]
    active = [
        {"t": int(t.timestamp()), "active": sorted(universe.active(t))}
        for t in (event_times or [])
    ]
    return {"memberships": memberships, "active": active}


def constraints_to_dict(constraints: Constraints | None) -> dict | None:
    if constraints is None:
        return None
    return {
        "max_position_weight": constraints.max_position_weight,
        "max_position_value": constraints.max_position_value,
        "max_sector_weight": constraints.max_sector_weight,
        "sectors": dict(constraints.sectors) if constraints.sectors else None,
        "long_only": constraints.long_only,
        "no_short": sorted(constraints.no_short),
        "no_trade": sorted(constraints.no_trade),
        "max_gross": constraints.max_gross,
        "max_net": constraints.max_net,
        "min_trade_value": constraints.min_trade_value,
    }


def config_to_dict(
    inputs: RunInputs, event_times: list[datetime] | None = None
) -> dict:
    config = {
        "costs": costs_to_dict(inputs.costs),
        "starting_cash": inputs.starting_cash,
        "universe": universe_to_dict(inputs.universe, event_times),
        "constraints": constraints_to_dict(inputs.constraints),
    }
    if inputs.date_range is not None:
        config["date_range"] = inputs.date_range
    return config

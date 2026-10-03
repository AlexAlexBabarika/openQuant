# backend/backtesting/optimize/space.py
"""Parameter schema: the declarable space an optimizer sweeps.

A strategy declares a module-level ``params = {...}`` mapping names to ``Int``,
``Float``, or ``Choice``. ``values()`` enumerates the discrete grid; ``sample()``
draws one value from a seeded RNG (random search). Float values are snapped to
the step grid so trial parameters are exactly representable and hash stably for
the trial cache. ``to_dict``/``param_from_dict`` are the on-the-wire form the UI
renders and the API echoes back.
"""

from __future__ import annotations

import decimal
import math
import random
from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class Param(Protocol):
    def values(self) -> list: ...
    def sample(self, rng: random.Random) -> Any: ...
    def to_dict(self) -> dict: ...


def _decimals(step: float) -> int:
    # Use Decimal's exponent rather than splitting repr(): repr() switches to
    # scientific notation for steps below 1e-4 (e.g. ``1e-05``), where the naive
    # split would report 0 decimals and collapse the whole grid to one value.
    exponent = decimal.Decimal(repr(step)).as_tuple().exponent
    return max(0, -exponent) if isinstance(exponent, int) else 0


@dataclass(frozen=True, slots=True)
class Int:
    low: int
    high: int
    step: int = 1

    def __post_init__(self) -> None:
        if (
            any(type(v) is not int for v in (self.low, self.high, self.step))
            or self.step <= 0
            or self.high < self.low
        ):
            raise ValueError(
                "Int parameters require ordered integer bounds and a positive step."
            )

    def values(self) -> list[int]:
        return list(range(self.low, self.high + 1, self.step))

    def sample(self, rng: random.Random) -> int:
        return rng.choice(self.values())

    def to_dict(self) -> dict:
        return {"kind": "int", "low": self.low, "high": self.high, "step": self.step}


@dataclass(frozen=True, slots=True)
class Float:
    low: float
    high: float
    step: float = 1.0

    def __post_init__(self) -> None:
        if (
            any(
                type(v) not in (int, float) or not math.isfinite(v)
                for v in (self.low, self.high, self.step)
            )
            or self.step <= 0
            or self.high < self.low
        ):
            raise ValueError(
                "Float parameters require finite ordered bounds and a positive step."
            )

    def values(self) -> list[float]:
        ndigits = _decimals(self.step)
        out: list[float] = []
        # Build off integer counts to avoid float drift accumulating.
        n = int(round((self.high - self.low) / self.step))
        for i in range(n + 1):
            out.append(round(self.low + i * self.step, ndigits))
        return out

    def sample(self, rng: random.Random) -> float:
        return rng.choice(self.values())

    def to_dict(self) -> dict:
        return {"kind": "float", "low": self.low, "high": self.high, "step": self.step}


@dataclass(frozen=True, slots=True)
class Choice:
    options: tuple

    def __init__(self, options) -> None:
        object.__setattr__(self, "options", tuple(options))
        if not self.options:
            raise ValueError("Choice parameters require at least one option.")

    def values(self) -> list:
        return list(self.options)

    def sample(self, rng: random.Random):
        return rng.choice(self.options)

    def to_dict(self) -> dict:
        return {"kind": "choice", "options": list(self.options)}


def param_from_dict(d: dict) -> Param:
    kind = d["kind"]
    if kind == "int":
        return Int(d["low"], d["high"], d.get("step", 1))
    if kind == "float":
        return Float(d["low"], d["high"], d.get("step", 1.0))
    if kind == "choice":
        return Choice(d["options"])
    raise ValueError(f"unknown param kind {kind!r}")


def parse_schema(namespace: dict) -> dict[str, Param]:
    """Extract and validate the ``params`` declaration from a strategy namespace."""
    raw = namespace.get("params")
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise ValueError("`params` must be a dict of name -> Int/Float/Choice")
    schema: dict[str, Param] = {}
    for name, p in raw.items():
        if not isinstance(p, Param):
            raise ValueError(
                f"`params[{name!r}]` is not a parameter (Int/Float/Choice)"
            )
        schema[name] = p
    return schema

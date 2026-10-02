"""Generate the results-dashboard sample fixture.

Runs the backtesting engine over ~3 years of deterministic synthetic daily
data with a simple SMA-crossover strategy (so the blob contains real round-trip
trades, drawdowns, and a multi-year equity curve), serializes it through the
canonical ``result_to_dict``, and writes it to the frontend as a committed
fixture the dashboard and its tests read.

The market data is seeded and the run is deterministic, so re-running this
regenerates a byte-identical blob (the wall-clock ``meta`` timestamps are
overwritten with fixed values to keep the JSON stable across runs).

    python gen_dashboard_fixture.py
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import polars as pl

from backend.backtesting.engine import run_backtest
from backend.backtesting.serialize import result_to_dict
from backend.backtesting.strategy import Strategy

_OUT = Path("frontend/src/lib/features/backtest/fixtures/sample-run.json")
_YEARS = 3
_SEED = 7


class SmaCrossover(Strategy):
    """Go long when the fast SMA crosses above the slow SMA, flat when it
    crosses back below. Produces a sequence of completed round trips."""

    def __init__(self, fast: int = 20, slow: int = 50, qty: float = 700.0) -> None:
        self._fast = fast
        self._slow = slow
        self._qty = qty

    def _sma(self, ctx, window: int) -> float | None:
        n = len(ctx.bars)
        if n < window:
            return None
        return sum(ctx.bars[i].close for i in range(n - window, n)) / window

    def on_bar(self, ctx) -> None:
        fast = self._sma(ctx, self._fast)
        slow = self._sma(ctx, self._slow)
        if fast is None or slow is None:
            return
        flat = ctx.position.quantity == 0.0
        if fast > slow and flat:
            ctx.buy(self._qty)
        elif fast < slow and not flat:
            ctx.sell(self._qty)


def _weekdays(n: int) -> list[datetime]:
    """``n`` consecutive weekday (Mon-Fri) UTC timestamps from 2014-01-01."""
    out: list[datetime] = []
    day = datetime(2014, 1, 1, tzinfo=timezone.utc)
    while len(out) < n:
        if day.weekday() < 5:
            out.append(day)
        day += timedelta(days=1)
    return out


def synthetic_frame() -> pl.DataFrame:
    """Deterministic ~3y daily OHLCV: a gently trending geometric random walk
    with enough swings to trigger crossovers in both directions. Weekdays only,
    so the series reads like real trading days."""
    n = 252 * _YEARS
    ts = _weekdays(n)
    rng = np.random.default_rng(_SEED)
    # Daily log-returns: small upward drift + noise; cumulate into a price path.
    drift = 0.0007
    shocks = drift + 0.009 * rng.standard_normal(n)
    close = 100.0 * np.exp(np.cumsum(shocks))
    intrabar = 0.006 * close
    open_ = close * (1.0 + 0.003 * rng.standard_normal(n))
    high = np.maximum(open_, close) + np.abs(0.5 * intrabar)
    low = np.minimum(open_, close) - np.abs(0.5 * intrabar)
    volume = 1_000_000.0 * (1.0 + 0.3 * np.abs(rng.standard_normal(n)))
    return pl.DataFrame(
        {
            "timestamp": ts,
            "open": open_,
            "high": high,
            "low": low,
            "close": close,
            "volume": volume,
        }
    ).with_columns(pl.col("timestamp").dt.replace_time_zone("UTC"))


def main() -> None:
    result = run_backtest(
        frame=synthetic_frame(),
        strategy=SmaCrossover(),
        starting_cash=100_000.0,
        seed=_SEED,
        strategy_id="sma_crossover",
        params={"fast": 20, "slow": 50, "qty": 50},
        data_version="synthetic-v1",
    )
    blob = result_to_dict(result)
    # Stabilize provenance so re-running produces an identical file.
    fixed = "2024-01-01T00:00:00+00:00"
    blob["meta"]["run_id"] = "0" * 32
    blob["meta"]["started_at"] = fixed
    blob["meta"]["finished_at"] = fixed

    _OUT.parent.mkdir(parents=True, exist_ok=True)
    _OUT.write_text(json.dumps(blob))
    n_bars = len(blob["bars"])
    n_trades = len(blob["trades"])
    print(f"wrote {_OUT} — {n_bars} bars, {n_trades} trades")


if __name__ == "__main__":
    main()

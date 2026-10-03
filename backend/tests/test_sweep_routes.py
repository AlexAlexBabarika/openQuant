# backend/tests/test_sweep_routes.py
"""The /sweeps API: schema introspection, start+poll, and trial drill-in.

Market data is stubbed so the test is hermetic (no provider calls).
"""

from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone

import numpy as np
import polars as pl
import pytest
from fastapi.testclient import TestClient

import backend.routes.sweep_routes as sweep_routes
from backend.app import app

CODE = (
    "params = {'qty': Int(1, 4, step=1)}\n"
    "def on_bar(ctx):\n"
    "    if ctx.position.quantity == 0:\n"
    "        ctx.buy(ctx.params['qty'])\n"
)


@pytest.fixture(autouse=True)
def _stub_frame(monkeypatch) -> None:
    n = 60
    start = datetime(2020, 1, 1, tzinfo=timezone.utc)
    ts = [start + timedelta(days=i) for i in range(n)]
    close = 100 + np.cumsum(np.random.default_rng(0).standard_normal(n) * 0.5)
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

    async def _fake_load_frame(body, user=None):
        return frame, "stub-v1"

    monkeypatch.setattr(sweep_routes, "_load_frame", _fake_load_frame)


client = TestClient(app)


def test_schema_endpoint_returns_declared_params() -> None:
    r = client.post("/sweeps/schema", json={"code": CODE})
    assert r.status_code == 200
    schema = r.json()["schema"]
    assert schema["qty"] == {"kind": "int", "low": 1, "high": 4, "step": 1}


def test_start_poll_and_drill_into_a_trial() -> None:
    start = client.post(
        "/sweeps",
        json={
            "code": CODE,
            "symbol": "TEST",
            "provider": "yfinance",
            "search": "grid",
            "metric": "total_return",
            "vary": ["qty"],
        },
    )
    assert start.status_code == 202
    sid = start.json()["sweep_id"]

    for _ in range(600):
        poll = client.get(f"/sweeps/{sid}").json()
        if poll["status"] in {"done", "error"}:
            break
        time.sleep(0.05)
    assert poll["status"] == "done", poll
    assert poll["total"] == 4
    assert poll["best_trial_id"] is not None

    # Drill into the best trial -> a full BacktestResult blob.
    best = poll["best_trial_id"]
    trial = client.get(
        f"/sweeps/{sid}/trial/{best}",
        params={"symbol": "TEST", "provider": "yfinance", "code": CODE},
    )
    assert trial.status_code == 200
    blob = trial.json()
    assert {"meta", "equity", "trades", "metrics"} <= set(blob)

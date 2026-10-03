# backend/tests/test_backtest_routes.py
"""The /backtests API: a single sandboxed run of strategy code.

Market data is stubbed so the test is hermetic (no provider calls).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import numpy as np
import polars as pl
import pytest
from fastapi.testclient import TestClient

import backend.routes.backtest_routes as backtest_routes
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

    monkeypatch.setattr(backtest_routes, "_load_frame", _fake_load_frame)


client = TestClient(app)


def _run(payload_overrides: dict | None = None) -> dict:
    payload = {
        "code": CODE,
        "symbol": "TEST",
        "provider": "yfinance",
    }
    payload.update(payload_overrides or {})
    r = client.post("/backtests/run", json=payload)
    assert r.status_code == 200, r.text
    return r.json()


def test_run_returns_full_blob_with_schema_default_params() -> None:
    body = _run()
    assert body["status"] == "ok", body["stderr"]
    for key in ("meta", "bars", "orders", "fills", "equity", "trades", "metrics"):
        assert key in body
    assert len(body["equity"]) == 60
    # Defaults come from the declared schema: the first value of each param.
    assert body["meta"]["params"] == {"qty": 1}
    assert body["fills"][0]["quantity"] == 1


def test_run_applies_param_overrides() -> None:
    body = _run({"params": {"qty": 3}})
    assert body["status"] == "ok", body["stderr"]
    assert body["meta"]["params"] == {"qty": 3}
    assert body["fills"][0]["quantity"] == 3


def test_unsafe_code_is_rejected() -> None:
    r = client.post(
        "/backtests/run",
        json={
            "code": "import os\ndef on_bar(ctx):\n    pass\n",
            "symbol": "TEST",
            "provider": "yfinance",
        },
    )
    assert r.status_code == 400
    assert "strategy rejected" in r.json()["detail"]


def test_runtime_error_surfaces_in_result_status() -> None:
    body = _run({"code": "def on_bar(ctx):\n    raise ValueError('boom')\n"})
    assert body["status"] == "error"
    assert "boom" in body["stderr"]


def test_run_persists_snapshot_and_returns_run_id(tmp_path, monkeypatch):
    from backend.backtesting.run_store import RunStore

    store = RunStore(tmp_path)
    monkeypatch.setattr(backtest_routes, "_RUN_STORE", store, raising=False)

    body = _run()
    assert body["status"] == "ok", body.get("stderr")
    rid = body["run_id"]
    assert store.exists(rid)
    # meta.run_id must be the content-addressed id (not the engine uuid), so the
    # frontend — which reads meta.run_id — loads the run that was actually stored.
    assert body["meta"]["run_id"] == rid


def test_run_error_does_not_persist_or_return_run_id(tmp_path, monkeypatch):
    from backend.backtesting.run_store import RunStore

    store = RunStore(tmp_path)
    monkeypatch.setattr(backtest_routes, "_RUN_STORE", store, raising=False)

    body = _run({"code": "def on_bar(ctx):\n    raise ValueError('boom')\n"})
    assert body["status"] == "error"
    assert "run_id" not in body
    assert store.list_ids() == []

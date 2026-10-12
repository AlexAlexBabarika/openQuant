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
from backend.backtesting.run_store import RunStore
from backend.tests._run_auth_fixtures import auth_headers

CODE = (
    "params = {'qty': Int(1, 4, step=1)}\n"
    "def on_bar(ctx):\n"
    "    if ctx.position.quantity == 0:\n"
    "        ctx.buy(ctx.params['qty'])\n"
)


@pytest.fixture(autouse=True)
def _stub_frame(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(backtest_routes, "_RUN_STORE", RunStore(tmp_path))
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


def _run(payload_overrides: dict | None = None, *, headers: dict | None = None) -> dict:
    payload = {
        "code": CODE,
        "symbol": "TEST",
        "provider": "yfinance",
    }
    payload.update(payload_overrides or {})
    r = client.post("/backtests/run", json=payload, headers=headers)
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

    body = _run(headers=auth_headers("a"))
    assert body["status"] == "ok", body.get("stderr")
    rid = body["run_id"]
    assert RunStore(tmp_path).for_owner("a").exists(rid)
    assert store.list_ids() == []
    assert store.for_owner("b").list_ids() == []
    assert body["persistence"] == {
        "stored": True,
        "reason": "authenticated",
        "run_id": rid,
    }
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


def test_guest_run_does_not_persist_or_offer_a_saved_run_reference(tmp_path):
    body = _run()
    assert body["status"] == "ok"
    assert "run_id" not in body
    assert "run_id" not in body["meta"]
    assert body["persistence"] == {"stored": False, "reason": "guest", "run_id": None}
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize(
    "authorization", ["Bearer invalid", "Basic invalid", "Bearer", ""]
)
def test_invalid_authorization_never_downgrades_to_guest(monkeypatch, authorization):
    async def unexpected_data_load(*args):
        pytest.fail("invalid authorization reached provider loading")

    monkeypatch.setattr(backtest_routes, "_load_frame", unexpected_data_load)
    response = client.post(
        "/backtests/run",
        json={"code": CODE, "symbol": "TEST", "provider": "yfinance"},
        headers={"Authorization": authorization},
    )
    assert response.status_code == 401


def test_expired_authorization_is_401():
    response = client.post(
        "/backtests/run",
        json={"code": CODE, "symbol": "TEST", "provider": "yfinance"},
        headers=auth_headers("a", expired=True),
    )
    assert response.status_code == 401


def test_same_run_id_can_be_saved_by_two_accounts_without_global_artifact(tmp_path):
    a = _run(headers=auth_headers("a"))
    b = _run(headers=auth_headers("b"))
    assert a["run_id"] == b["run_id"]
    store = RunStore(tmp_path)
    assert store.for_owner("a").exists(a["run_id"])
    assert store.for_owner("b").exists(b["run_id"])
    assert store.list_ids() == []


def test_authenticated_run_failure_explicitly_reports_unsaved(tmp_path):
    body = _run(
        {"code": "def on_bar(ctx):\n    raise ValueError('boom')\n"},
        headers=auth_headers("a"),
    )
    assert body["status"] == "error"
    assert "run_id" not in body
    assert "run_id" not in body["meta"]
    assert body["persistence"] == {
        "stored": False,
        "reason": "run_failed",
        "run_id": None,
    }
    assert list(tmp_path.iterdir()) == []

# backend/tests/test_portfolio_routes.py
"""The /portfolio-backtests API: a store-backed multi-asset run of strategy code.

The route reads from the on-disk datastore (integration boundary B3). Each test
seeds a tmp store via the ingest pipeline with a deterministic fake provider
(no network), then points the route's module-level store handles at it.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import backend.routes.portfolio_routes as portfolio_routes
from backend.app import app
from backend.datastore.ingest import ingest_symbols
from backend.datastore.layout import StoreLayout
from backend.market.models import CorporateAction, OHLCVCandle

CODE = (
    "def on_bar(ctx):\n"
    "    for symbol, weight in equal_weight(ctx.universe).items():\n"
    "        ctx.target_weight(symbol, weight)\n"
    "    if ctx.time.day == 1:\n"
    "        ctx.rebalance()\n"
)

_START = datetime(2020, 8, 15, tzinfo=timezone.utc)
_DAYS = [_START + timedelta(days=i) for i in range(31)]  # 2020-08-15 .. 2020-09-14
_SPLIT_DAY = datetime(2020, 8, 31, tzinfo=timezone.utc)


def _candle(t, c, symbol):
    return OHLCVCandle(
        symbol=symbol,
        timestamp=t,
        open=c,
        high=c + 0.5,
        low=c - 0.5,
        close=c,
        volume=1e6,
    )


class _FakeProvider:
    name = "fake"

    def __init__(self, bars, actions):
        self._bars, self._actions = bars, actions

    def get_raw_ohlcv(self, symbol, period="max", interval="1d"):
        return self._bars[symbol]

    def get_corporate_actions(self, symbol):
        return self._actions.get(symbol, [])


def _aapl_bars():
    # 500 before the 4-for-1 split, 125 after — raw, unadjusted.
    return [_candle(t, 500.0 if t < _SPLIT_DAY else 125.0, "AAPL") for t in _DAYS]


@pytest.fixture(autouse=True)
def _seed_store(tmp_path: Path, monkeypatch):
    layout = StoreLayout(root=tmp_path)
    provider = _FakeProvider(
        bars={
            "AAPL": _aapl_bars(),
            "MSFT": [_candle(t, 200.0, "MSFT") for t in _DAYS],
            "META": [_candle(t, 300.0, "META") for t in _DAYS],
        },
        actions={
            "AAPL": [
                CorporateAction(
                    symbol="AAPL", ex_date=_SPLIT_DAY, kind="split", value=4.0
                )
            ],
        },
    )
    ingest_symbols(layout, provider, ["AAPL", "MSFT", "META"], indices=["SP500"])
    monkeypatch.setattr(portfolio_routes, "_STORE_LAYOUT", layout)
    monkeypatch.setattr(portfolio_routes, "_STORE_PROVIDER", "fake")


client = TestClient(app)


def _run(payload_overrides: dict | None = None) -> dict:
    payload = {"code": CODE, "symbols": ["MSFT", "AAPL"], "provider": "yfinance"}
    payload.update(payload_overrides or {})
    r = client.post("/portfolio-backtests/run", json=payload)
    assert r.status_code == 200, r.text
    return r.json()


def test_run_returns_the_full_portfolio_blob():
    body = _run()
    assert body["status"] == "ok", body["stderr"]
    for key in (
        "meta",
        "symbols",
        "bars",
        "orders",
        "fills",
        "equity",
        "trades",
        "constraint_events",
        "metrics",
    ):
        assert key in body
    assert body["symbols"] == ["AAPL", "MSFT"]  # deduped + sorted
    assert len(body["equity"]) == 31
    assert {f["symbol"] for f in body["fills"]} == {"AAPL", "MSFT"}
    assert "sharpe" in body["metrics"]["portfolio"]


def test_run_records_data_version():
    body = _run()
    assert body["meta"].get("data_version")


def test_snapshot_identity_tracks_symbols_and_date_slice():
    a = _run({"symbols": ["AAPL"]})
    b = _run({"symbols": ["MSFT"]})
    sliced = _run({"symbols": ["AAPL"], "start": "2020-09-01"})
    assert len({a["run_id"], b["run_id"], sliced["run_id"]}) == 3


def test_snapshot_preserves_execution_data_version(monkeypatch):
    versions = iter(["loaded-version", "later-version"])
    monkeypatch.setattr(
        portfolio_routes.HistoricalStore, "head_version", lambda _self: next(versions)
    )
    captured = []
    original_persist = portfolio_routes._persist_portfolio

    def capture_persist(blob, **kwargs):
        captured.append(kwargs["data_version"])
        return original_persist(blob, **kwargs)

    monkeypatch.setattr(portfolio_routes, "_persist_portfolio", capture_persist)
    body = _run()
    assert captured == ["loaded-version"]
    assert body["meta"]["data_version"] == "loaded-version"


def test_index_universe_run():
    body = _run(
        {"symbols": None, "index": "SP500", "start": "2020-08-15", "end": "2020-09-15"}
    )
    assert body["status"] == "ok", body["stderr"]
    # SP500 active in Aug-Sep 2020 = AAPL, MSFT, META.
    assert set(body["symbols"]) == {"AAPL", "MSFT", "META"}
    assert body["meta"].get("data_version")


def test_single_symbol_aapl_split_is_continuous():
    body = _run({"symbols": ["AAPL"], "start": "2020-08-15", "end": "2020-09-15"})
    assert body["status"] == "ok", body["stderr"]
    closes = [b["close"] for b in body["bars"]["AAPL"]]
    assert len(closes) >= 2
    for a, b in zip(closes, closes[1:]):
        assert abs(b / a - 1.0) < 0.5  # AC#2: no phantom ~75% drop


def test_missing_data_returns_400():
    r = client.post(
        "/portfolio-backtests/run",
        json={
            "code": CODE,
            "symbols": ["NOPE"],
            "start": "2020-08-15",
            "end": "2020-09-15",
            "provider": "yfinance",
        },
    )
    assert r.status_code == 400
    assert "ingest" in r.text.lower()


def test_run_enforces_request_constraints():
    body = _run({"constraints": {"max_position_weight": 0.1}})
    assert body["status"] == "ok", body["stderr"]
    assert any(
        e["constraint"] == "max_position_weight" for e in body["constraint_events"]
    )


def test_module_level_policies_and_params_pass_schema_parsing():
    code = (
        "params = {'lookback': Int(5, 20, step=5)}\n"
        "policy = PeriodicRebalance('monthly')\n"
        "def on_bar(ctx):\n"
        "    for symbol, weight in equal_weight(ctx.universe).items():\n"
        "        ctx.target_weight(symbol, weight)\n"
        "    if policy.should_rebalance(ctx):\n"
        "        ctx.rebalance()\n"
    )
    body = _run({"code": code})
    assert body["status"] == "ok", body["stderr"]
    assert body["meta"]["params"] == {"lookback": 5}
    assert len(body["fills"]) >= 2


def test_invalid_code_is_a_400():
    r = client.post(
        "/portfolio-backtests/run",
        json={
            "code": "import os",
            "symbols": ["AAPL"],
            "provider": "yfinance",
        },
    )
    assert r.status_code == 400


def test_neither_index_nor_symbols_is_a_400():
    r = client.post(
        "/portfolio-backtests/run",
        json={
            "code": CODE,
            "provider": "yfinance",
        },
    )
    assert r.status_code == 400


def test_too_many_symbols_is_a_422():
    r = client.post(
        "/portfolio-backtests/run",
        json={
            "code": CODE,
            "symbols": [f"S{i}" for i in range(51)],
            "provider": "yfinance",
        },
    )
    assert r.status_code == 422


def test_portfolio_persist_helper_writes_snapshot(tmp_path):
    """Unit-test the persistence helper directly (avoids needing an ingested store)."""
    import backend.routes.portfolio_routes as pr
    from backend.backtesting.run_store import RunStore

    store = RunStore(tmp_path)
    pr._RUN_STORE = store

    # Minimal portfolio blob (one symbol, one bar) shaped like portfolio_result_to_dict.
    blob = {
        "meta": {
            "engine_version": "1.0.0",
            "seed": 0,
            "data_version": "v1",
            "starting_cash": 1e5,
            "strategy_id": None,
            "params": {},
            "started_at": "2020-01-01T00:00:00+00:00",
            "finished_at": "2020-01-01T00:00:01+00:00",
            "run_id": "tmp",
        },
        "symbols": ["AAPL"],
        "bars": {
            "AAPL": [
                {
                    "t": 1577836800,
                    "open": 1.0,
                    "high": 1.0,
                    "low": 1.0,
                    "close": 1.0,
                    "volume": 1.0,
                }
            ]
        },
        "orders": [],
        "fills": [],
        "equity": [],
        "trades": [],
        "constraint_events": [],
        "metrics": {"portfolio": {"total_return": 0.0}},
    }
    rid = pr._persist_portfolio(
        blob,
        code="def on_bar(ctx):\n    pass\n",
        params={},
        data_version="v1",
        seed=0,
        starting_cash=1e5,
        universe=None,
        constraints=None,
    )
    assert store.exists(rid)

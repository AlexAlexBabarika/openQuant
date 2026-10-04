# backend/tests/test_run_routes.py
from fastapi.testclient import TestClient

import backend.routes.run_routes as rr
from backend.app import app
from backend.backtesting.engine import run_backtest
from backend.backtesting.run_config import RunInputs
from backend.backtesting.run_snapshot import assemble_snapshot
from backend.backtesting.run_store import RunStore
from backend.backtesting.serialize import result_to_dict
from backend.tests._backtesting_fixtures import BuyAndHold, canonical_frame


def _seed_store(tmp_path, n):
    store = RunStore(tmp_path)
    blob = result_to_dict(
        run_backtest(
            frame=canonical_frame(), strategy=BuyAndHold(), starting_cash=1e4, seed=0
        )
    )
    rid = store.write(
        assemble_snapshot(
            blob,
            RunInputs(
                code="def on_bar(ctx):\n    pass\n",
                params={"n": n},
                data_version="v1",
                seed=0,
                starting_cash=1e4,
            ),
        )
    )
    return store, rid


def test_get_run_includes_status(tmp_path, monkeypatch):
    store, rid = _seed_store(tmp_path, 10)
    monkeypatch.setattr(rr, "_RUN_STORE", store)
    client = TestClient(app)
    resp = client.get(f"/backtests/runs/{rid}")
    assert resp.status_code == 200
    assert resp.json()["status"]["stale"] is False


def test_get_missing_run_is_404(tmp_path, monkeypatch):
    store, _ = _seed_store(tmp_path, 10)
    monkeypatch.setattr(rr, "_RUN_STORE", store)
    assert TestClient(app).get("/backtests/runs/deadbeef").status_code == 404


def test_compare_shows_single_param_diff(tmp_path, monkeypatch):
    store, rid_a = _seed_store(tmp_path, 10)
    blob = result_to_dict(
        run_backtest(
            frame=canonical_frame(), strategy=BuyAndHold(), starting_cash=1e4, seed=0
        )
    )
    rid_b = store.write(
        assemble_snapshot(
            blob,
            RunInputs(
                code="def on_bar(ctx):\n    pass\n",
                params={"n": 20},
                data_version="v1",
                seed=0,
                starting_cash=1e4,
            ),
        )
    )
    monkeypatch.setattr(rr, "_RUN_STORE", store)
    diff = TestClient(app).get(f"/backtests/runs/{rid_a}/compare/{rid_b}").json()
    assert [r["path"] for r in diff["inputs_diff"]] == ["params.n"]
    row = next(r for r in diff["lineage"]["rows"] if r["path"] == "params")
    assert row["a"]["value"] == {"n": 10}
    assert row["b"]["value"] == {"n": 20}
    assert row["status"] == "changed"
    assert diff["metrics_diff"]
    assert diff["equity_overlay"]["residual"]
    assert "trades_diff" in diff


def test_rerun_failing_strategy_returns_422(tmp_path, monkeypatch):
    store, rid = _seed_store(tmp_path, 10)
    # Overwrite strategy.py with code that raises at runtime
    (store.path(rid) / "strategy.py").write_text(
        "def on_bar(ctx):\n    raise ValueError('boom')\n"
    )
    monkeypatch.setattr(rr, "_RUN_STORE", store)
    resp = TestClient(app).post(f"/backtests/runs/{rid}/rerun")
    assert resp.status_code == 422

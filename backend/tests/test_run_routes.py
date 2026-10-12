# backend/tests/test_run_routes.py
import io

import pytest
from fastapi.testclient import TestClient

import backend.routes.run_routes as rr
from backend.app import app
from backend.backtesting.engine import run_backtest
from backend.backtesting.run_config import RunInputs
from backend.backtesting.run_snapshot import assemble_snapshot
from backend.backtesting.run_store import RunStore
from backend.backtesting.serialize import result_to_dict
from backend.tests._backtesting_fixtures import BuyAndHold, canonical_frame
from backend.tests._run_auth_fixtures import auth_headers


def _seed_store(tmp_path, n, owner="a"):
    store = RunStore(tmp_path)
    blob = result_to_dict(
        run_backtest(
            frame=canonical_frame(), strategy=BuyAndHold(), starting_cash=1e4, seed=0
        )
    )
    rid = store.for_owner(owner).write(
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
    client = TestClient(app, headers=auth_headers("a"))
    resp = client.get(f"/backtests/runs/{rid}")
    assert resp.status_code == 200
    assert resp.json()["status"]["stale"] is False


def test_get_missing_run_is_404(tmp_path, monkeypatch):
    store, _ = _seed_store(tmp_path, 10)
    monkeypatch.setattr(rr, "_RUN_STORE", store)
    assert (
        TestClient(app, headers=auth_headers("a"))
        .get("/backtests/runs/deadbeef")
        .status_code
        == 404
    )


def test_compare_shows_single_param_diff(tmp_path, monkeypatch):
    store, rid_a = _seed_store(tmp_path, 10)
    blob = result_to_dict(
        run_backtest(
            frame=canonical_frame(), strategy=BuyAndHold(), starting_cash=1e4, seed=0
        )
    )
    rid_b = store.for_owner("a").write(
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
    diff = (
        TestClient(app, headers=auth_headers("a"))
        .get(f"/backtests/runs/{rid_a}/compare/{rid_b}")
        .json()
    )
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
    (store.for_owner("a").path(rid) / "strategy.py").write_text(
        "def on_bar(ctx):\n    raise ValueError('boom')\n"
    )
    monkeypatch.setattr(rr, "_RUN_STORE", store)
    resp = TestClient(app, headers=auth_headers("a")).post(
        f"/backtests/runs/{rid}/rerun"
    )
    assert resp.status_code == 422


@pytest.mark.parametrize("credentials", ["missing", "invalid", "expired"])
def test_all_saved_run_endpoints_require_valid_auth(tmp_path, monkeypatch, credentials):
    store, rid = _seed_store(tmp_path, 10)
    monkeypatch.setattr(rr, "_RUN_STORE", store)
    headers = (
        {}
        if credentials == "missing"
        else {"Authorization": "Bearer invalid"}
        if credentials == "invalid"
        else auth_headers("a", expired=True)
    )
    client = TestClient(app, headers=headers)
    for path in ("", f"/{rid}", f"/{rid}/compare/{rid}", f"/{rid}/export"):
        assert client.get(f"/backtests/runs{path}").status_code == 401
    assert client.post(f"/backtests/runs/{rid}/rerun").status_code == 401
    assert (
        client.post(
            "/backtests/runs/import", files={"file": ("run.tar.gz", b"invalid")}
        ).status_code
        == 401
    )


def test_accounts_are_isolated_after_store_restart(tmp_path, monkeypatch):
    store, rid_a = _seed_store(tmp_path, 10, "a")
    _, rid_b = _seed_store(tmp_path, 20, "b")
    monkeypatch.setattr(rr, "_RUN_STORE", RunStore(tmp_path))
    for owner, own, other in (("a", rid_a, rid_b), ("b", rid_b, rid_a)):
        client = TestClient(app, headers=auth_headers(owner))
        assert client.get("/backtests/runs").json() == {"run_ids": [own]}
        assert client.get(f"/backtests/runs/{own}").status_code == 200
        assert client.get(f"/backtests/runs/{own}/export").status_code == 200
        for path in (
            f"/{other}",
            f"/{own}/compare/{other}",
            f"/{other}/compare/{own}",
            f"/{other}/export",
        ):
            assert client.get(f"/backtests/runs{path}").status_code == 404
        assert client.post(f"/backtests/runs/{other}/rerun").status_code == 404
    assert store.for_owner("a").list_ids() == [rid_a]
    assert store.for_owner("b").list_ids() == [rid_b]


def test_legacy_artifacts_are_left_unclaimed(tmp_path, monkeypatch):
    store, rid = _seed_store(tmp_path, 10)
    legacy = store.path(rid)
    store.for_owner("a").path(rid).rename(legacy)
    monkeypatch.setattr(rr, "_RUN_STORE", RunStore(tmp_path))
    for owner in ("a", "b"):
        client = TestClient(app, headers=auth_headers(owner))
        assert client.get("/backtests/runs").json() == {"run_ids": []}
        for path in (f"/{rid}", f"/{rid}/compare/{rid}", f"/{rid}/export"):
            assert client.get(f"/backtests/runs{path}").status_code == 404
        assert client.post(f"/backtests/runs/{rid}/rerun").status_code == 404
    assert (legacy / "meta.json").is_file()


def test_explicit_import_is_scoped_idempotent_and_survives_restart(
    tmp_path, monkeypatch
):
    store, rid = _seed_store(tmp_path, 10)
    monkeypatch.setattr(rr, "_RUN_STORE", store)
    a = TestClient(app, headers=auth_headers("a"))
    b = TestClient(app, headers=auth_headers("b"))
    archive = a.get(f"/backtests/runs/{rid}/export").content
    assert b.get(f"/backtests/runs/{rid}").status_code == 404
    for _ in range(2):
        response = b.post(
            "/backtests/runs/import",
            files={"file": ("run.tar.gz", io.BytesIO(archive))},
        )
        assert response.status_code == 200
        assert response.json() == {"run_id": rid}
    monkeypatch.setattr(rr, "_RUN_STORE", RunStore(tmp_path))
    assert b.get("/backtests/runs").json() == {"run_ids": [rid]}
    assert (
        a.get(f"/backtests/runs/{rid}").json() == b.get(f"/backtests/runs/{rid}").json()
    )
    assert store.path(rid).exists() is False


def test_rerun_stays_in_callers_namespace(tmp_path, monkeypatch):
    store, rid = _seed_store(tmp_path, 10)
    monkeypatch.setattr(rr, "_RUN_STORE", store)
    response = TestClient(app, headers=auth_headers("a")).post(
        f"/backtests/runs/{rid}/rerun"
    )
    assert response.status_code == 200, response.text
    assert store.for_owner("a").exists(response.json()["run_id"])
    assert store.for_owner("b").list_ids() == []
    assert store.list_ids() == []


def test_invalid_import_is_422_and_does_not_publish(tmp_path, monkeypatch):
    store = RunStore(tmp_path)
    monkeypatch.setattr(rr, "_RUN_STORE", store)
    response = TestClient(app, headers=auth_headers("a")).post(
        "/backtests/runs/import", files={"file": ("bad.tar.gz", b"not a tarball")}
    )
    assert response.status_code == 422
    assert store.for_owner("a").list_ids() == []

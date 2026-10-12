"""Loaded identity, raw order, compute gates and immutable recorded context."""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from backend.app import app
from backend.backtesting.run_store import RunStore
from backend.backtesting.run_rerun import rerun
from backend.backtesting.data_quality import inspect_frame
from backend.backtesting.run_diff import diff_runs
from backend.market.models import OHLCVCandle
from backend.routes import (
    backtest_routes as bt,
    robustness_routes as rb,
    sweep_routes as sw,
)
from backend.tests._run_auth_fixtures import auth_headers

CODE = "def on_bar(ctx):\n    pass\n"
PAYLOAD = {"code": CODE, "symbol": "TEST", "provider": "yfinance"}
CLIENT = TestClient(app)


def candles():
    return [
        OHLCVCandle(
            symbol="TEST",
            timestamp=datetime(2020, 1, 1, tzinfo=timezone.utc) + timedelta(days=i),
            open=100,
            high=101,
            low=99,
            close=100,
            volume=1,
        )
        for i in range(120)
    ]


@pytest.fixture
def setup(monkeypatch, tmp_path):
    store = RunStore(tmp_path / "runs")
    monkeypatch.setattr(bt, "_RUN_STORE", store)
    rows = candles()
    monkeypatch.setattr(sw.cache, "get_cached", lambda *args, **kwargs: rows)
    monkeypatch.setattr(bt, "_load_frame", sw._load_research_frame)
    monkeypatch.setattr(rb, "_load_frame", sw._load_research_frame)

    def no_provider(*args, **kwargs):
        pytest.fail("Read-only cache preview must not fetch providers")

    monkeypatch.setattr(sw, "_fetch_candles_blocking", no_provider)
    return rows, store


def preview():
    return CLIENT.post(
        "/backtests/quality-preview",
        json={k: v for k, v in PAYLOAD.items() if k != "code"},
    )


def test_preview_is_cache_only_source_free_and_execution_records_same_report(
    setup, monkeypatch
):
    rows, store = setup
    pre = preview()
    assert pre.status_code == 200
    assert CODE not in pre.text
    quality = pre.json()["data_quality"]
    assert not quality["errors"] and quality["warnings"]
    original_engine = bt.run_strategy

    def historic_engine(*args, **kwargs):
        result = original_engine(*args, **kwargs)
        result.meta["engine_version"] = "historical-engine-fixture"
        return result

    monkeypatch.setattr(bt, "run_strategy", historic_engine)
    response = CLIENT.post(
        "/backtests/run",
        json={**PAYLOAD, "preview_data_version": pre.json()["data_version"]},
        headers=auth_headers("a"),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["meta"]["data_quality"] == quality
    scoped = store.for_owner("a")
    recorded = scoped.read(body["run_id"])
    assert recorded["meta"]["data_quality"] == quality
    assert recorded["meta"]["data_version"] == pre.json()["data_version"]
    assert recorded["config"]["date_range"] == {
        "start": quality["provenance"]["start"],
        "end": quality["provenance"]["end"],
    }
    assert (
        RunStore(store.root).for_owner("a").read(body["run_id"])["meta"]["data_quality"]
        == quality
    )
    monkeypatch.setattr(bt, "run_strategy", original_engine)
    replay_id = rerun(scoped, body["run_id"])
    assert replay_id != body["run_id"]
    replay = scoped.read(replay_id)
    assert replay["meta"]["data_quality"] == quality
    assert replay["meta"]["data_version"] == recorded["meta"]["data_version"]
    assert replay["config"]["date_range"] == recorded["config"]["date_range"]
    from backend.backtesting.run_store import export_run, import_run

    archive = export_run(scoped, replay_id, store.root / "portable.tar.gz")
    other = store.for_owner("b")
    assert import_run(other, archive) == replay_id
    assert other.read(replay_id)["meta"]["data_quality"] == quality
    comparison = diff_runs(recorded, other.read(replay_id))
    assert (
        next(
            row
            for row in comparison["lineage"]["rows"]
            if row["path"] == "meta.data_quality"
        )["status"]
        == "unchanged"
    )


@pytest.mark.parametrize(
    "path, engine",
    [("/backtests/run", "run_strategy"), ("/backtests/robustness", "run_robustness")],
)
@pytest.mark.parametrize("defect", ["order", "duplicate", "price"])
def test_loaded_errors_block_before_compute_and_row_order_is_not_repaired(
    setup, monkeypatch, path, engine, defect
):
    rows, store = setup
    if defect == "order":
        rows[0], rows[1] = rows[1], rows[0]
    elif defect == "duplicate":
        rows[1] = rows[0]
    else:
        rows[0] = rows[0].model_copy(update={"close": -1})

    def forbidden(*args, **kwargs):
        pytest.fail("Blocked bars must not start compute")

    monkeypatch.setattr(bt if engine == "run_strategy" else rb, engine, forbidden)
    pre = preview().json()
    assert pre["data_quality"]["errors"]
    response = CLIENT.post(path, json=PAYLOAD, headers=auth_headers("a"))
    assert response.status_code == 422
    assert response.json()["detail"]["data_quality"] == pre["data_quality"]
    assert not store.root.exists()


@pytest.mark.parametrize("path", ["/backtests/run", "/backtests/robustness"])
def test_preview_is_invalidated_if_loaded_identity_changes(setup, monkeypatch, path):
    rows, store = setup
    version = preview().json()["data_version"]
    rows[0] = rows[0].model_copy(update={"volume": 2})
    response = CLIENT.post(
        path,
        json={**PAYLOAD, "preview_data_version": version},
        headers=auth_headers("a"),
    )
    assert response.status_code == 409
    assert (
        response.json()["detail"]["data_quality"]["provenance"]["data_version"]
        != version
    )
    assert not store.root.exists()


def test_uncached_preview_never_fetches(setup, monkeypatch):
    monkeypatch.setattr(sw.cache, "get_cached", lambda *args, **kwargs: None)
    assert preview().status_code == 404


def test_converter_default_keeps_unrelated_scripts_sorted(setup):
    from backend.routes.script_routes import _candles_to_df

    rows, _ = setup
    rows.reverse()
    assert _candles_to_df(rows)["timestamp"].is_sorted()
    raw = _candles_to_df(rows, preserve_order=True)
    assert not raw["timestamp"].is_sorted()
    assert "nonmonotonic_timestamp" in {
        i["code"]
        for i in inspect_frame(
            raw, provider="yfinance", interval="1d", data_version="v"
        )["errors"]
    }


def test_robustness_report_keeps_nonblocking_quality_evidence(setup):
    response = CLIENT.post(
        "/backtests/robustness", json=PAYLOAD, headers=auth_headers("a")
    )
    assert response.status_code == 200, response.text
    report = response.json()
    assert report["data_quality"] == preview().json()["data_quality"]
    assert report["walk_forward"]["status"] == "measured"
    assert report["regimes"]["status"] == "measured"

"""In-process route integration over invented upstream responses, not browser/auth evidence."""

from datetime import timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from backend.backtesting.run_store import RunStore
from backend.market import cache
from backend.models.auth_models import AuthUserInfo
from backend.routes import backtest_routes as bt, sweep_routes as sw
from backend.tests._provider_raw_fixtures import (
    PROVIDERS,
    START,
    deny_network,
    offline_adapter,
)

CODE = "def on_bar(ctx):\n    pass\n"


@pytest.fixture(params=PROVIDERS)
def context(monkeypatch, request, tmp_path):
    deny_network(monkeypatch)
    adapter = offline_adapter(monkeypatch, request.param)
    monkeypatch.setattr(cache, "_data_cache", {})
    monkeypatch.setattr(cache, "_profile_cache", {})
    store = RunStore(tmp_path / "runs")
    monkeypatch.setattr(bt, "_RUN_STORE", store)
    app = FastAPI()
    app.include_router(bt.router)
    # Auth is not under test: no DB, credentials or token fixture. Binance stays guest.
    user = AuthUserInfo(id="offline-fixture") if request.param == "twelvedata" else None
    app.dependency_overrides[bt.optional_run_user] = lambda: user
    payload = {
        "symbol": "TEST",
        "provider": request.param,
        "period": "1mo",
        "interval": "1d",
    }
    return adapter, TestClient(app), payload, store


@pytest.mark.parametrize("defect", ["timestamp", "numeric", "order", "duplicate"])
def test_uncached_corrupt_upstream_never_populates_cache_or_starts_engine(
    context, monkeypatch, defect
):
    adapter, client, payload, store = context
    if defect == "timestamp":
        adapter.rows[0]["timestamp"] = "broken-date"
    elif defect == "numeric":
        adapter.rows[0]["open"] = 0
    elif defect == "order":
        adapter.rows.reverse()
    else:
        adapter.rows[1]["timestamp"] = START

    def forbidden(*args, **kwargs):
        pytest.fail("Invalid upstream must not start strategy engine")

    monkeypatch.setattr(bt, "run_strategy", forbidden)
    preview = client.post("/backtests/quality-preview", json=payload)
    assert preview.status_code == 404 and not adapter.calls
    response = client.post("/backtests/run", json={**payload, "code": CODE})
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["message"].startswith("Raw provider data failed quality checks:")
    assert detail["data_quality"]["errors"]
    assert (
        detail["data_quality"]["provenance"]["data_version"]
        == "raw-upstream:unversioned"
    )
    assert "broken-date" not in response.text
    assert len(adapter.calls) == 1
    assert cache.get_cached(adapter.provider, "TEST") is None
    assert not store.root.exists()


def test_warning_only_upstream_keeps_preview_execution_identity_and_date_provenance(
    context,
):
    adapter, client, payload, store = context
    adapter.rows[2]["timestamp"] = START + timedelta(days=8)
    candles = adapter.loader.get_ohlcv("TEST", "1mo", "1d")
    cache.set_cached(adapter.provider, "TEST", candles, period="1mo", interval="1d")
    preview = client.post("/backtests/quality-preview", json=payload)
    assert preview.status_code == 200
    pre = preview.json()
    quality = pre["data_quality"]
    assert not quality["errors"]
    assert "elapsed_gap" in {i["code"] for i in quality["warnings"]}
    response = client.post(
        "/backtests/run",
        json={**payload, "code": CODE, "preview_data_version": pre["data_version"]},
    )
    assert response.status_code == 200, response.text
    run = response.json()
    assert run["status"] == "ok"
    assert run["meta"]["data_quality"] == quality
    assert run["meta"]["data_version"] == pre["data_version"]
    assert len(adapter.calls) == 1  # Cache preview and execution never refetch.
    if adapter.provider == "twelvedata":
        saved = store.for_owner("offline-fixture").read(run["run_id"])
        assert saved["meta"]["data_quality"] == quality
        assert saved["config"]["date_range"] == {
            "start": quality["provenance"]["start"],
            "end": quality["provenance"]["end"],
        }
    else:
        assert run["persistence"]["reason"] == "guest" and not store.root.exists()


def test_changed_adapter_snapshot_rejects_old_preview_without_engine(
    context, monkeypatch
):
    adapter, client, payload, _ = context
    cache.set_cached(
        adapter.provider,
        "TEST",
        adapter.loader.get_ohlcv("TEST", "1mo", "1d"),
        period="1mo",
        interval="1d",
    )
    version = client.post("/backtests/quality-preview", json=payload).json()[
        "data_version"
    ]
    adapter.rows[0]["volume"] = 11
    cache.set_cached(
        adapter.provider,
        "TEST",
        adapter.loader.get_ohlcv("TEST", "1mo", "1d"),
        period="1mo",
        interval="1d",
    )

    def forbidden(*args, **kwargs):
        pytest.fail("Changed snapshot must not start strategy engine")

    monkeypatch.setattr(bt, "run_strategy", forbidden)
    response = client.post(
        "/backtests/run",
        json={**payload, "code": CODE, "preview_data_version": version},
    )
    assert response.status_code == 409
    assert (
        response.json()["detail"]["data_quality"]["provenance"]["data_version"]
        != version
    )


def test_loader_reference_is_actual_canonical_pipeline():
    assert bt._load_frame is sw._load_research_frame

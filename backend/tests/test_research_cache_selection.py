"""Switching and reloading providers must change the research cache selection."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.market import cache
from backend.routes import analytics_routes, indicator_routes
from backend.tests._analytics_helpers import make_candles


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(cache, "_data_cache", {})
    monkeypatch.setattr(cache, "_csv_keys", set())
    app = FastAPI()
    app.include_router(indicator_routes.router)
    app.include_router(analytics_routes.router)
    return TestClient(app)


@pytest.mark.parametrize("endpoint", ["sma", "ema", "bbands"])
def test_indicator_uses_latest_provider_and_then_latest_reload(client, endpoint):
    cache.set_cached("yfinance", "TEST", make_candles([100, 100, 100]))
    cache.set_cached("twelvedata", "TEST", make_candles([200, 200, 200]))
    path = f"/data/indicators/{endpoint}"
    field = "middle" if endpoint == "bbands" else "value"
    first = client.get(path, params={"symbol": "TEST", "period": 2})
    assert first.status_code == 200
    assert first.json()["points"][-1][field] == 200
    cache.set_cached("yfinance", "TEST", make_candles([300, 300, 300]))
    reloaded = client.get(path, params={"symbol": "TEST", "period": 2})
    assert reloaded.json()["points"][-1][field] == 300


def test_csv_reload_becomes_the_latest_selected_data(client):
    cache.set_cached_csv("TEST", make_candles([100, 100, 100]))
    cache.set_cached("yfinance", "TEST", make_candles([200, 200, 200]))
    response = client.get(
        "/data/indicators/sma", params={"symbol": "TEST", "period": 2}
    )
    assert response.json()["points"][-1]["value"] == 200
    cache.set_cached_csv("TEST", make_candles([300, 300, 300]))
    response = client.get(
        "/data/indicators/sma", params={"symbol": "TEST", "period": 2}
    )
    assert response.json()["points"][-1]["value"] == 300


def test_analytics_and_benchmark_fetch_use_latest_candles_and_metadata(
    client, monkeypatch
):
    old = make_candles([100, 100, 100, 100])
    new = make_candles([100, 110, 90, 120])
    cache.set_cached("yfinance", "TEST", old, period="1mo", interval="1d")
    cache.set_cached("twelvedata", "TEST", new, period="1y", interval="1h")
    assert analytics_routes._find_candles("TEST") == new
    assert analytics_routes._find_meta("TEST") == ("twelvedata", "1y", "1h")
    seen = []

    def fetch(**kwargs):
        seen.append(kwargs)
        return new

    monkeypatch.setattr(analytics_routes, "load_yfinance", fetch)
    response = client.get(
        "/data/analytics/correlation", params={"symbol": "TEST", "benchmarks": "SPY"}
    )
    assert response.status_code == 200
    assert seen == [{"symbol": "SPY", "period": "1y", "interval": "1h"}]


@pytest.mark.parametrize("path", ["/data/analytics/sharpe", "/data/analytics/sortino"])
@pytest.mark.parametrize("rf", ["NaN", "Infinity", "-Infinity"])
def test_nonfinite_risk_free_rate_is_rejected(client, path, rf):
    cache.set_cached("yfinance", "TEST", make_candles([100, 110, 90, 120]))
    assert client.get(path, params={"symbol": "TEST", "rf": rf}).status_code == 422

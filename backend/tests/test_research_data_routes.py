"""Research route regressions with no database or live provider access."""

import asyncio
from types import SimpleNamespace

import pytest
import requests
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from backend.core.auth_deps import get_current_user, optional_current_user
from backend.core.database import DatabaseError
from backend.market import cache
from backend.models.auth_models import AuthUserInfo
from backend.routes import (
    backtest_routes,
    portfolio_routes,
    robustness_routes,
    sweep_routes,
)
from backend.tests._analytics_helpers import make_candles

CODE = "def on_bar(ctx):\n    pass\n"
PAYLOAD = {"code": CODE, "symbol": "TEST", "provider": "twelvedata"}
USER = AuthUserInfo(id="researcher")


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(cache, "_data_cache", {})
    app = FastAPI()
    for module in (sweep_routes, backtest_routes, robustness_routes, portfolio_routes):
        app.include_router(module.router)
    app.dependency_overrides[optional_current_user] = lambda: USER
    app.dependency_overrides[get_current_user] = lambda: USER
    return TestClient(app)


@pytest.mark.parametrize(
    "module,path,method,extra",
    [
        (backtest_routes, "/backtests/run", "post", {}),
        (robustness_routes, "/backtests/robustness", "post", {}),
        (sweep_routes, "/sweeps", "post", {"vary": []}),
        (
            sweep_routes,
            "/sweeps/walk-forward",
            "post",
            {"vary": [], "is_len": 20, "oos_len": 20, "step": 20},
        ),
        (sweep_routes, "/sweeps/done/trial/0", "get", {}),
    ],
)
def test_research_routes_forward_the_signed_in_user(
    client, monkeypatch, module, path, method, extra
):
    async def load(body, user=None):
        assert user == USER
        raise HTTPException(418, "User context reached data loading")

    monkeypatch.setattr(module, "_load_frame", load)
    monkeypatch.setattr(
        sweep_routes._registry,
        "get",
        lambda sid: SimpleNamespace(result={"trials": [{"trial_id": 0}]}),
    )
    payload = {**PAYLOAD, **extra}
    if method == "get":
        response = client.get(path, params=payload)
    else:
        response = client.post(path, json=payload)
    assert response.status_code == 418


def test_cold_cache_twelve_data_uses_the_account_key(client, monkeypatch):
    from backend.market.data_sources import twelvedataprovider

    accounts = []
    monkeypatch.setattr(
        twelvedataprovider,
        "fetch_api_key",
        lambda uid, provider: accounts.append((uid, provider)) or "test-key",
    )
    monkeypatch.setattr(
        twelvedataprovider.requests,
        "get",
        lambda *args, **kwargs: SimpleNamespace(
            raise_for_status=lambda: None,
            json=lambda: {"values": []},
        ),
    )
    response = client.post("/backtests/run", json=PAYLOAD)
    assert response.status_code == 404
    assert accounts == [(USER.id, "twelvedata")]


def test_twelve_data_without_auth_is_actionable_even_with_warm_cache(client):
    client.app.dependency_overrides[optional_current_user] = lambda: None
    cache.set_cached("twelvedata", "TEST", make_candles([100, 101]))
    response = client.post("/backtests/run", json=PAYLOAD)
    assert response.status_code == 401
    assert "authentication" in response.json()["detail"]
    assert response.headers["www-authenticate"] == "Bearer"


@pytest.mark.parametrize("provider", ["yfinance", "binance"])
def test_public_provider_cold_cache_still_accepts_anonymous(
    client, monkeypatch, provider
):
    client.app.dependency_overrides[optional_current_user] = lambda: None
    seen = []

    def fetch(*args):
        seen.append(args[-1])
        return []

    monkeypatch.setattr(sweep_routes, "_fetch_candles_blocking", fetch)
    response = client.post("/backtests/run", json={**PAYLOAD, "provider": provider})
    assert response.status_code == 404
    assert seen == [None]


@pytest.mark.parametrize(
    "error",
    [
        requests.Timeout("timeout"),
        requests.ConnectionError("offline"),
        RuntimeError("provider returned private configuration"),
    ],
)
def test_provider_transport_failure_returns_502(client, monkeypatch, error):
    def fetch(*args):
        raise error

    monkeypatch.setattr(sweep_routes, "_fetch_candles_blocking", fetch)
    response = client.post("/backtests/run", json=PAYLOAD)
    assert response.status_code == 502
    assert response.json()["detail"] == "Market data provider request failed"


def test_provider_configuration_failure_returns_sanitized_502(client, monkeypatch):
    def fetch(*args):
        raise DatabaseError("private connection details")

    monkeypatch.setattr(sweep_routes, "_fetch_candles_blocking", fetch)
    response = client.post("/backtests/run", json=PAYLOAD)
    assert response.status_code == 502
    assert (
        response.json()["detail"]
        == "Database error while loading provider configuration."
    )


def test_missing_key_retains_settings_guidance(client, monkeypatch):
    def fetch(*args):
        raise ValueError(
            "No twelvedata API key configured. Add one in API Keys settings."
        )

    monkeypatch.setattr(sweep_routes, "_fetch_candles_blocking", fetch)
    response = client.post("/backtests/run", json=PAYLOAD)
    assert response.status_code == 400
    assert "API Keys settings" in response.json()["detail"]


def test_data_version_changes_when_prices_change_without_changing_bar_count(
    monkeypatch,
):
    monkeypatch.setattr(cache, "_data_cache", {})
    body = sweep_routes._DataRequest(**{**PAYLOAD, "provider": "yfinance"})
    cache.set_cached(
        "yfinance", "TEST", make_candles([100, 101]), period="1y", interval="1d"
    )
    _, first = asyncio.run(sweep_routes._load_frame(body))
    cache.set_cached(
        "yfinance", "TEST", make_candles([100, 102]), period="1y", interval="1d"
    )
    _, changed = asyncio.run(sweep_routes._load_frame(body))
    _, repeated = asyncio.run(sweep_routes._load_frame(body))
    assert changed != first
    assert changed == repeated


@pytest.mark.parametrize("cash", [0, -1, "NaN", "Infinity", "-Infinity"])
@pytest.mark.parametrize(
    "path,extra",
    [
        ("/backtests/run", {}),
        ("/sweeps", {"vary": []}),
        ("/sweeps/walk-forward", {"vary": [], "is_len": 20, "oos_len": 20, "step": 20}),
        ("/portfolio-backtests/run", {"symbols": ["TEST"]}),
    ],
)
def test_invalid_starting_cash_is_rejected_before_execution(
    client, monkeypatch, cash, path, extra
):
    async def must_not_load(*args):
        pytest.fail("Invalid cash must be rejected before loading data")

    for module in (sweep_routes, backtest_routes):
        monkeypatch.setattr(module, "_load_frame", must_not_load)
    response = client.post(path, json={**PAYLOAD, **extra, "starting_cash": cash})
    assert response.status_code == 422


@pytest.mark.parametrize(
    "path,extra",
    [
        ("/backtests/run", {}),
        ("/sweeps", {"vary": []}),
        ("/sweeps/walk-forward", {"vary": [], "is_len": 20, "oos_len": 20, "step": 20}),
    ],
)
def test_whitespace_symbol_is_rejected_before_loading(client, monkeypatch, path, extra):
    response = client.post(path, json={**PAYLOAD, **extra, "symbol": "   "})
    assert response.status_code == 422


@pytest.mark.parametrize(
    "declaration",
    [
        "Int(1, 4, step=0)",
        "Int(4, 1)",
        "Int(1, 4, step=-1)",
        "Int(1.5, 4)",
        "Float(1, 4, step=0)",
        "Float(4, 1)",
        "Float(1, 4, step=-1)",
        "Float(1, float('inf'))",
        "Choice([])",
    ],
)
@pytest.mark.parametrize(
    "path", ["/backtests/run", "/sweeps/schema", "/portfolio-backtests/run"]
)
def test_invalid_parameter_grid_is_a_client_error(client, declaration, path):
    code = f"params = {{'qty': {declaration}}}\n{CODE}"
    response = client.post(path, json={**PAYLOAD, "symbols": ["TEST"], "code": code})
    assert response.status_code == 400
    assert "parameter" in response.json()["detail"].lower()


@pytest.mark.parametrize(
    "override",
    [
        {"search": "typo"},
        {"metric": "typo"},
        {"n_random": 0},
        {"n_random": -1},
        {"n_random": 10_001},
    ],
)
def test_invalid_sweep_options_are_rejected_before_fetching(
    client, monkeypatch, override
):
    async def must_not_load(*args):
        pytest.fail("Invalid options must be rejected before loading data")

    monkeypatch.setattr(sweep_routes, "_load_frame", must_not_load)
    response = client.post("/sweeps", json={**PAYLOAD, "vary": [], **override})
    assert response.status_code == 422


@pytest.mark.parametrize("provider", ["twelvedata", "binance"])
def test_portfolio_does_not_silently_use_a_different_provider(
    client, monkeypatch, provider
):
    monkeypatch.setattr(
        portfolio_routes,
        "_store",
        lambda: pytest.fail("Unsupported provider must not read yfinance data"),
    )
    response = client.post(
        "/portfolio-backtests/run",
        json={**PAYLOAD, "symbols": ["TEST"], "provider": provider},
    )
    assert response.status_code == 400
    assert "yfinance" in response.json()["detail"]

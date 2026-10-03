from fastapi.testclient import TestClient
import pytest

from backend.app import app
from backend.core.auth_deps import get_current_user
from backend.models.auth_models import AuthUserInfo
from backend.routes import robustness_routes
from backend.tests.test_robustness import CODE, market_frame
from backend.trial_app import app as examples_app


@pytest.fixture
def client(monkeypatch):
    async def load(body):
        assert body.symbol == "TEST"
        assert body.provider.value == "yfinance"
        return market_frame(), "stub"

    monkeypatch.setattr(robustness_routes, "_load_frame", load)
    app.dependency_overrides[get_current_user] = lambda: AuthUserInfo(
        id="test-researcher"
    )
    yield TestClient(app)
    app.dependency_overrides.pop(get_current_user, None)


def payload(**overrides):
    return {"code": CODE, "symbol": "TEST", "provider": "yfinance", **overrides}


def test_workspace_endpoint_uses_selected_data(client):
    response = client.post("/backtests/robustness", json=payload())
    assert response.status_code == 200, response.text
    assert response.json()["dataset"]["id"] == "yfinance:TEST"
    assert response.json()["config"]["params"] == {"qty": 1}


def test_endpoint_requires_authentication(monkeypatch):
    def must_not_run(*args, **kwargs):
        pytest.fail("Anonymous request must not execute code or fetch data")

    monkeypatch.setattr(robustness_routes, "_load_frame", must_not_run)
    assert (
        TestClient(app).post("/backtests/robustness", json=payload()).status_code == 401
    )


def test_unsafe_code_is_rejected_before_data_fetch(client, monkeypatch):
    def must_not_run(*args):
        pytest.fail("Unsafe source must fail before fetching data")

    monkeypatch.setattr(robustness_routes, "_load_frame", must_not_run)
    response = client.post("/backtests/robustness", json=payload(code="import os"))
    assert response.status_code == 400
    assert "strategy rejected" in response.json()["detail"]


def test_errors_and_invalid_inputs_are_actionable(client):
    assert (
        client.post(
            "/backtests/robustness", json=payload(holdout_fraction=0.9)
        ).status_code
        == 422
    )
    response = client.post("/backtests/robustness", json=payload(params={"qty": 50}))
    assert response.status_code == 400
    assert "declared grid" in response.json()["detail"]
    assert client.post("/backtests/robustness", json=payload()).status_code == 200


def test_capacity_is_bounded_and_released(client):
    capacity = robustness_routes._CAPACITY
    assert capacity.acquire(blocking=False)
    assert capacity.acquire(blocking=False)
    try:
        assert client.post("/backtests/robustness", json=payload()).status_code == 429
    finally:
        capacity.release()
        capacity.release()
    assert client.post("/backtests/robustness", json=payload()).status_code == 200


def test_examples_server_never_accepts_user_strategy():
    assert (
        TestClient(examples_app)
        .post("/backtests/robustness", json=payload())
        .status_code
        == 404
    )

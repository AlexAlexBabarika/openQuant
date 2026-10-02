"""The trial router stands alone without database or data-provider startup."""

from __future__ import annotations

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import backend.trial.report as reports
from backend.routes.trial_routes import router
from backend.trial.models import TrialConfig, TrialReport

app = FastAPI()
app.include_router(router)
client = TestClient(app)


def test_catalog_contract_and_defaults() -> None:
    response = client.get("/trial/catalog")
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"schema_version", "strategies"}
    assert body["schema_version"] == 1
    assert [strategy["id"] for strategy in body["strategies"]] == [
        "backtest-billionaire",
        "overcaffeinated-trader",
        "boring-benchmark",
    ]
    assert all(
        set(strategy) == {"id", "name", "description", "lesson"}
        for strategy in body["strategies"]
    )
    response = client.post("/trial/run", json={"strategy_id": "boring-benchmark"})
    assert response.status_code == 200
    report = TrialReport.model_validate(response.json())
    assert report.config == TrialConfig(
        strategy_id="boring-benchmark", commission_bps=1, slippage_bps=5
    )
    assert set(response.json()) == set(TrialReport.model_fields)


@pytest.mark.parametrize(
    "strategy_id",
    ["backtest-billionaire", "overcaffeinated-trader", "boring-benchmark"],
)
@pytest.mark.parametrize("bps", [0, 50])
def test_valid_requests_serialize_finite_reports(strategy_id: str, bps: int) -> None:
    response = client.post(
        "/trial/run",
        json={"strategy_id": strategy_id, "commission_bps": bps, "slippage_bps": bps},
    )
    assert response.status_code == 200
    report = TrialReport.model_validate(response.json())
    assert report.schema_version == 1
    assert report.config.commission_bps == bps
    assert report.config.slippage_bps == bps
    json.dumps(response.json(), allow_nan=False)


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"strategy_id": "unknown"},
        {"strategy_id": "boring-benchmark", "code": "private arbitrary source"},
        {"strategy_id": "boring-benchmark", "dataset": []},
        {"strategy_id": "boring-benchmark", "starting_cash": 1_000_000},
        {"strategy_id": "boring-benchmark", "commission_bps": -0.1},
        {"strategy_id": "boring-benchmark", "slippage_bps": 50.0001},
        {"strategy_id": "boring-benchmark", "commission_bps": 50.0001},
        {"strategy_id": "boring-benchmark", "slippage_bps": -1},
        {"strategy_id": "boring-benchmark", "commission_bps": "1"},
        {"strategy_id": "boring-benchmark", "slippage_bps": True},
        {"strategy_id": "boring-benchmark", "commission_bps": False},
        {"strategy_id": "boring-benchmark", "slippage_bps": None},
        {"strategy_id": ["boring-benchmark"]},
        {"strategy_id": 1},
    ],
)
def test_rejects_unknown_extra_or_out_of_bounds_input(payload: dict) -> None:
    response = client.post("/trial/run", json=payload)
    assert response.status_code == 422
    assert "private arbitrary source" not in response.text
    json.dumps(response.json(), allow_nan=False)


@pytest.mark.parametrize("field", ["commission_bps", "slippage_bps"])
@pytest.mark.parametrize("value", ["NaN", "Infinity", "-Infinity", "1e309"])
def test_nonfinite_raw_json_is_rejected_without_serialization_failure(
    field: str, value: str
) -> None:
    response = client.post(
        "/trial/run",
        content=f'{{"strategy_id":"boring-benchmark", "{field}":{value}}}',
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 422
    json.dumps(response.json(), allow_nan=False)
    assert all("input" not in error for error in response.json()["detail"])


def test_malformed_json_and_list_are_rejected() -> None:
    assert (
        client.post(
            "/trial/run", content="{", headers={"Content-Type": "application/json"}
        ).status_code
        == 422
    )
    assert client.post("/trial/run", json=[]).status_code == 422


def test_busy_response_is_bounded_and_retryable() -> None:
    with reports._REPORT_LOCK:
        response = client.post("/trial/run", json={"strategy_id": "boring-benchmark"})
    assert response.status_code == 503
    assert response.headers["Retry-After"] == "1"
    assert client.get("/trial/catalog").status_code == 200
    assert (
        client.post("/trial/run", json={"strategy_id": "boring-benchmark"}).status_code
        == 200
    )

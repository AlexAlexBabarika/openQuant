"""Standalone guest options router tests require no datastore or providers."""

from __future__ import annotations

import json
from collections import defaultdict, deque

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.core import rate_limit
from backend.derivatives import OptionsAnalysis, analyze_options
from backend.derivatives import runner
from backend.routes import options_routes as routes
from backend.tests.test_options_runner import EXPORT_SOURCE, request_payload


@pytest.fixture
def client(monkeypatch) -> TestClient:
    monkeypatch.setattr(routes, "allow", lambda key: True)
    app = FastAPI()
    app.include_router(routes.router)
    return TestClient(app)


def test_guest_analyze_matches_canonical_and_echoes_defaults(client) -> None:
    response = client.post("/options/analyze", json=request_payload())
    assert response.status_code == 200, response.text
    assert response.json() == analyze_options(request_payload()).model_dump(mode="json")
    assert response.json()["request"]["volatility"] == 0.2
    assert "stdout" not in response.json()


def test_guest_python_export_is_direct_contract_and_stdout(client) -> None:
    response = client.post(
        "/options/python", json={"source": EXPORT_SOURCE + 'print("research")'}
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert result.pop("stdout") == "research\n"
    assert result == analyze_options(result["request"]).model_dump(mode="json")
    assert set(result) == set(OptionsAnalysis.model_fields)


def test_python_without_stdout_preserves_null_greeks_and_defaults(client) -> None:
    source = EXPORT_SOURCE.replace("days_to_expiry=30", "days_to_expiry=0").replace(
        '"elapsed_days": 10', '"elapsed_days": 0'
    )
    response = client.post("/options/python", json={"source": source})
    assert response.status_code == 200, response.text
    result = response.json()
    assert "stdout" not in result
    assert result["greeks"]["delta"] is None
    assert result["request"]["strategy"]["currency"] == "USD"
    assert result == analyze_options(result["request"]).model_dump(mode="json")


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"source": ""},
        {"source": 1},
        {"source": "x" * 20001},
        {"source": "x=1", "timeout_s": 30},
        {"code": "x=1"},
        {"source": "x=1", "memory_mb": 1024},
    ],
)
def test_python_envelope_is_bounded_strict_and_source_not_echoed(
    client, payload
) -> None:
    response = client.post("/options/python", json=payload)
    assert response.status_code == 422
    assert all("input" not in e and "ctx" not in e for e in response.json()["detail"])


@pytest.mark.parametrize(
    "field,value",
    [
        ("spot", 0),
        ("spot", True),
        ("volatility", "0.2"),
        ("spot_grid", [100, 90]),
        ("spot_grid", [1]),
        ("spot_grid", list(range(202))),
        ("scenarios", [{"name": str(i)} for i in range(4)]),
        ("provider", "yahoo"),
    ],
)
def test_analysis_request_invalid_or_out_of_bounds(client, field, value) -> None:
    payload = request_payload()
    payload[field] = value
    assert client.post("/options/analyze", json=payload).status_code == 422


def test_leg_limit_and_enabled_leg_validation(client) -> None:
    payload = request_payload()
    payload["strategy"]["legs"] *= 17
    assert client.post("/options/analyze", json=payload).status_code == 422
    payload = request_payload()
    payload["strategy"]["legs"][0]["enabled"] = False
    assert client.post("/options/analyze", json=payload).status_code == 422


@pytest.mark.parametrize("value", ["NaN", "Infinity", "-Infinity", "1e309"])
def test_nonfinite_http_input_returns_json_safe_422(client, value) -> None:
    raw = json.dumps(request_payload()).replace('"spot": 100', f'"spot": {value}')
    response = client.post(
        "/options/analyze", content=raw, headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 422
    json.dumps(response.json(), allow_nan=False)
    assert all("input" not in e for e in response.json()["detail"])


@pytest.mark.parametrize("endpoint", ["analyze", "python"])
@pytest.mark.parametrize("raw", ["{", "[]", "null"])
def test_malformed_or_wrong_body(client, endpoint, raw) -> None:
    response = client.post(
        f"/options/{endpoint}",
        content=raw,
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 422


def test_deeply_nested_request_fails_without_server_error(client) -> None:
    response = client.post(
        "/options/analyze",
        content="[" * 2000 + "0" + "]" * 2000,
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 422


def test_maximum_canonical_input_remains_supported(client) -> None:
    payload = request_payload()
    payload["strategy"]["legs"] *= 16
    payload["spot_grid"] = list(range(201))
    payload["scenarios"] = [
        {"name": str(i), "elapsed_days": i, "iv_shift_pp": i} for i in range(3)
    ]
    response = client.post("/options/analyze", json=payload)
    assert response.status_code == 200, response.text
    assert response.json() == analyze_options(payload).model_dump(mode="json")


@pytest.mark.parametrize(
    "source",
    [
        "import os",
        "result =",
        "x = 1",
        "result = float('nan')",
        "OptionLeg(kind='call',quantity=0,strike=100)",
    ],
)
def test_bad_source_has_clear_400(client, source) -> None:
    response = client.post("/options/python", json={"source": source})
    assert response.status_code == 400
    assert isinstance(response.json()["detail"], str)
    json.dumps(response.json(), allow_nan=False)


@pytest.mark.parametrize("endpoint", ["analyze", "python"])
def test_timeout_and_busy_are_clear_retryable_errors(
    client, monkeypatch, endpoint
) -> None:
    body = request_payload() if endpoint == "analyze" else {"source": "x=1"}

    def timed_out(*args):
        raise runner.OptionsTimeoutError("Options analysis timed out")

    name = "run_options_analysis" if endpoint == "analyze" else "run_options_python"
    monkeypatch.setattr(routes, name, timed_out)
    response = client.post(f"/options/{endpoint}", json=body)
    assert response.status_code == 408
    assert "timed out" in response.json()["detail"]

    def busy(*args):
        raise runner.OptionsBusyError("Options workers are busy; retry shortly")

    monkeypatch.setattr(routes, name, busy)
    response = client.post(f"/options/{endpoint}", json=body)
    assert response.status_code == 503
    assert response.headers["Retry-After"] == "1"


def test_shared_rate_limit_and_retry_header(client, monkeypatch) -> None:
    monkeypatch.setattr(routes, "allow", rate_limit.allow)
    monkeypatch.setattr(rate_limit, "_MAX", 1)
    monkeypatch.setattr(
        rate_limit,
        "_windows",
        defaultdict(deque),
    )
    # Invalid attempts also consume the options bucket, without spawning.
    assert client.post("/options/analyze", json={}).status_code == 422
    response = client.post("/options/python", json={"source": "import os"})
    assert response.status_code == 429
    assert int(response.headers["Retry-After"]) >= 1
    assert set(rate_limit._windows) == {"options:testclient"}


@pytest.mark.parametrize("endpoint", ["analyze", "python"])
def test_request_body_size_cap_including_without_content_length(
    client, endpoint
) -> None:
    def chunks():
        yield b'{"source":"'
        yield b" " * routes.MAX_REQUEST_BYTES
        yield b'"}'

    response = client.post(
        f"/options/{endpoint}",
        content=chunks(),
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 413


def test_openapi_exposes_canonical_schema_and_no_auth_or_tuning(client) -> None:
    schema = client.get("/openapi.json").json()
    assert set(schema["paths"]) == {"/options/analyze", "/options/python"}
    components = schema["components"]["schemas"]
    assert set(components["OptionsAnalysis"]["properties"]) == set(
        OptionsAnalysis.model_fields
    )
    assert set(components["OptionsPythonRequest"]["properties"]) == {"source"}
    assert "securitySchemes" not in schema["components"]

"""Standalone research HTTP tests: no datastore, network or provider credentials."""

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.derivatives.research import analyze_distribution, evaluate_lifecycle
from backend.routes import options_research_routes as routes
from backend.routes import options_routes
from backend.tests.test_options_research_distribution import distribution_payload
from backend.tests.test_options_research_finder import finder_payload
from backend.tests.test_options_research_paths import lifecycle_payload


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(options_routes, "allow", lambda _: True)
    app = FastAPI()
    app.include_router(routes.router)
    return TestClient(app)


@pytest.mark.parametrize(
    "kind,payload",
    [
        ("finder", finder_payload()),
        ("lifecycle", lifecycle_payload()),
        ("hedge", {**lifecycle_payload(), "policy": {"mode": "daily"}}),
        ("distribution", distribution_payload(integration_points=1024)),
    ],
)
def test_guest_routes_run_in_bounded_worker_and_return_finite_canonical_response(
    client, kind, payload
):
    response = client.post(f"/options/research/{kind}", json=payload)
    assert response.status_code == 200, response.text
    expected = routes._FUNCTIONS[kind](payload).model_dump(mode="json")
    assert response.json() == expected
    assert len(response.content) <= routes.MAX_OUTPUT_BYTES
    json.dumps(response.json(), allow_nan=False)


@pytest.mark.parametrize("kind", ["finder", "lifecycle", "hedge", "distribution"])
def test_invalid_requests_do_not_echo_inputs_or_secrets(client, kind):
    response = client.post(
        f"/options/research/{kind}", json={"annual_drift": "super-secret-marker"}
    )
    assert response.status_code == 422
    assert "super-secret-marker" not in response.text
    assert '"input"' not in response.text


def test_research_uses_existing_request_cap(client):
    response = client.post("/options/research/distribution", content=b"x" * 131073)
    assert response.status_code == 413


def test_research_uses_existing_options_rate_limit(client, monkeypatch):
    monkeypatch.setattr(options_routes, "allow", lambda _: False)
    response = client.post(
        "/options/research/distribution", json=distribution_payload()
    )
    assert response.status_code == 429
    assert response.headers["retry-after"]


def test_all_options_endpoints_share_worker_slots_and_release_after_failure(
    client, monkeypatch
):
    assert routes._WORKERS.acquire(blocking=False)
    assert routes._WORKERS.acquire(blocking=False)
    try:
        response = client.post(
            "/options/research/distribution", json=distribution_payload()
        )
        assert response.status_code == 503
        assert response.headers["retry-after"] == "1"
    finally:
        routes._WORKERS.release()
        routes._WORKERS.release()
    monkeypatch.setattr(routes, "spawn_and_collect", lambda *_: (None, True, None))
    for _ in range(3):
        assert (
            client.post(
                "/options/research/distribution", json=distribution_payload()
            ).status_code
            == 408
        )


@pytest.mark.parametrize(
    "payload,status,contains",
    [
        (None, 400, "exited without a result"),
        (
            {"status": "error", "error": "Explicit invalid assumption"},
            400,
            "Explicit invalid assumption",
        ),
        ({"status": "ok", "result": b"{}"}, 400, "Invalid research worker result"),
        (
            {"status": "oversize", "error": "reduce path points"},
            413,
            "reduce path points",
        ),
    ],
)
def test_worker_errors_map_to_explicit_http_statuses(
    client, monkeypatch, payload, status, contains
):
    monkeypatch.setattr(routes, "spawn_and_collect", lambda *_: (payload, False, None))
    response = client.post(
        "/options/research/distribution", json=distribution_payload()
    )
    assert response.status_code == status
    assert contains in response.text


def test_computation_assumption_error_is_400_not_validation_error(client):
    data = lifecycle_payload()
    data["analysis"]["strategy"]["days_to_expiry"] = 3650
    data["analysis"]["volatility"] = 5
    data["path"] = {
        "source": "synthetic",
        "horizon_days": 3650,
        "steps": 365,
        "annual_drift": 1,
        "annual_volatility": 0,
        "seed": 1,
    }
    response = client.post("/options/research/lifecycle", json=data)
    assert response.status_code == 400, response.text
    assert "no clipping applied" in response.text


def maximum_ledger_payload():
    data = lifecycle_payload()
    # Every supplied point remains live; settlement vertices add sixteen distinct rows.
    expiries = [i for i in range(1, 20) if i % 10][:16]
    data["analysis"]["strategy"]["days_to_expiry"] = 3650
    data["analysis"]["strategy"]["legs"] = [
        {
            "kind": "call",
            "strike": 100 + i,
            "quantity": (-1) ** i,
            "days_to_expiry": 3500 + expiry,
        }
        for i, expiry in enumerate(expiries)
    ]
    data["path"]["points"] = [{"day": i * 10, "spot": 100 + i / 10} for i in range(366)]
    return data


def test_maximum_382_row_16_leg_model_is_finite_and_not_silently_truncated():
    result = evaluate_lifecycle(maximum_ledger_payload())
    assert len(result.ledger) == 382
    assert all(len(row.legs) == 16 for row in result.ledger)
    assert (
        len(json.dumps(result.model_dump(), allow_nan=False)) > routes.MAX_OUTPUT_BYTES
    )
    with pytest.raises(routes._OutputTooLarge, match="reduce path points"):
        routes._encode(result)


@pytest.mark.parametrize("kind", ["lifecycle", "hedge"])
def test_oversize_max_shape_http_has_explicit_413_not_truncated_evidence(client, kind):
    data = maximum_ledger_payload()
    if kind == "hedge":
        data["policy"] = {"mode": "daily"}
    response = client.post(f"/options/research/{kind}", json=data)
    assert response.status_code == 413, response.text
    assert "reduce path points, legs or result limit" in response.text


@pytest.mark.parametrize("kind", ["lifecycle", "hedge"])
def test_maximum_366_supplied_points_single_leg_fits_http_limit(client, kind):
    data = maximum_ledger_payload()
    data["analysis"]["strategy"]["legs"] = data["analysis"]["strategy"]["legs"][:1]
    if kind == "hedge":
        data["policy"] = {"mode": "daily"}
    response = client.post(f"/options/research/{kind}", json=data)
    assert response.status_code == 200, response.text
    assert len(response.json()["ledger"]) == 367
    assert len(response.content) < routes.MAX_OUTPUT_BYTES


def test_child_applies_resource_and_network_guards_and_arithmetic_errors_are_not_size_errors(
    monkeypatch,
):
    calls = []
    monkeypatch.setattr(
        routes, "_apply_resource_limits", lambda _: calls.append("limits")
    )
    monkeypatch.setattr(routes, "_block_network", lambda: calls.append("network"))

    def overflow(_):
        calls.append("compute")
        raise OverflowError("Financial overflow")

    class Connection:
        def send(self, payload):
            self.payload = payload

        def close(self):
            calls.append("close")

    monkeypatch.setitem(routes._FUNCTIONS, "distribution", overflow)
    conn = Connection()
    routes._research_child(conn, "distribution", {})
    assert conn.payload == {"status": "error", "error": "Financial overflow"}
    assert calls == ["limits", "network", "compute", "close"]


def test_extreme_distribution_bound_remains_small_and_finite(client):
    data = distribution_payload(bins=100)
    response = client.post("/options/research/distribution", json=data)
    assert response.status_code == 200, response.text
    assert response.json() == analyze_distribution(data).model_dump(mode="json")
    assert len(response.content) < 100_000


def test_maximum_finder_budget_dense_context_stays_within_worker_and_output_limits(
    client,
):
    data = finder_payload()
    data["universe"] = [
        {"kind": kind, "quantity": 1, "strike": strike, "entry_premium": 2}
        for kind, start in [("put", 80), ("call", 109)]
        for strike in range(start, start + 12)
    ]
    data["analysis"].update(
        spot_grid=list(range(201)),
        surface={
            "axis": "elapsed_days",
            "spots": list(range(41)),
            "steps": list(range(21)),
        },
        scenarios=[{"name": "later", "elapsed_days": 20}],
    )
    response = client.post("/options/research/finder", json=data)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["searched_count"] == 2000 and result["search_truncated"]
    assert len(result["candidates"]) == 20
    assert len(response.content) < routes.MAX_OUTPUT_BYTES
    assert all(row["request"]["surface"] is None for row in result["candidates"])

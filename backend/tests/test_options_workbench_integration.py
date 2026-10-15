"""Production app route registration and shared canonical workbench contract."""

from fastapi.testclient import TestClient

from backend.app import app
from backend.routes import options_routes
from backend.tests.test_options_research_finder import finder_payload
from backend.tests.test_options_research_distribution import distribution_payload


def test_production_app_registers_every_research_and_authenticated_chain_route():
    paths = app.openapi()["paths"]
    for kind in ("finder", "lifecycle", "hedge", "distribution"):
        assert "post" in paths[f"/options/research/{kind}"]
    client = TestClient(app)
    for kind in ("status", "expirations", "chain"):
        assert "get" in paths[f"/options/chains/{kind}"]
        response = client.get(f"/options/chains/{kind}")
        assert response.status_code == 401


def test_integrated_finder_candidate_uses_legacy_analyzer_without_wire_conversion(
    monkeypatch,
):
    monkeypatch.setattr(options_routes, "allow", lambda _: True)
    client = TestClient(app)
    found = client.post("/options/research/finder", json=finder_payload())
    assert found.status_code == 200, found.text
    candidate = found.json()["candidates"][0]
    analyzed = client.post("/options/analyze", json=candidate["request"])
    assert analyzed.status_code == 200, analyzed.text
    assert analyzed.json()["summary"] == candidate["summary"]


def test_integrated_distribution_rejects_mixed_terminal_without_changing_legacy_horizon(
    monkeypatch,
):
    monkeypatch.setattr(options_routes, "allow", lambda _: True)
    client = TestClient(app)
    request = distribution_payload()
    leg = request["analysis"]["strategy"]["legs"][0]
    request["analysis"]["strategy"]["legs"] = [
        {**leg, "days_to_expiry": 15},
        {**leg, "days_to_expiry": 30, "quantity": -1},
    ]
    analyzed = client.post("/options/analyze", json=request["analysis"])
    assert analyzed.status_code == 200, analyzed.text
    body = analyzed.json()
    assert body["horizon"]["exact_terminal_available"] is False
    assert body["summary"]["max_loss"] is None
    assert body["expiry_curve"] == []
    assert body["summary"]["breakevens"] == []
    assert (
        client.post("/options/research/distribution", json=request).status_code == 422
    )

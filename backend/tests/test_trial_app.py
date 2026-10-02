"""The standalone app serves only local curated evidence and frontend assets."""

from pathlib import Path
import subprocess
import sys

import pytest
from fastapi.testclient import TestClient

from backend.app import app as research_app
from backend.trial_app import create_app


@pytest.fixture
def demo(tmp_path: Path) -> TestClient:
    (tmp_path / "index.html").write_text(
        '<html><head><title>OpenQuant</title></head><body><div id="app"></div></body></html>'
    )
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app.js").write_text("// local asset")
    (tmp_path / "fonts").mkdir()
    (tmp_path / "fonts" / "local.woff2").write_bytes(b"local-font")
    return TestClient(create_app(tmp_path))


def test_startup_catalog_and_runs_without_provider_or_database_imports() -> None:
    script = """
import sys
from fastapi.testclient import TestClient
from backend.trial_app import app
with TestClient(app) as client:
    assert client.get('/health').json() == {'status': 'ok', 'mode': 'trial-only'}
    catalog = client.get('/trial/catalog').json()
    for strategy in catalog['strategies']:
        response = client.post('/trial/run', json={'strategy_id': strategy['id']})
        assert response.status_code == 200
        assert response.json()['dataset']['synthetic'] is True
        assert response.json()['holdout']['strategy']['equity']
    assert not any(name.startswith(prefix) for name in sys.modules for prefix in (
        'backend.app', 'backend.core.database', 'backend.market',
        'backend.streaming', 'backend.backtesting.sandbox', 'psycopg', 'yfinance', 'binance'
    ))
"""
    subprocess.run([sys.executable, "-c", script], check=True, timeout=20)


@pytest.mark.parametrize("path", ["/", "/?workspace=1", "/index.html?workspace=1"])
def test_frontend_always_declares_demo_mode(demo: TestClient, path: str) -> None:
    response = demo.get(path)
    assert response.status_code == 200
    assert '<meta name="openquant-mode" content="trial-only" />' in response.text


def test_static_assets_are_local_and_html_cannot_bypass_mode(demo: TestClient) -> None:
    assert demo.get("/assets/app.js").text == "// local asset"
    assert demo.get("/fonts/local.woff2").content == b"local-font"
    assert demo.get("/assets/%2e%2e/index.html").status_code == 404


@pytest.mark.parametrize(
    "path",
    [
        "/auth/refresh",
        "/data/ohlcv",
        "/scripts/run",
        "/backtests/run",
        "/sweeps",
        "/strategies",
        "/portfolio",
    ],
)
def test_no_research_or_arbitrary_code_endpoints(demo: TestClient, path: str) -> None:
    assert demo.get(path).status_code == 404
    assert demo.post(path, json={"code": "untrusted"}).status_code == 404


def test_missing_frontend_has_actionable_response(tmp_path: Path) -> None:
    client = TestClient(create_app(tmp_path))
    assert client.get("/").status_code == 503
    assert "gen_dashboard_fixture.py" in client.get("/").text
    assert client.get("/trial/catalog").status_code == 200


def test_normal_app_registers_trial_without_replacing_research() -> None:
    client = TestClient(research_app)
    assert client.get("/trial/catalog").status_code == 200
    assert (
        client.post("/trial/run", json={"strategy_id": "boring-benchmark"}).status_code
        == 200
    )
    assert "/backtests/run" in research_app.openapi()["paths"]

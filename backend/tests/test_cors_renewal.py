import os
from pathlib import Path
import subprocess
import sys


def test_configured_cors_exposes_bearer_challenge():
    script = """
from backend.app import app
from fastapi.testclient import TestClient
client = TestClient(app)
for origin in ('https://workspace.example', 'https://other.example'):
    response = client.get('/user/profile', headers={
        'Origin': origin, 'Authorization': 'Bearer invalid-token',
    })
    assert response.status_code == 401, response.text
    assert response.headers['www-authenticate'] == 'Bearer'
    if origin == 'https://workspace.example':
        assert response.headers['access-control-allow-origin'] == origin
        assert response.headers['access-control-allow-credentials'] == 'true'
        exposed = response.headers.get('access-control-expose-headers', '').lower()
        assert 'www-authenticate' in exposed.split(', '), response.headers
    else:
        assert 'access-control-allow-origin' not in response.headers
"""
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=Path(__file__).resolve().parents[2],
        env={**os.environ, "CORS_ORIGINS": "https://workspace.example"},
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr

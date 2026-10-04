import pytest
from fastapi.testclient import TestClient

from backend.app import app
from backend.market import cache


VALID_CSV = b"timestamp,open,high,low,close,volume\n2026-01-01,100,102,99,101,5\n"
INVALID_CSVS = [
    b"timestamp,open,high,low,close,volume\nnot-a-date,invalid,invalid,invalid,invalid,invalid\n",
    b"timestamp,open,high,low,close,volume\n2026-01-01,invalid,102,99,101,5\n",
    b"open,high,low,close,volume\n100,102,99,101,5\n",
    VALID_CSV + b"2026-01-02,100,102,99,101,5,extra\n",
    b"",
]


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(cache, "_data_cache", {})
    monkeypatch.setattr(cache, "_csv_keys", set())
    monkeypatch.setattr(cache, "_profile_cache", {})
    return TestClient(app, raise_server_exceptions=False)


@pytest.mark.parametrize("content", INVALID_CSVS)
def test_invalid_csv_returns_validation_error_without_replacing_cache(client, content):
    assert (
        client.post(
            "/data/csv",
            params={"symbol": "TEST"},
            files={"file": ("valid.csv", VALID_CSV, "text/csv")},
        ).status_code
        == 200
    )
    previous = cache.get_cached("csv", "TEST")
    response = client.post(
        "/data/csv",
        params={"symbol": "TEST"},
        files={"file": ("invalid.csv", content, "text/csv")},
    )
    assert response.status_code == 400
    assert response.json()["detail"].startswith("Invalid CSV:")
    assert cache.get_cached("csv", "TEST") is previous
    assert cache.is_csv_cached("TEST")


@pytest.mark.parametrize("content", [INVALID_CSVS[3], b""])
def test_unreadable_csv_preview_returns_validation_error(client, content):
    response = client.post(
        "/data/csv/preview",
        files={"file": ("invalid.csv", content, "text/csv")},
    )
    assert response.status_code == 400
    assert response.json()["detail"].startswith("Invalid CSV:")
    assert cache.list_cached_keys() == []


def test_valid_csv_upload_and_preview_remain_available(client):
    files = {"file": ("valid.csv", VALID_CSV, "text/csv")}
    response = client.post("/data/csv", params={"symbol": "TEST"}, files=files)
    assert response.status_code == 200
    assert response.json()["count"] == 1
    assert cache.get_cached("csv", "TEST")[0].close == 101
    preview = client.post("/data/csv/preview", files=files)
    assert preview.status_code == 200
    assert preview.json()["preview"][0]["close"] == 101


@pytest.mark.parametrize("path", ["/data/csv", "/data/csv/preview"])
def test_invalid_upload_removes_temporary_file(client, monkeypatch, tmp_path, path):
    monkeypatch.setattr("backend.app.tempfile.tempdir", str(tmp_path))
    response = client.post(path, files={"file": ("empty.csv", b"", "text/csv")})
    assert response.status_code == 400
    assert list(tmp_path.iterdir()) == []


def test_unexpected_loader_failure_is_not_reported_as_bad_input(client, monkeypatch):
    def fail(*args):
        raise RuntimeError("Internal loader failure")

    monkeypatch.setattr("backend.app.load_csv", fail)
    response = client.post(
        "/data/csv", files={"file": ("valid.csv", VALID_CSV, "text/csv")}
    )
    assert response.status_code == 500
    assert response.text == "Internal Server Error"

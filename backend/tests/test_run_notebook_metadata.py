"""Explicit account-private notebook backup and restore, never snapshot adoption."""

from concurrent.futures import ThreadPoolExecutor
import json

import pytest
from fastapi.testclient import TestClient

from backend.app import app
from backend.backtesting.run_store import MAX_NOTEBOOK_BYTES, RunStore
import backend.routes.run_routes as rr
from backend.tests._run_auth_fixtures import auth_headers

URL = "/backtests/runs/notebook/metadata"


def entry(**changes):
    return {
        "run_id": "legacy-reference",
        "kind": "single",
        "label": "Research hypothesis",
        "created_at": "2026-01-01T00:00:00Z",
        "tags": ["costs"],
        "notes": "Try higher fees",
        "baseline": True,
        "decision": "revise",
        **changes,
    }


def metadata(entries=None, **changes):
    return {
        "format": "openquant-notebook-metadata",
        "version": 1,
        "entries": [entry()] if entries is None else entries,
        **changes,
    }


@pytest.fixture
def store(tmp_path, monkeypatch):
    store = RunStore(tmp_path)
    monkeypatch.setattr(rr, "_RUN_STORE", store)
    return store


def client(owner="a"):
    return TestClient(app, headers=auth_headers(owner))


@pytest.mark.parametrize("credentials", ["missing", "invalid", "expired"])
def test_notebook_requires_auth(store, credentials):
    headers = (
        {}
        if credentials == "missing"
        else {"Authorization": "Bearer invalid"}
        if credentials == "invalid"
        else auth_headers("a", expired=True)
    )
    guest = TestClient(app, headers=headers)
    assert guest.get(URL).status_code == 401
    assert guest.put(URL, json=metadata()).status_code == 401
    assert not store.root.exists() or list(store.root.iterdir()) == []


def test_explicit_backup_is_isolated_durable_and_does_not_claim_references(
    store, monkeypatch
):
    a, b = client("a"), client("b")
    assert a.get(URL).status_code == 404
    payload = metadata()
    assert a.put(URL, json=payload).json() == payload
    monkeypatch.setattr(rr, "_RUN_STORE", RunStore(store.root))
    assert a.get(URL).json() == payload
    assert b.get(URL).status_code == 404
    assert a.get("/backtests/runs").json() == {"run_ids": []}
    assert a.get("/backtests/runs/legacy-reference").status_code == 404
    other = metadata([entry(run_id="different", notes="B only")])
    assert b.put(URL, json=other).json() == other
    monkeypatch.setattr(rr, "_RUN_STORE", RunStore(store.root))
    a, b = client("a"), client("b")
    assert a.get(URL).json() == payload
    assert b.get(URL).json() == other
    assert not (store.root / "notebook-metadata.json").exists()


@pytest.mark.parametrize(
    "change",
    [
        {"run_id": "../bad"},
        {"run_id": ""},
        {"run_id": "a" * 257},
        {"kind": "sweep"},
        {"label": " "},
        {"label": "x" * 121},
        {"label": "😀" * 61},
        {"tags": ["😀" * 301]},
        {"notes": "😀" * 5001},
        {"created_at": "yesterday"},
        {"created_at": "2026-13-01T00:00:00Z"},
        {"tags": ["x" * 601]},
        {"tags": ["tag"] * 13},
        {"tags": [""]},
        {"notes": "x" * 10001},
        {"notes": None},
        {"decision": "certified"},
        {"baseline": 1},
        {"baseline": True, "kind": "portfolio"},
        {"owner": "someone-else"},
        {"source_code": "not metadata"},
    ],
)
def test_malformed_entries_rejected_without_replacing_backup(store, change):
    a = client()
    original = metadata()
    assert a.put(URL, json=original).status_code == 200
    assert a.put(URL, json=metadata([entry(**change)])).status_code == 422
    assert a.get(URL).json() == original


@pytest.mark.parametrize(
    "payload",
    [
        {},
        None,
        [],
        metadata(version=2),
        metadata(version=True),
        metadata(format="foreign"),
        metadata(owner="somebody"),
        metadata([entry(), entry()]),
        metadata([entry(), entry(run_id="other")]),
        metadata([entry(run_id=f"r{i}", baseline=False) for i in range(51)]),
    ],
)
def test_malformed_envelopes_rejected(store, payload):
    assert client().put(URL, json=payload).status_code == 422
    assert client().get(URL).status_code == 404


def test_exact_frontend_bounds_accepted(store):
    payload = metadata(
        [
            entry(
                run_id=f"r{i}",
                baseline=False,
                label="x" * 120,
                tags=["t" * 600] * 12,
                notes="n" * 10000,
            )
            for i in range(50)
        ]
    )
    assert client().put(URL, json=payload).status_code == 200
    assert client().get(URL).json() == payload


def test_raw_json_body_bound_rejects_large_whitespace(store):
    payload = json.dumps(metadata()) + " " * MAX_NOTEBOOK_BYTES
    assert (
        client()
        .put(URL, content=payload, headers={"Content-Type": "application/json"})
        .status_code
        == 413
    )
    assert client().get(URL).status_code == 404


@pytest.mark.parametrize(
    "raw", [b"broken JSON", b"{}", b"\xff", b"x" * (MAX_NOTEBOOK_BYTES + 1)]
)
def test_unreadable_existing_metadata_is_preserved(store, raw):
    scope = store.for_owner("a")
    scope.root.mkdir(parents=True)
    path = scope.root / "notebook-metadata.json"
    path.write_bytes(raw)
    assert client().get(URL).status_code == 409
    assert client().put(URL, json=metadata()).status_code == 409
    assert path.read_bytes() == raw
    assert client("b").put(URL, json=metadata()).status_code == 200


def test_unscoped_notebook_is_not_adopted(store):
    store.root.mkdir(parents=True, exist_ok=True)
    path = store.root / "notebook-metadata.json"
    raw = json.dumps(metadata()).encode()
    path.write_bytes(raw)
    assert client().get(URL).status_code == 404
    assert client().put(URL, json=metadata([])).status_code == 200
    assert path.read_bytes() == raw


def test_concurrent_backups_are_complete_atomic_documents(store):
    payloads = [metadata([entry(notes=f"revision {i}")]) for i in range(16)]

    def backup(payload):
        a = client()
        response = a.put(URL, json=payload)
        assert response.status_code == 200
        assert response.json() == payload
        assert a.get(URL).json() in payloads

    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(backup, payloads))
    assert client().get(URL).json() in payloads
    assert [p.name for p in store.for_owner("a").root.iterdir()] == [
        "notebook-metadata.json"
    ]

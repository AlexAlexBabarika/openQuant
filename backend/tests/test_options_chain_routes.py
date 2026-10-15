"""Real auth and encrypted-key resolver over fake DB rows; no provider network."""

from __future__ import annotations

import asyncio
import json
import socket
import threading
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import jwt
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request

from backend.core import api_key_store, auth_deps, encryption
from backend.core.migrations import discover_migrations
from backend.derivatives import chains
from backend.models.api_key_models import ApiKeyCreateRequest
from backend.models.auth_models import AuthUserInfo
from backend.routes import options_chain_routes as routes
from backend.tests.test_options_chains import EXPIRATION, FETCHED, option

_SIGNING_FIXTURE = "chain-fixture-signing-only-not-a-real-secret"
_TOKENS = {
    ("alice", "tradier"): "invented-alice-production",
    ("alice", "tradier_sandbox"): "invented-alice-sandbox",
    ("bob", "tradier_sandbox"): "invented-bob-sandbox",
}


def headers(user="alice", *, expired=False, kind="access"):
    return {
        "Authorization": "Bearer "
        + jwt.encode(
            {
                "sub": user,
                "type": kind,
                "exp": datetime.now(timezone.utc)
                + timedelta(minutes=-1 if expired else 5),
            },
            _SIGNING_FIXTURE,
            algorithm="HS256",
        )
    }


class KeyDatabase:
    def __init__(self, encrypted):
        self.encrypted = encrypted
        self.lookups = []

    def from_(self, table):
        assert table == "api_keys"
        database = self

        class Query:
            def __init__(self):
                self.filters = {}

            def select(self, columns):
                assert columns == "encrypted_key"
                return self

            def eq(self, key, value):
                self.filters[key] = value
                return self

            def limit(self, count):
                assert count == 1
                return self

            def execute(self):
                assert set(self.filters) == {"user_id", "provider"}
                key = self.filters["user_id"], self.filters["provider"]
                database.lookups.append(key)
                blob = database.encrypted.get(key)
                return SimpleNamespace(
                    data=[{"encrypted_key": blob}] if blob is not None else []
                )

        return Query()


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    def denied(*args, **kwargs):
        pytest.fail("Chain route fixture attempted network access")

    for method in ("connect", "connect_ex"):
        monkeypatch.setattr(socket.socket, method, denied)
    monkeypatch.setattr(socket, "getaddrinfo", denied)
    monkeypatch.setattr(socket, "create_connection", denied)
    monkeypatch.setattr(auth_deps, "_secret", lambda: _SIGNING_FIXTURE)
    monkeypatch.setattr(encryption, "_cached_key", b"\x13" * 32)
    monkeypatch.setattr(routes, "_windows", {})
    monkeypatch.setattr(routes, "_slots", threading.BoundedSemaphore(8))
    monkeypatch.setattr(routes, "_key_slots", threading.BoundedSemaphore(4))


@pytest.fixture
def client(monkeypatch):
    encrypted = {
        key: encryption.encrypt_api_key(token) for key, token in _TOKENS.items()
    }
    database = KeyDatabase(encrypted)
    monkeypatch.setattr(api_key_store, "get_database", lambda: database)
    monkeypatch.setattr(chains, "utc_now", lambda: FETCHED)
    calls = []

    async def get_json(token, environment, endpoint, params):
        calls.append((token, environment, endpoint, params))
        if endpoint == "chains":
            return {"options": {"option": option()}}
        return {"expirations": {"date": EXPIRATION}}

    monkeypatch.setattr(chains, "_get_json", get_json)
    app = FastAPI()
    app.include_router(routes.router)
    with TestClient(app) as instance:
        instance.database, instance.provider_calls = database, calls
        yield instance


@pytest.mark.parametrize(
    "path",
    [
        "status",
        "expirations?symbol=AAPL&environment=sandbox",
        f"chain?symbol=AAPL&expiration={EXPIRATION}&environment=sandbox",
    ],
)
@pytest.mark.parametrize(
    "auth",
    [
        {},
        {"Authorization": "Bearer invalid-token"},
        headers(expired=True),
        headers(kind="refresh"),
    ],
)
def test_every_get_requires_real_access_auth_before_key_or_provider_access(
    client, path, auth
):
    response = client.get("/options/chains/" + path, headers=auth)
    assert response.status_code == 401
    assert client.database.lookups == client.provider_calls == []


def test_status_is_account_scoped_configuration_only_and_does_not_contact_provider(
    client,
):
    response = client.get("/options/chains/status", headers=headers("bob"))
    assert response.status_code == 200
    production, sandbox = response.json()["environments"]
    assert (
        production["environment"] == "production"
        and not production["configured"]
        and not production["available"]
    )
    assert (
        sandbox["environment"] == "sandbox"
        and sandbox["configured"]
        and sandbox["available"]
    )
    assert "not verified" in sandbox["message"]
    assert client.database.lookups == [("bob", "tradier"), ("bob", "tradier_sandbox")]
    assert not client.provider_calls
    assert response.headers["cache-control"] == "no-store, private"
    assert response.headers["vary"] == "Authorization"
    assert all(token not in response.text for token in _TOKENS.values())


def test_chain_and_expirations_use_only_token_owner_and_selected_environment_key(
    client,
):
    for user, environment, key_provider in [
        ("alice", "production", "tradier"),
        ("alice", "sandbox", "tradier_sandbox"),
        ("bob", "sandbox", "tradier_sandbox"),
    ]:
        for path in (
            f"expirations?symbol=aapl&environment={environment}",
            f"chain?symbol=aapl&expiration={EXPIRATION}&environment={environment}",
        ):
            response = client.get("/options/chains/" + path, headers=headers(user))
            assert response.status_code == 200, response.text
            assert client.database.lookups[-1] == (user, key_provider)
            assert client.provider_calls[-1][0:2] == (
                _TOKENS[user, key_provider],
                environment,
            )
            assert response.json()["environment"] == environment
            assert response.json()["symbol"] == "AAPL"
            assert all(token not in response.text for token in _TOKENS.values())
    assert len(client.provider_calls) == 6  # No cross-account/environment quote cache.


def test_missing_key_does_not_fall_back_to_another_environment_or_user(client):
    response = client.get(
        "/options/chains/expirations?symbol=AAPL&environment=production",
        headers=headers("bob"),
    )
    assert response.status_code == 409
    assert client.database.lookups == [("bob", "tradier")]
    assert not client.provider_calls


@pytest.mark.parametrize(
    "suffix",
    [
        "expirations?symbol=AAPL",
        "expirations?symbol=AAPL&environment=wrong",
        "expirations?symbol=" + "A" * 33 + "&environment=sandbox",
        "expirations?symbol=https://evil.example&environment=sandbox",
        "chain?symbol=AAPL&environment=sandbox&expiration=2027-02-30",
        "chain?symbol=AAPL&environment=sandbox&expiration=20270115",
        "status?user_id=bob",
        "status?api_key=not-accepted",
        "expirations?symbol=AAPL&symbol=SPX&environment=sandbox",
    ],
)
def test_bounded_strict_queries_are_safe_and_never_lookup_or_fetch(client, suffix):
    response = client.get("/options/chains/" + suffix, headers=headers())
    assert response.status_code == 422
    assert not client.database.lookups and not client.provider_calls
    assert "input" not in response.text and "ctx" not in response.text
    assert "not-accepted" not in response.text


def test_query_bytes_and_get_bodies_are_bounded_and_not_echoed(client):
    response = client.get(
        "/options/chains/status?symbol=" + "x" * 1025, headers=headers()
    )
    assert response.status_code == 414
    response = client.request(
        "GET",
        "/options/chains/status",
        headers=headers(),
        content=json.dumps({"api_key": "must-not-echo"}),
    )
    assert response.status_code == 422 and "must-not-echo" not in response.text
    assert not client.database.lookups


@pytest.mark.parametrize("declared_body", [True, False])
@pytest.mark.asyncio
async def test_get_body_rejection_cannot_wait_indefinitely(monkeypatch, declared_body):
    monkeypatch.setattr(routes, "BODY_READ_TIMEOUT", 0.01)

    async def receive():
        await asyncio.Future()

    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/options/chains/status",
            "query_string": b"",
            "headers": [(b"transfer-encoding", b"chunked")] if declared_body else [],
        },
        receive=receive,
    )
    route = routes.router.routes[0]
    with pytest.raises(HTTPException) as error:
        await asyncio.wait_for(route.get_route_handler()(request), timeout=1)
    assert error.value.status_code == (422 if declared_body else 408)


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
def test_chain_router_is_read_only(client, method):
    assert (
        client.request(method, "/options/chains/chain", headers=headers()).status_code
        == 405
    )
    assert not client.database.lookups and not client.provider_calls


@pytest.mark.parametrize(
    "failure",
    [
        ValueError("no key contains secret"),
        RuntimeError("database secret"),
        KeyError("raw key body"),
    ],
)
def test_key_errors_are_sanitized_and_never_reach_provider(
    client, monkeypatch, failure, caplog
):
    def fail(*args):
        raise failure

    monkeypatch.setattr(routes, "fetch_api_key", fail)
    response = client.get(
        "/options/chains/expirations?symbol=AAPL&environment=sandbox", headers=headers()
    )
    assert response.status_code == (409 if isinstance(failure, ValueError) else 503)
    assert str(failure) not in response.text + caplog.text
    assert not client.provider_calls


def test_corrupt_ciphertext_is_sanitized(client, caplog):
    client.database.encrypted["alice", "tradier"] = b"x" * 50
    response = client.get(
        "/options/chains/expirations?symbol=AAPL&environment=production",
        headers=headers(),
    )
    assert response.status_code == 503
    assert "InvalidTag" not in response.text + caplog.text
    assert not client.provider_calls


def test_provider_error_and_retry_header_are_public_only(client, monkeypatch, caplog):
    async def fail(*args):
        raise chains.ChainError(
            "Tradier market-data rate limit reached. Try again in a minute.", 429
        )

    monkeypatch.setattr(chains, "fetch_expirations", fail)
    response = client.get(
        "/options/chains/expirations?symbol=AAPL&environment=sandbox", headers=headers()
    )
    assert response.status_code == 429 and response.headers["retry-after"] == "60"
    assert all(token not in response.text + caplog.text for token in _TOKENS.values())


def test_rate_limit_separates_account_and_environment_and_shares_data_paths(
    client, monkeypatch
):
    monkeypatch.setattr(routes, "RATE_LIMIT", 1)
    sandbox = "/options/chains/expirations?symbol=AAPL&environment=sandbox"
    assert client.get(sandbox, headers=headers()).status_code == 200
    blocked = client.get(
        f"/options/chains/chain?symbol=AAPL&expiration={EXPIRATION}&environment=sandbox",
        headers=headers(),
    )
    assert blocked.status_code == 429 and blocked.headers["retry-after"] == "60"
    assert client.get(sandbox, headers=headers("bob")).status_code == 200
    assert (
        client.get(
            sandbox.replace("sandbox", "production"), headers=headers()
        ).status_code
        == 200
    )
    assert client.get("/options/chains/status", headers=headers()).status_code == 200
    assert len(client.provider_calls) == 3


def test_limiter_has_finite_identity_state_and_expires_idle_buckets(monkeypatch):
    clock = [100.0]
    monkeypatch.setattr(routes, "monotonic", lambda: clock[0])
    monkeypatch.setattr(routes, "MAX_RATE_KEYS", 2)
    assert routes._allow("alice", "production")
    assert routes._allow("bob", "sandbox")
    assert not routes._allow("charlie", "sandbox")
    assert len(routes._windows) == 2
    clock[0] += 60
    assert routes._allow("charlie", "sandbox")
    assert list(routes._windows) == [("charlie", "sandbox")]


def test_active_operation_limit_fails_fast_before_db(client, monkeypatch):
    slot = threading.BoundedSemaphore(1)
    slot.acquire()
    monkeypatch.setattr(routes, "_slots", slot)
    response = client.get("/options/chains/status", headers=headers())
    assert response.status_code == 503 and response.headers["retry-after"] == "1"
    assert not client.database.lookups


class Connection:
    def __init__(self):
        self.disconnected = False

    async def is_disconnected(self):
        return self.disconnected


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["disconnect", "deadline", "cancel"])
async def test_cancel_deadline_and_disconnect_stop_work_and_release_slot(
    monkeypatch, mode
):
    monkeypatch.setattr(routes, "_slots", threading.BoundedSemaphore(1))
    monkeypatch.setattr(routes, "REQUEST_TIMEOUT", 0.01 if mode == "deadline" else 1)
    request = Connection()
    started, stopped = asyncio.Event(), asyncio.Event()

    async def work():
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            stopped.set()

    task = asyncio.create_task(
        routes._execute(request, AuthUserInfo(id="alice"), "sandbox", work)
    )
    await started.wait()
    if mode == "disconnect":
        request.disconnected = True
        expected = HTTPException
    elif mode == "cancel":
        task.cancel()
        expected = asyncio.CancelledError
    else:
        expected = chains.ChainError
    with pytest.raises(expected) as exc:
        await task
    assert stopped.is_set()
    if mode != "cancel":
        assert getattr(exc.value, "status_code") == (
            499 if mode == "disconnect" else 504
        )
    assert routes._slots.acquire(blocking=False)
    routes._slots.release()


@pytest.mark.asyncio
async def test_cancelled_key_waiter_keeps_worker_slot_until_actual_thread_exits(
    monkeypatch,
):
    monkeypatch.setattr(routes, "_key_slots", threading.BoundedSemaphore(1))
    entered, release, exited = threading.Event(), threading.Event(), threading.Event()

    def blocked(*args):
        entered.set()
        try:
            assert release.wait(2)
            return "invented-thread-token"
        finally:
            exited.set()

    monkeypatch.setattr(routes, "fetch_api_key", blocked)
    task = asyncio.create_task(run_in_threadpool(routes._read_key, "alice", "sandbox"))
    assert await asyncio.to_thread(entered.wait, 2)
    task.cancel()
    try:
        with pytest.raises(asyncio.CancelledError):
            await task
        with pytest.raises(chains.ChainError, match="busy"):
            routes._read_key("bob", "sandbox")
    finally:
        release.set()
        assert await asyncio.to_thread(exited.wait, 2)


@pytest.mark.parametrize("provider", ["tradier", "tradier_sandbox"])
def test_provider_registration_and_new_immutable_migration(provider):
    assert (
        ApiKeyCreateRequest(
            provider=provider, api_key="invented-registration-token"
        ).provider.value
        == provider
    )
    migrations = discover_migrations()
    assert [migration.version for migration in migrations] == [1, 2]
    assert migrations[-1].name == "add_tradier_api_key_providers"
    assert f"ADD VALUE IF NOT EXISTS '{provider}'" in migrations[-1].sql
    assert "ALTER TYPE api_key_provider" in migrations[-1].sql
    assert "CREATE TYPE api_key_provider" in migrations[0].sql

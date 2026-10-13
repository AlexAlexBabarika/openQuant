"""Bounded ASGI disconnect regressions; no sockets or provider calls.

An HTTP client disconnect is a receive-channel event, not task cancellation.
The real route must finish safely under its original resolved identity. This
does not claim aggregate worker admission or native browser abort acceptance.
"""

import asyncio
import json
import threading

import pytest
from fastapi import FastAPI

import backend.routes.backtest_routes as routes
from backend.backtesting.run_store import RunStore
from backend.backtesting.sandbox import run_strategy
from backend.tests._backtesting_fixtures import canonical_frame
from backend.tests._run_auth_fixtures import auth_headers


@pytest.mark.parametrize("outcome", ["ok", "timeout"])
def test_disconnected_request_finishes_under_original_owner(
    outcome, tmp_path, monkeypatch
):
    store = RunStore(tmp_path)
    monkeypatch.setattr(routes, "_RUN_STORE", store)
    frame = canonical_frame()
    started = threading.Event()
    release = threading.Event()
    finished = threading.Event()
    observed = []
    loaded_owners = []

    async def load_frame(body, user):
        loaded_owners.append(user.id)
        return frame, "lifecycle-test-v1"

    def bounded_work(code, data, **kwargs):
        started.set()
        try:
            assert release.wait(3), "test did not release bounded worker"
            result = run_strategy(
                code,
                data,
                timeout_s=0.4 if outcome == "timeout" else 3,
                starting_cash=kwargs["starting_cash"],
                seed=kwargs["seed"],
                params=kwargs["params"],
            )
            observed.append(result.status)
            return result
        finally:
            finished.set()

    monkeypatch.setattr(routes, "_load_frame", load_frame)
    monkeypatch.setattr(routes, "run_strategy", bounded_work)
    app = FastAPI()
    app.include_router(routes.router)

    async def exercise():
        code = "def on_bar(ctx):\n    pass\n"
        if outcome == "timeout":
            code = "def on_bar(ctx):\n    while True:\n        pass\n"
        body = json.dumps(
            {"code": code, "symbol": "TEST", "provider": "yfinance"}
        ).encode()
        disconnected = asyncio.Event()
        first_receive = True
        discarded = []

        async def receive():
            nonlocal first_receive
            if first_receive:
                first_receive = False
                return {"type": "http.request", "body": body, "more_body": False}
            await disconnected.wait()
            return {"type": "http.disconnect"}

        async def send(message):
            assert disconnected.is_set()
            discarded.append(message)

        headers = auth_headers("request-owner")
        scope = {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": "/backtests/run",
            "raw_path": b"/backtests/run",
            "query_string": b"",
            "root_path": "",
            "headers": [
                (b"content-type", b"application/json"),
                (b"authorization", headers["Authorization"].encode()),
            ],
            "client": ("127.0.0.1", 0),
            "server": ("127.0.0.1", 0),
        }
        server = asyncio.create_task(app(scope, receive, send))
        try:
            assert await asyncio.to_thread(started.wait, 3)
            disconnected.set()
            assert await receive() == {"type": "http.disconnect"}
            assert not finished.is_set()
            release.set()
            await asyncio.wait_for(server, 8)
        finally:
            release.set()
            if not server.done():
                await asyncio.wait_for(server, 8)
        assert finished.is_set()
        assert observed == [outcome]
        assert loaded_owners == ["request-owner"]
        assert discarded[0]["type"] == "http.response.start"
        assert discarded[0]["status"] == 200
        payload = json.loads(discarded[-1]["body"])
        assert payload["status"] == outcome
        assert store.list_ids() == []
        assert store.for_owner("next-owner").list_ids() == []
        ids = store.for_owner("request-owner").list_ids()
        if outcome == "ok":
            assert ids == [payload["run_id"]]
            assert payload["persistence"]["stored"] is True
        else:
            assert ids == []
            assert payload["persistence"]["reason"] == "run_failed"

    asyncio.run(exercise())

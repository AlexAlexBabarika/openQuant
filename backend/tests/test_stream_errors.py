from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend import app as app_module


@pytest.mark.parametrize("kind", ["subscribe", "subscribe_quote"])
@pytest.mark.parametrize(
    "failure", [NotImplementedError("Unsupported"), RuntimeError("Failed")]
)
def test_subscription_errors_identify_the_rejected_stream(monkeypatch, kind, failure):
    hub = SimpleNamespace(
        subscribe=AsyncMock(side_effect=failure),
        subscribe_quote=AsyncMock(side_effect=failure),
        unsubscribe=AsyncMock(),
        unsubscribe_quote=AsyncMock(),
        disconnect=AsyncMock(),
    )
    monkeypatch.setattr(app_module, "get_hub", lambda: hub)
    monkeypatch.setattr(app_module, "_ws_admit", AsyncMock(return_value="testclient"))
    monkeypatch.setattr(app_module, "_ws_release", lambda host: None)
    app = FastAPI()
    app.add_api_websocket_route("/ws/live", app_module.ws_live)
    with TestClient(app).websocket_connect("/ws/live") as ws:
        request = {"type": kind, "provider": "binance", "symbol": "BTCUSDT"}
        if kind == "subscribe":
            request["interval"] = "1m"
        ws.send_json(request)
        error = ws.receive_json()
        assert error["type"] == "error"
        assert error["provider"] == "binance"
        assert error["symbol"] == "BTCUSDT"
        assert error.get("interval") == ("1m" if kind == "subscribe" else None)
        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong"}

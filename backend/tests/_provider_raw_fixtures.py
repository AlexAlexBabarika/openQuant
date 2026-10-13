"""Invented, bounded upstream response shapes; never captured provider evidence."""

from datetime import datetime, timedelta, timezone
import socket
from types import SimpleNamespace

import curl_cffi
import pandas as pd
import pytest
import requests

from backend.market.data_sources import (
    binance_loader as bi,
    twelvedataprovider as td,
    yfinance_loader as yf,
)

PROVIDERS = ("yfinance", "binance", "twelvedata")
START = datetime(2024, 1, 1, tzinfo=timezone.utc)


def deny_network(monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail("Offline provider test attempted network or credential access")

    for target, name in (
        (socket.socket, "connect"),
        (socket.socket, "connect_ex"),
        (socket, "create_connection"),
        (socket, "getaddrinfo"),
        (requests.Session, "request"),
        (curl_cffi.Curl, "perform"),
        (bi, "fetch_api_key"),
        (td, "fetch_api_key"),
    ):
        monkeypatch.setattr(target, name, forbidden)


def offline_adapter(monkeypatch, provider):
    """Stub only the SDK/HTTP response boundary, not adapters/canonical frames."""
    rows = [
        {
            "timestamp": START + timedelta(days=i),
            "open": 100.0,
            "high": 101.0,
            "low": 99.0,
            "close": 100.5,
            "volume": 10.25,
        }
        for i in range(3)
    ]
    state = SimpleNamespace(provider=provider, rows=rows, calls=[], error=None)

    def check_error():
        if state.error:
            raise state.error

    if provider == "yfinance":

        class Ticker:
            def __init__(self, symbol):
                assert symbol == "TEST"

            def history(self, **kwargs):
                state.calls.append(kwargs)
                check_error()
                if not state.rows:
                    return pd.DataFrame()
                data = pd.DataFrame(state.rows).rename(
                    columns={
                        "timestamp": "Date",
                        **{k: k.title() for k in rows[0] if k != "timestamp"},
                    }
                )
                # These extra SDK fields are intentionally ignored, not OHLCV.
                data["Dividends"] = 0.0
                data["Stock Splits"] = 0.0
                return data.set_index("Date")

        monkeypatch.setattr(yf.yf, "Ticker", Ticker)
        state.loader = yf.YFinanceLoader()
    elif provider == "binance":

        class Client:
            def __init__(self, *args, **kwargs):
                assert not args and not kwargs  # Never instantiate credentialed SDK.

            def get_historical_klines(self, symbol, interval, start):
                assert symbol == "TEST"
                state.calls.append({"interval": interval, "start": start})
                check_error()
                klines = []
                for row in state.rows:
                    ts = row.get("timestamp")
                    if isinstance(ts, datetime):
                        ts = int(
                            (ts - datetime(1970, 1, 1, tzinfo=timezone.utc))
                            / timedelta(milliseconds=1)
                        )
                    values = [
                        row.get(k) for k in ("open", "high", "low", "close", "volume")
                    ]
                    values = [str(v) if v is not None else None for v in values]
                    klines.append([ts, *values, 0, "0", 0, "0", "0", "0"])
                return klines

        monkeypatch.setattr(bi, "Client", Client)
        state.loader = bi.BinanceProvider()
    else:
        assert provider == "twelvedata"

        def get(url, *, params, timeout):
            assert url == td._BASE_URL and timeout == 15
            assert params["apikey"] == ""  # Empty transport stub, not a demo/API key.
            assert params["timezone"] == "UTC" and params["order"] == "asc"
            state.calls.append({k: v for k, v in params.items() if k != "apikey"})
            check_error()
            values = []
            for row in state.rows:
                ts = row.get("timestamp")
                if isinstance(ts, datetime):
                    ts = ts.astimezone(timezone.utc).replace(tzinfo=None).isoformat(" ")
                values.append(
                    {
                        "datetime" if k == "timestamp" else k: ts
                        if k == "timestamp"
                        else str(v)
                        if v is not None
                        else None
                        for k, v in row.items()
                    }
                )
            return SimpleNamespace(
                raise_for_status=lambda: None,
                json=lambda: {
                    "status": "ok",
                    "meta": {"timezone": "UTC"},
                    "values": values,
                },
            )

        monkeypatch.setattr(td.requests, "get", get)
        monkeypatch.setattr(td.TwelveDataProvider, "_api_key", lambda self: "")
        state.loader = td.TwelveDataProvider(user_id="offline-fixture")
    return state

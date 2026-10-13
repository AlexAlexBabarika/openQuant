"""Offline adapter boundaries, not live/native provider acceptance."""

from copy import deepcopy
from datetime import timedelta, timezone
import json
import socket

import curl_cffi
import pandas as pd
import pytest
import requests

from backend.backtesting.data_quality import inspect_frame
from backend.market.data_sources import binance_loader as bi, twelvedataprovider as td
from backend.market.data_sources.raw_quality import (
    RawProviderDataError,
    inspect_raw_rows,
)
from backend.market.normalizer import normalize_rows
from backend.routes.script_routes import _candles_to_df
from backend.tests._provider_raw_fixtures import (
    PROVIDERS,
    START,
    deny_network,
    offline_adapter,
)


@pytest.fixture(autouse=True)
def network_blocked(monkeypatch):
    deny_network(monkeypatch)


@pytest.fixture(params=PROVIDERS)
def adapter(monkeypatch, request):
    return offline_adapter(monkeypatch, request.param)


def load(adapter, interval="1d"):
    return adapter.loader.get_ohlcv("TEST", "1mo", interval)


def quality(adapter, candles, interval="1d"):
    return inspect_frame(
        _candles_to_df(candles, preserve_order=True),
        provider=adapter.provider,
        interval=interval,
        data_version="offline-fixture-not-provider-evidence",
    )


def test_transport_guards_fail_closed():
    for operation in (
        lambda: socket.getaddrinfo("example.invalid", 443),
        lambda: socket.create_connection(("127.0.0.1", 1)),
        lambda: requests.Session().request("GET", "https://example.invalid"),
        lambda: curl_cffi.Curl().perform(),
    ):
        with pytest.raises(pytest.fail.Exception, match="Offline provider test"):
            operation()


def test_valid_response_runs_adapter_normalizer_and_canonical_quality(adapter):
    original = deepcopy(adapter.rows)
    candles = load(adapter)
    report = quality(adapter, candles)
    assert adapter.calls and adapter.rows == original
    assert len(candles) == 3 and candles[0].volume == 10.25
    assert not report["errors"]
    assert report["provenance"]["start"] == "2024-01-01T00:00:00+00:00"
    assert report["provenance"]["end"] == "2024-01-03T00:00:00+00:00"
    assert report["provenance"]["calendar"] == "unknown"
    assert report["provenance"]["adjustment"] == "unknown"
    assert report["provenance"]["staleness"] == "not_assessed"


@pytest.mark.parametrize(
    "defect,code",
    [
        ("order", "nonmonotonic_timestamp"),
        ("duplicate", "duplicate_timestamp"),
        ("gap", "elapsed_gap"),
    ],
)
def test_raw_order_duplicate_and_gap_policy_is_not_repaired(adapter, defect, code):
    if defect == "order":
        adapter.rows.reverse()
    elif defect == "duplicate":
        adapter.rows[1]["timestamp"] = adapter.rows[0]["timestamp"]
    else:
        adapter.rows[2]["timestamp"] = START + timedelta(days=8)
    if defect == "gap":
        report = quality(adapter, load(adapter))
        assert not report["errors"]
        assert code in {issue["code"] for issue in report["warnings"]}
    else:
        with pytest.raises(RawProviderDataError) as exc:
            load(adapter)
        issue = next(i for i in exc.value.data_quality["errors"] if i["code"] == code)
        assert issue["rows"] == ([0, 1] if defect == "duplicate" else [1, 2])
        assert exc.value.data_quality["provenance"]["start"] is None


@pytest.mark.parametrize(
    "value", [None, "", "broken-date", "2024-02-30", "99999-01-01", True]
)
def test_invalid_timestamp_is_detected_before_candle_typing(adapter, value):
    adapter.rows[1]["timestamp"] = value
    with pytest.raises(RawProviderDataError) as exc:
        load(adapter)
    issue = next(
        i for i in exc.value.data_quality["errors"] if i["code"] == "invalid_timestamp"
    )
    assert issue["count"] == 1 and issue["rows"] == [1]
    assert "broken-date" not in str(exc.value)
    json.dumps(exc.value.data_quality, allow_nan=False)


@pytest.mark.parametrize(
    "column,value,code",
    [
        ("open", 0, "invalid_price"),
        ("close", -1, "invalid_price"),
        ("open", None, "invalid_price"),
        ("volume", None, "invalid_volume"),
        ("volume", "", "invalid_volume"),
        ("volume", float("nan"), "invalid_volume"),
        ("volume", float("inf"), "invalid_volume"),
        ("volume", "Infinity", "invalid_volume"),
        ("volume", -1, "invalid_volume"),
        ("close", "not-a-number", "invalid_price"),
        ("close", "1,000", "invalid_price"),
        ("high", 98, "inconsistent_ohlc"),
        ("low", 0, "invalid_price"),
    ],
)
def test_corrupt_numeric_values_are_not_defaulted_or_repaired(
    adapter, column, value, code
):
    adapter.rows[1][column] = value
    with pytest.raises(RawProviderDataError) as exc:
        load(adapter)
    assert code in {i["code"] for i in exc.value.data_quality["errors"]}
    assert exc.value.data_quality["provenance"]["row_count"] == 3
    assert "not-a-number" not in str(exc.value)
    json.dumps(exc.value.data_quality, allow_nan=False)


def test_missing_required_numeric_field_cannot_become_zero(adapter):
    del adapter.rows[1]["volume"]
    with pytest.raises(RawProviderDataError) as exc:
        load(adapter)
    assert any(
        i["column"] == "volume" and i["rows"] == [1]
        for i in exc.value.data_quality["errors"]
    )


def test_month_interval_has_no_invented_gap_assessment(adapter):
    adapter.rows[2]["timestamp"] = START + timedelta(days=100)
    report = quality(adapter, load(adapter, "1mo"), "1mo")
    assert not report["errors"]
    assert "elapsed_gap" not in {i["code"] for i in report["warnings"]}
    assert report["provenance"]["nominal_interval_seconds"] is None


def test_explicit_offsets_are_converted_to_same_utc_instant(adapter):
    adapter.rows[0]["timestamp"] = START.astimezone(timezone(timedelta(hours=-5)))
    assert (
        quality(adapter, load(adapter))["provenance"]["start"]
        == "2024-01-01T00:00:00+00:00"
    )


def test_supported_precision_survives(adapter):
    microseconds = 123000 if adapter.provider == "binance" else 123456
    adapter.rows[0]["timestamp"] += timedelta(microseconds=microseconds)
    candles = load(adapter)
    frame = _candles_to_df(candles, preserve_order=True)
    assert candles[0].timestamp.microsecond == microseconds
    assert frame["timestamp"][0].microsecond == microseconds
    # The REST candle serializer is second-only; this is not precision evidence for charts.
    assert candles[0].model_dump(mode="json")["timestamp"] == "2024-01-01T00:00:00Z"


@pytest.mark.parametrize(
    "value",
    [pd.Timestamp("2024-01-01T00:00:00.000000001Z"), "2024-01-01T00:00:00.123456789Z"],
)
def test_submicrosecond_input_is_rejected_not_silently_truncated(monkeypatch, value):
    state = offline_adapter(monkeypatch, "yfinance")
    state.rows[0]["timestamp"] = value
    with pytest.raises(RawProviderDataError):
        load(state)


def test_yfinance_nat_is_rejected_and_unadjusted_path_keeps_request_contract(
    monkeypatch,
):
    state = offline_adapter(monkeypatch, "yfinance")
    state.loader.get_raw_ohlcv("TEST", "1y", "1d")
    assert state.calls[-1] == {"period": "1y", "interval": "1d", "auto_adjust": False}
    state.rows[0]["timestamp"] = pd.NaT
    with pytest.raises(RawProviderDataError):
        state.loader.get_raw_ohlcv("TEST", "1y", "1d")


@pytest.mark.parametrize("value", [1704067200000.5, "1704067200000", 10**30])
def test_binance_does_not_guess_epoch_units_or_truncate(monkeypatch, value):
    state = offline_adapter(monkeypatch, "binance")
    state.rows[0]["timestamp"] = value
    with pytest.raises(RawProviderDataError):
        load(state)


def test_legacy_normalizer_repairs_are_visible_but_provider_guard_refuses_them():
    raw = [
        {
            "datetime": "2024-01-01",
            "open": float("nan"),
            "high": 101,
            "low": 99,
            "close": 100,
            "volume": None,
            "unrelated": "ignored",
        }
    ]
    original = deepcopy(raw)
    normalized = normalize_rows(raw, "TEST")[0]
    assert normalized.open == 100 and normalized.volume == 0
    report = inspect_raw_rows(raw, provider="twelvedata", interval="1d")
    assert {i["code"] for i in report["errors"]} == {"invalid_price", "invalid_volume"}
    assert set(raw[0]) == set(original[0]) and raw[0]["volume"] is None


def test_provider_transport_failure_is_not_empty_success(adapter):
    adapter.error = requests.Timeout("offline transport failure")
    with pytest.raises(requests.Timeout):
        load(adapter)


def test_empty_success_remains_empty(adapter):
    adapter.rows.clear()
    assert load(adapter) == []


def test_boolean_numeric_input_is_not_coerced_to_one(adapter):
    adapter.rows[0]["volume"] = True
    with pytest.raises(RawProviderDataError):
        load(adapter)


def test_raw_report_counts_and_examples_are_bounded_without_raw_values():
    raw = [
        {
            "datetime": "sensitive-upstream-value",
            "open": 100,
            "high": 101,
            "low": 99,
            "close": 100,
            "volume": 1,
        }
        for _ in range(8)
    ]
    report = inspect_raw_rows(raw, provider="twelvedata", interval="1d")
    issue = next(i for i in report["errors"] if i["code"] == "invalid_timestamp")
    assert issue["count"] == 8 and issue["rows"] == [0, 1, 2, 3, 4]
    serialized = json.dumps(report, allow_nan=False)
    assert "sensitive-upstream-value" not in serialized and len(serialized) < 4000


@pytest.mark.parametrize(
    "timestamp",
    [
        "20240101T000000.1234567",
        "2024-01-01T00:00.1234567",
        "2024-01-01T00:00:00+00:00:00.1234567",
    ],
)
def test_alternate_iso_forms_never_silently_truncate_precision(timestamp):
    report = inspect_raw_rows(
        [{"timestamp": timestamp}], provider="fixture", interval="1d"
    )
    assert "invalid_timestamp" in {i["code"] for i in report["errors"]}


def test_ambiguous_aliases_do_not_overwrite_corrupt_original_values():
    with pytest.raises(ValueError, match="ambiguous OHLCV aliases"):
        inspect_raw_rows([{"open": 0, "o": 100}], provider="fixture", interval="1d")


def test_twelve_data_api_error_does_not_normalize(monkeypatch):
    state = offline_adapter(monkeypatch, "twelvedata")
    from types import SimpleNamespace

    monkeypatch.setattr(
        td.requests,
        "get",
        lambda *a, **kw: SimpleNamespace(
            raise_for_status=lambda: None,
            json=lambda: {"status": "error", "message": "offline fixture error"},
        ),
    )
    with pytest.raises(RuntimeError, match="Twelve Data API error"):
        load(state)


def test_twelve_data_http_error_does_not_normalize(monkeypatch):
    state = offline_adapter(monkeypatch, "twelvedata")
    from types import SimpleNamespace

    def http_error():
        raise requests.HTTPError("offline HTTP error")

    monkeypatch.setattr(
        td.requests,
        "get",
        lambda *a, **kw: SimpleNamespace(raise_for_status=http_error),
    )
    with pytest.raises(requests.HTTPError):
        load(state)


@pytest.mark.parametrize("values", [{}, "bad-response", [None]])
def test_twelve_data_malformed_values_fail_closed(monkeypatch, values):
    state = offline_adapter(monkeypatch, "twelvedata")
    from types import SimpleNamespace

    monkeypatch.setattr(
        td.requests,
        "get",
        lambda *a, **kw: SimpleNamespace(
            raise_for_status=lambda: None, json=lambda: {"values": values}
        ),
    )
    with pytest.raises(ValueError, match="list of OHLCV rows"):
        load(state)


def test_short_binance_kline_is_rejected(monkeypatch):
    monkeypatch.setattr(
        bi.BinanceProvider,
        "_make_client",
        lambda self: type(
            "Client", (), {"get_historical_klines": lambda *a: [[1704067200000, "100"]]}
        )(),
    )
    with pytest.raises(RawProviderDataError):
        bi.BinanceProvider().get_ohlcv("TEST")


@pytest.mark.parametrize("response", [{}, "bad-response", [None]])
def test_binance_malformed_response_fails_closed(monkeypatch, response):
    monkeypatch.setattr(
        bi.BinanceProvider,
        "_make_client",
        lambda self: type(
            "Client", (), {"get_historical_klines": lambda *a: response}
        )(),
    )
    with pytest.raises(ValueError, match="array"):
        bi.BinanceProvider().get_ohlcv("TEST")

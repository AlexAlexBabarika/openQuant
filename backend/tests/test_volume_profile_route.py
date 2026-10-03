"""Route smoke tests for /data/volume-profile."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.market import cache
from backend.market.models import OHLCVCandle
from backend.market.volume_profile import bin_from_candle_distribution
from backend.routes.volume_profile_routes import router

app = FastAPI()
app.include_router(router)
client = TestClient(app)


def _candle(
    ts: datetime, o: float, h: float, lo: float, c: float, v: float
) -> OHLCVCandle:
    return OHLCVCandle(
        timestamp=ts,
        symbol="TEST",
        open=o,
        high=h,
        low=lo,
        close=c,
        volume=v,
    )


@pytest.fixture(autouse=True)
def _reset_caches(monkeypatch):
    monkeypatch.setattr(cache, "_data_cache", {})
    monkeypatch.setattr(cache, "_profile_cache", {})
    monkeypatch.setattr(cache, "_csv_keys", set())


def test_404_when_no_candles_cached():
    r = client.get(
        "/data/volume-profile",
        params={
            "provider": "yahoo",
            "symbol": "TEST",
            "startTs": 0,
            "rowSize": 1.0,
            "interval": "1d",
        },
    )
    assert r.status_code == 404


def test_200_with_expected_shape():
    base = datetime(2025, 1, 1, tzinfo=timezone.utc)
    candles = [
        _candle(
            base + timedelta(days=i), 10 + i, 12 + i, 9 + i, 11 + i, 100.0 * (i + 1)
        )
        for i in range(5)
    ]
    cache.set_cached("yahoo", "TEST", candles, interval="1d")
    start_ts = int(base.timestamp())

    r = client.get(
        "/data/volume-profile",
        params={
            "provider": "yahoo",
            "symbol": "TEST",
            "startTs": start_ts,
            "rowSize": 1.0,
            "vaPercent": 0.7,
            "interval": "1d",
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["source"] == "candle-distribution"
    assert body["provider"] == "yahoo"
    assert body["symbol"] == "TEST"
    assert body["interval"] == "1d"
    assert body["startTs"] == start_ts
    assert body["endTs"] is None
    assert body["firstCandleTs"] == start_ts
    assert body["latestCandleTs"] == start_ts + 4 * 86400
    assert "bins" in body and len(body["bins"]) > 0
    assert body["val"] <= body["poc"] <= body["vah"]
    b0 = body["bins"][0]
    assert {"price", "upVol", "downVol"} <= set(b0.keys())


def test_cache_hit_second_call_returns_same_payload():
    base = datetime(2025, 1, 1, tzinfo=timezone.utc)
    candles = [_candle(base, 10, 12, 9, 11, 100.0)]
    cache.set_cached("yahoo", "TEST", candles, interval="1d")

    params = {
        "provider": "yahoo",
        "symbol": "TEST",
        "startTs": int(base.timestamp()),
        "rowSize": 1.0,
        "vaPercent": 0.7,
        "interval": "1d",
    }
    first = client.get("/data/volume-profile", params=params).json()
    second = client.get("/data/volume-profile", params=params).json()
    assert first == second


def _params(**overrides):
    return {
        "provider": "yahoo",
        "symbol": "TEST",
        "startTs": 0,
        "rowSize": 1.0,
        "vaPercent": 0.7,
        "interval": "1d",
        **overrides,
    }


def _volume(body):
    return sum(b["upVol"] + b["downVol"] for b in body["bins"])


@pytest.mark.parametrize("derived_hit", [False, True])
def test_interval_is_validated_before_derived_hit(derived_hit):
    candles = [_candle(datetime(2025, 1, 1, tzinfo=timezone.utc), 1, 2, 1, 2, 120)]
    cache.set_cached("yahoo", "TEST", candles, interval="1h")
    if derived_hit:
        key = cache.make_profile_key("yahoo", "TEST", 0, None, 1.0, 0.7, "1d")
        cache.set_cached_profile(key, bin_from_candle_distribution(candles, 1, 0.7))
    response = client.get("/data/volume-profile", params=_params())
    assert response.status_code == 409
    assert "interval" in response.json()["detail"].lower()


def test_interval_normalization_and_matching_source():
    cache.set_cached(
        "yahoo",
        "TEST",
        [_candle(datetime(2025, 1, 1, tzinfo=timezone.utc), 1, 2, 1, 2, 120)],
        interval=" 1D ",
    )
    response = client.get("/data/volume-profile", params=_params(interval=" 1D "))
    assert response.status_code == 200
    assert response.json()["interval"] == "1d"
    assert _volume(response.json()) == pytest.approx(120)


def test_unknown_non_csv_interval_is_not_claimed_as_matching():
    cache.set_cached(
        "yahoo",
        "TEST",
        [_candle(datetime(2025, 1, 1, tzinfo=timezone.utc), 1, 2, 1, 2, 120)],
    )
    response = client.get("/data/volume-profile", params=_params())
    assert response.status_code == 409


@pytest.mark.parametrize("end_ts", [None, 1735689600])
@pytest.mark.parametrize("provider", ["yahoo", "csv"])
def test_source_publication_invalidates_fixed_and_latest_profiles(provider, end_ts):
    base = datetime(2025, 1, 1, tzinfo=timezone.utc)

    def publish(candles):
        if provider == "csv":
            cache.set_cached_csv("TEST", candles)
        else:
            cache.set_cached(provider, "TEST", candles, interval="1d")

    publish([_candle(base, 1, 2, 1, 2, 120)])
    unrelated_key = cache.make_profile_key("yahoo", "OTHER", 0, None, 1, 0.7, "1d")
    unrelated_result = object()
    cache.set_cached_profile(unrelated_key, unrelated_result)
    params = _params(provider=provider, **({"endTs": end_ts} if end_ts else {}))
    first = client.get("/data/volume-profile", params=params)
    assert first.status_code == 200
    assert _volume(first.json()) == pytest.approx(120)
    publish([_candle(base, 2, 3, 2, 3, 240)])
    second = client.get("/data/volume-profile", params=params)
    assert second.status_code == 200
    assert _volume(second.json()) == pytest.approx(240)
    assert second.json()["poc"] == 2
    assert cache.get_cached_profile(unrelated_key) is unrelated_result


def test_interval_replacement_cannot_reuse_previous_generation():
    base = datetime(2025, 1, 1, tzinfo=timezone.utc)
    cache.set_cached("yahoo", "TEST", [_candle(base, 1, 2, 1, 2, 120)], interval="1d")
    assert client.get("/data/volume-profile", params=_params()).status_code == 200
    cache.set_cached("yahoo", "TEST", [_candle(base, 2, 3, 2, 3, 240)], interval="1h")
    assert client.get("/data/volume-profile", params=_params()).status_code == 409
    response = client.get("/data/volume-profile", params=_params(interval="1h"))
    assert response.status_code == 200
    assert response.json()["interval"] == "1h"
    assert _volume(response.json()) == pytest.approx(240)


def test_closed_candle_append_refreshes_latest_but_not_fixed_window():
    base = datetime(2025, 1, 1, tzinfo=timezone.utc)
    candles = [_candle(base, 1, 2, 1, 2, 120)]
    cache.set_cached("yahoo", "TEST", candles, interval="1d")
    fixed_params = _params(endTs=int(base.timestamp()))
    assert _volume(client.get("/data/volume-profile", params=_params()).json()) == 120
    assert (
        _volume(client.get("/data/volume-profile", params=fixed_params).json()) == 120
    )
    cache.set_cached(
        "yahoo",
        "TEST",
        [*candles, _candle(base + timedelta(days=1), 2, 3, 2, 3, 240)],
        interval="1d",
    )
    latest = client.get("/data/volume-profile", params=_params()).json()
    fixed = client.get("/data/volume-profile", params=fixed_params).json()
    assert _volume(latest) == 360
    assert latest["latestCandleTs"] == int((base + timedelta(days=1)).timestamp())
    assert _volume(fixed) == 120
    assert fixed["latestCandleTs"] == int(base.timestamp())


@pytest.mark.parametrize("interval", ["1d", "1h"])
def test_csv_without_interval_reports_unknown_interval(interval):
    cache.set_cached_csv(
        "TEST", [_candle(datetime(2025, 1, 1, tzinfo=timezone.utc), 1, 2, 1, 2, 120)]
    )
    response = client.get(
        "/data/volume-profile", params=_params(provider="csv", interval=interval)
    )
    assert response.status_code == 200
    assert response.json()["provider"] == "csv"
    assert response.json()["interval"] is None


def test_no_volume_response_serializes_nullable_levels():
    cache.set_cached(
        "yahoo",
        "TEST",
        [_candle(datetime(2025, 1, 1, tzinfo=timezone.utc), 5, 6, 5, 6, 0)],
        interval="1d",
    )
    response = client.get("/data/volume-profile", params=_params())
    assert response.status_code == 200
    assert response.json()["poc"] is None
    assert response.json()["vah"] is None
    assert response.json()["val"] is None

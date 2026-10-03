"""
Volume profile endpoint.

Reads candles from the existing per-provider cache (populated earlier via
/data/market), runs the candle-distribution algorithm, caches the result.
"""

from __future__ import annotations

import logging
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field, ConfigDict

from backend.market import cache
from backend.market.volume_profile import (
    ProfileResult,
    bin_from_candle_distribution,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/data/volume-profile", tags=["volume-profile"])


class ProfileBinDTO(BaseModel):
    price: float
    up_vol: float = Field(..., alias="upVol")
    down_vol: float = Field(..., alias="downVol")

    model_config = ConfigDict(populate_by_name=True)


class ProfileResponse(BaseModel):
    row_size: float = Field(..., alias="rowSize")
    price_min: float = Field(..., alias="priceMin")
    price_max: float = Field(..., alias="priceMax")
    bins: list[ProfileBinDTO]
    poc: float | None
    vah: float | None
    val: float | None
    source: Literal["candle-distribution"]
    provider: str
    symbol: str
    interval: str | None
    start_ts: int = Field(..., alias="startTs")
    end_ts: int | None = Field(..., alias="endTs")
    first_candle_ts: int = Field(..., alias="firstCandleTs")
    latest_candle_ts: int = Field(..., alias="latestCandleTs")

    model_config = ConfigDict(populate_by_name=True)


def _to_dto(
    r: ProfileResult,
    *,
    provider: str,
    symbol: str,
    interval: str | None,
    start_ts: int,
    end_ts: int | None,
    first_candle_ts: int,
    latest_candle_ts: int,
) -> ProfileResponse:
    return ProfileResponse(
        rowSize=r.row_size,
        priceMin=r.price_min,
        priceMax=r.price_max,
        bins=[
            ProfileBinDTO(price=b.price, upVol=b.up_vol, downVol=b.down_vol)
            for b in r.bins
        ],
        poc=r.poc,
        vah=r.vah,
        val=r.val,
        source="candle-distribution",
        provider=provider,
        symbol=symbol,
        interval=interval,
        startTs=start_ts,
        endTs=end_ts,
        firstCandleTs=first_candle_ts,
        latestCandleTs=latest_candle_ts,
    )


@router.get("", response_model=ProfileResponse, response_model_by_alias=True)
def get_volume_profile(
    provider: str = Query(..., description="Data provider (e.g. 'yahoo')"),
    symbol: str = Query(..., description="Symbol"),
    start_ts: int = Query(
        ..., alias="startTs", description="Window start (unix seconds)"
    ),
    end_ts: int | None = Query(
        None, alias="endTs", description="Window end (unix seconds); omit = to latest"
    ),
    row_size: float = Query(..., alias="rowSize", gt=0),
    va_pct: float = Query(0.7, alias="vaPercent", gt=0, le=1),
    interval: str = Query(..., description="Chart interval, e.g. '1d'"),
) -> ProfileResponse:
    provider = provider.strip().lower()
    symbol = symbol.strip()
    interval = interval.strip().lower()
    candles = cache.get_cached(provider, symbol)
    if candles is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No cached candles for {provider}:{symbol}. Load market data first.",
        )

    meta = cache.get_cached_meta(provider, symbol)
    source_interval = meta[1] if meta else None
    if source_interval is not None:
        source_interval = source_interval.strip().lower()
    if source_interval != interval and not (
        provider == "csv" and source_interval is None
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cached source interval {source_interval!r} does not match requested interval {interval!r}. Reload market data first.",
        )

    key = cache.make_profile_key(
        provider, symbol, start_ts, end_ts, row_size, va_pct, interval
    )
    cached = cache.get_cached_profile(key)
    if cached is not None:
        return cached

    def _ts(c) -> int:
        return int(c.timestamp.timestamp())

    window = [
        c
        for c in candles
        if _ts(c) >= start_ts and (end_ts is None or _ts(c) <= end_ts)
    ]
    if not window:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No candles in the requested window.",
        )

    result = bin_from_candle_distribution(window, row_size=row_size, va_pct=va_pct)
    response = _to_dto(
        result,
        provider=provider,
        symbol=symbol,
        interval=source_interval,
        start_ts=start_ts,
        end_ts=end_ts,
        first_candle_ts=min(_ts(c) for c in window),
        latest_candle_ts=max(_ts(c) for c in window),
    )
    cache.set_cached_profile(key, response)
    return response

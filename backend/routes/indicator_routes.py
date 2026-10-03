"""
Technical indicator endpoints.

Indicators are computed from cached OHLCV data. The caller must first load
market data via GET /data/market (or POST /data/csv) so that candles are
available in the cache.
"""

from __future__ import annotations

import logging
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field, field_serializer

from backend.market import cache
from backend.market.indicators import (
    calculate_sma,
    calculate_ema,
    calculate_bollinger_bands,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/data/indicators", tags=["indicators"])


class IndicatorPoint(BaseModel):
    timestamp: datetime = Field(..., description="Point time, UTC ISO8601")
    value: float = Field(..., description="Indicator value")

    @field_serializer("timestamp")
    def _ser_ts(self, v: datetime) -> str:
        return v.strftime("%Y-%m-%dT%H:%M:%SZ")


class IndicatorResponse(BaseModel):
    symbol: str
    indicator: str
    period: int
    points: list[IndicatorPoint]


class BollingerBandsPoint(BaseModel):
    timestamp: datetime = Field(..., description="Point time, UTC ISO8601")
    upper: float = Field(..., description="Upper band value")
    middle: float = Field(..., description="Middle band (SMA) value")
    lower: float = Field(..., description="Lower band value")

    @field_serializer("timestamp")
    def _ser_ts(self, v: datetime) -> str:
        return v.strftime("%Y-%m-%dT%H:%M:%SZ")


class BollingerBandsResponse(BaseModel):
    symbol: str
    indicator: str
    period: int
    num_std: float
    points: list[BollingerBandsPoint]


def _find_candles(symbol: str) -> list:
    """Look up cached candles for any provider."""
    sym = symbol.strip()
    for key in reversed(cache.list_cached_keys()):
        if key.endswith(f":{sym}"):
            provider = key.split(":", 1)[0]
            candles = cache.get_cached(provider, sym)
            if candles:
                return candles
    return []


@router.get("/sma", response_model=IndicatorResponse)
async def get_sma(
    symbol: str = Query(..., min_length=1, description="Instrument symbol"),
    period: int = Query(20, ge=1, le=500, description="SMA period"),
) -> IndicatorResponse:
    """Compute Simple Moving Average from cached OHLCV data."""
    candles = _find_candles(symbol)
    if not candles:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No cached data for symbol '{symbol}'. Load market data first.",
        )
    try:
        points = calculate_sma(candles, period)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return IndicatorResponse(
        symbol=symbol.strip(),
        indicator="sma",
        period=period,
        points=[IndicatorPoint(**p) for p in points],
    )


@router.get("/ema", response_model=IndicatorResponse)
async def get_ema(
    symbol: str = Query(..., min_length=1, description="Instrument symbol"),
    period: int = Query(20, ge=1, le=500, description="EMA period"),
) -> IndicatorResponse:
    """Compute Exponential Moving Average from cached OHLCV data."""
    candles = _find_candles(symbol)
    if not candles:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No cached data for symbol '{symbol}'. Load market data first.",
        )
    try:
        points = calculate_ema(candles, period)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return IndicatorResponse(
        symbol=symbol.strip(),
        indicator="ema",
        period=period,
        points=[IndicatorPoint(**p) for p in points],
    )


@router.get("/bbands", response_model=BollingerBandsResponse)
async def get_bbands(
    symbol: str = Query(..., min_length=1, description="Instrument symbol"),
    period: int = Query(20, ge=1, le=500, description="Bollinger Bands period"),
    num_std: float = Query(
        2.0, gt=0, le=5, description="Standard deviation multiplier"
    ),
) -> BollingerBandsResponse:
    """Compute Bollinger Bands from cached OHLCV data."""
    candles = _find_candles(symbol)
    if not candles:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No cached data for symbol '{symbol}'. Load market data first.",
        )
    try:
        points = calculate_bollinger_bands(candles, period, num_std)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return BollingerBandsResponse(
        symbol=symbol.strip(),
        indicator="bbands",
        period=period,
        num_std=num_std,
        points=[BollingerBandsPoint(**p) for p in points],
    )

"""
Quantitative analytics endpoints.

Each metric is computed from cached OHLCV (load via GET /data/market or
POST /data/csv first). One endpoint per metric, all under /data/analytics.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query, status
from starlette.concurrency import run_in_threadpool

from backend.market import cache
from backend.market.data_sources import load_yfinance
from backend.market.analytics import (
    compute_correlation,
    compute_hurst,
    compute_kurtosis,
    compute_max_drawdown,
    compute_return_distribution,
    compute_sharpe,
    compute_skewness,
    compute_sortino,
    compute_stdev,
    compute_var,
    compute_variance,
    compute_volatility_clustering,
)
from backend.market.analytics_models import (
    CorrelationResponse,
    CorrelationRowModel,
    DistributionBinModel,
    DrawdownPointModel,
    MaxDrawdownResponse,
    ReturnDistributionResponse,
    ScalarMetricResponse,
    VaRResponse,
    VolatilityClusteringResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/data/analytics", tags=["analytics"])


def _find_candles(symbol: str) -> list:
    """Look up cached candles for any provider (matches indicator_routes)."""
    sym = symbol.strip()
    for key in reversed(cache.list_cached_keys()):
        if key.endswith(f":{sym}"):
            provider = key.split(":", 1)[0]
            candles = cache.get_cached(provider, sym)
            if candles:
                return candles
    return []


def _find_meta(symbol: str) -> tuple[str, str | None, str | None] | None:
    """Return ``(provider, period, interval)`` for the cached entry, if any."""
    sym = symbol.strip()
    for key in reversed(cache.list_cached_keys()):
        if not key.endswith(f":{sym}"):
            continue
        provider = key.split(":", 1)[0]
        meta = cache.get_cached_meta(provider, sym)
        if meta is not None:
            return provider, meta[0], meta[1]
    return None


def _require_candles(symbol: str) -> list:
    candles = _find_candles(symbol)
    if not candles:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No cached data for symbol '{symbol}'. Load market data first.",
        )
    return candles


def _scalar(
    symbol: str, metric: str, value: float, candles: list
) -> ScalarMetricResponse:
    return ScalarMetricResponse(
        symbol=symbol.strip(),
        metric=metric,
        value=value,
        n=max(len(candles) - 1, 0),
    )


def _bad_request(exc: ValueError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


# --- Risk -------------------------------------------------------------------


@router.get("/sharpe", response_model=ScalarMetricResponse)
async def get_sharpe(
    symbol: str = Query(..., min_length=1),
    rf: float = Query(
        0.0, allow_inf_nan=False, description="Per-period risk-free rate"
    ),
) -> ScalarMetricResponse:
    candles = _require_candles(symbol)
    try:
        v = compute_sharpe(candles, rf=rf)
    except ValueError as e:
        raise _bad_request(e)
    return _scalar(symbol, "sharpe", v, candles)


@router.get("/sortino", response_model=ScalarMetricResponse)
async def get_sortino(
    symbol: str = Query(..., min_length=1),
    rf: float = Query(
        0.0, allow_inf_nan=False, description="Per-period risk-free rate"
    ),
) -> ScalarMetricResponse:
    candles = _require_candles(symbol)
    try:
        v = compute_sortino(candles, rf=rf)
    except ValueError as e:
        raise _bad_request(e)
    return _scalar(symbol, "sortino", v, candles)


@router.get("/max_drawdown", response_model=MaxDrawdownResponse)
async def get_max_drawdown(
    symbol: str = Query(..., min_length=1),
) -> MaxDrawdownResponse:
    candles = _require_candles(symbol)
    try:
        result = compute_max_drawdown(candles)
    except ValueError as e:
        raise _bad_request(e)
    return MaxDrawdownResponse(
        symbol=symbol.strip(),
        max_drawdown=result.max_drawdown,
        series=[
            DrawdownPointModel(timestamp=p.timestamp, value=p.value)
            for p in result.series
        ],
    )


@router.get("/var", response_model=VaRResponse)
async def get_var(symbol: str = Query(..., min_length=1)) -> VaRResponse:
    candles = _require_candles(symbol)
    try:
        result = compute_var(candles)
    except ValueError as e:
        raise _bad_request(e)
    return VaRResponse(
        symbol=symbol.strip(),
        var_95=result.var_95,
        var_99=result.var_99,
        n=result.n,
    )


# --- Statistical basics -----------------------------------------------------


@router.get("/variance", response_model=ScalarMetricResponse)
async def get_variance(symbol: str = Query(..., min_length=1)) -> ScalarMetricResponse:
    candles = _require_candles(symbol)
    try:
        v = compute_variance(candles)
    except ValueError as e:
        raise _bad_request(e)
    return _scalar(symbol, "variance", v, candles)


@router.get("/stdev", response_model=ScalarMetricResponse)
async def get_stdev(symbol: str = Query(..., min_length=1)) -> ScalarMetricResponse:
    candles = _require_candles(symbol)
    try:
        v = compute_stdev(candles)
    except ValueError as e:
        raise _bad_request(e)
    return _scalar(symbol, "stdev", v, candles)


@router.get("/skewness", response_model=ScalarMetricResponse)
async def get_skewness(symbol: str = Query(..., min_length=1)) -> ScalarMetricResponse:
    candles = _require_candles(symbol)
    try:
        v = compute_skewness(candles)
    except ValueError as e:
        raise _bad_request(e)
    return _scalar(symbol, "skewness", v, candles)


@router.get("/kurtosis", response_model=ScalarMetricResponse)
async def get_kurtosis(symbol: str = Query(..., min_length=1)) -> ScalarMetricResponse:
    candles = _require_candles(symbol)
    try:
        v = compute_kurtosis(candles)
    except ValueError as e:
        raise _bad_request(e)
    return _scalar(symbol, "kurtosis", v, candles)


# --- Advanced ---------------------------------------------------------------


@router.get("/correlation", response_model=CorrelationResponse)
async def get_correlation(
    symbol: str = Query(..., min_length=1),
    benchmarks: str = Query("SPY,QQQ", description="Comma-separated benchmark symbols"),
) -> CorrelationResponse:
    candles = _require_candles(symbol)
    names = [b.strip() for b in benchmarks.split(",") if b.strip()]
    if not names:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one benchmark symbol required.",
        )
    primary_meta = _find_meta(symbol)
    period = primary_meta[1] if primary_meta else "1mo"
    interval = primary_meta[2] if primary_meta else "1d"
    bench_map: dict[str, list] = {}
    for name in names:
        bc = _find_candles(name)
        if not bc:
            try:
                bc = await run_in_threadpool(
                    load_yfinance,
                    symbol=name,
                    period=period or "1mo",
                    interval=interval or "1d",
                )
            except Exception as e:
                logger.warning("Benchmark fetch failed for %s: %s", name, e)
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"Failed to load benchmark '{name}': {e}",
                ) from e
            if not bc:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"No data returned for benchmark '{name}'.",
                )
            cache.set_cached("yfinance", name, bc, period=period, interval=interval)
        bench_map[name] = bc
    try:
        result = compute_correlation(candles, bench_map)
    except ValueError as e:
        raise _bad_request(e)
    return CorrelationResponse(
        symbol=symbol.strip(),
        rows=[
            CorrelationRowModel(benchmark=r.benchmark, value=r.value)
            for r in result.rows
        ],
    )


@router.get("/volatility_clustering", response_model=VolatilityClusteringResponse)
async def get_volatility_clustering(
    symbol: str = Query(..., min_length=1),
    lag: int = Query(10, ge=1, le=100),
) -> VolatilityClusteringResponse:
    candles = _require_candles(symbol)
    try:
        result = compute_volatility_clustering(candles, lag=lag)
    except ValueError as e:
        raise _bad_request(e)
    return VolatilityClusteringResponse(
        symbol=symbol.strip(),
        lag=result.lag,
        q=result.q,
        p_value=result.p_value,
    )


@router.get("/hurst", response_model=ScalarMetricResponse)
async def get_hurst(symbol: str = Query(..., min_length=1)) -> ScalarMetricResponse:
    candles = _require_candles(symbol)
    try:
        v = compute_hurst(candles)
    except ValueError as e:
        raise _bad_request(e)
    return _scalar(symbol, "hurst", v, candles)


@router.get("/return_distribution", response_model=ReturnDistributionResponse)
async def get_return_distribution(
    symbol: str = Query(..., min_length=1),
    bins: int = Query(50, ge=1, le=500),
) -> ReturnDistributionResponse:
    candles = _require_candles(symbol)
    try:
        result = compute_return_distribution(candles, bins=bins)
    except ValueError as e:
        raise _bad_request(e)
    return ReturnDistributionResponse(
        symbol=symbol.strip(),
        bins=[
            DistributionBinModel(left=b.left, right=b.right, count=b.count)
            for b in result.bins
        ],
    )

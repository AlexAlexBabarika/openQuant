"""User-script execution and CRUD endpoints."""

from __future__ import annotations

import logging
from datetime import timezone

import polars as pl
import requests
from fastapi import APIRouter, Depends, HTTPException, Request, status
from backend.core.database import DatabaseError, get_database
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from backend.core.auth_deps import get_current_user, optional_current_user
from backend.core.rate_limit import allow, client_key, retry_after_seconds
from backend.market import cache
from backend.market.ohlcv_limits import cap_candles
from backend.market.shared_config import validate_interval, validate_period
from backend.models.auth_models import AuthUserInfo
from backend.models.market_data_models import MarketDataProviderEnum
from backend.models.script_models import (
    ScriptCreateRequest,
    ScriptInfo,
    ScriptListResponse,
    ScriptUpdateRequest,
)
from backend.routes.market_routes import _fetch_candles_blocking
from backend.scripts.output_models import RunResult
from backend.scripts.runner import run_script
from backend.routes.db_error_handlers.script_db_error_handler import (
    ScriptDBErrorHandler,
)

logger: logging.Logger = logging.getLogger(__name__)
scriptDBErrorHandler: ScriptDBErrorHandler = ScriptDBErrorHandler(logger)
router = APIRouter(prefix="/scripts", tags=["scripts"])


class ExecuteRequest(BaseModel):
    code: str | None = Field(None, min_length=1, max_length=200_000)
    script_id: str | None = None
    symbol: str = Field(..., min_length=1)
    provider: MarketDataProviderEnum
    period: str = "1mo"
    interval: str = "1d"
    timeout_s: float = Field(5.0, gt=0, le=30)
    memory_mb: int = Field(256, gt=0, le=1024)


def _candles_to_df(candles, *, preserve_order: bool = False) -> pl.DataFrame:
    schema = {
        "timestamp": pl.Datetime("us", "UTC"),
        "open": pl.Float64,
        "high": pl.Float64,
        "low": pl.Float64,
        "close": pl.Float64,
        "volume": pl.Float64,
    }
    if not candles:
        return pl.DataFrame(schema=schema)
    rows = []
    for c in candles:
        ts = c.timestamp
        if ts.tzinfo is not None:
            ts = ts.astimezone(timezone.utc).replace(tzinfo=None)
        rows.append(
            {
                "timestamp": ts,
                "open": float(c.open),
                "high": float(c.high),
                "low": float(c.low),
                "close": float(c.close),
                "volume": float(c.volume),
            }
        )
    df = pl.DataFrame(rows).with_columns(
        pl.col("timestamp").cast(pl.Datetime("us")).dt.replace_time_zone("UTC")
    )
    return df if preserve_order else df.sort("timestamp")


def _row_to_info(row: dict) -> ScriptInfo:
    return ScriptInfo(
        id=str(row["id"]),
        name=row["name"],
        code=row["code"],
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
    )


def _load_script_code(user_id: str, script_id: str) -> str:
    db = get_database()
    try:
        resp = (
            db.from_("user_scripts")
            .select("code")
            .eq("user_id", user_id)
            .eq("id", script_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        raise scriptDBErrorHandler.handle_db_error(e, "load script") from e
    rows = resp.data or []
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Script {script_id} not found",
        )
    return rows[0]["code"]


@router.post("/execute", response_model=RunResult)
async def execute(
    body: ExecuteRequest,
    request: Request,
    user: AuthUserInfo | None = Depends(optional_current_user),
) -> RunResult:
    if not allow(client_key(request.client.host if request.client else None)):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many script runs. Try again shortly.",
            headers={"Retry-After": str(retry_after_seconds())},
        )

    if body.script_id is not None:
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authentication required to run a saved script.",
                headers={"WWW-Authenticate": "Bearer"},
            )
        code = await run_in_threadpool(_load_script_code, user.id, body.script_id)
    elif body.code is not None:
        code = body.code
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Either 'code' or 'script_id' must be provided.",
        )

    sym = body.symbol.strip()
    try:
        validate_period(body.period)
        validate_interval(body.interval)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)
        ) from e

    if body.provider is MarketDataProviderEnum.twelvedata and user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Twelve Data requires authentication.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    candles = cache.get_cached(
        body.provider.value, sym, period=body.period, interval=body.interval
    )
    if not candles:
        try:
            candles = await run_in_threadpool(
                _fetch_candles_blocking,
                body.provider,
                sym,
                body.period,
                body.interval,
                user,
            )
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)
            ) from e
        except (requests.HTTPError, DatabaseError, RuntimeError) as e:
            logger.warning("Script market-data provider request failed")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Market data provider request failed",
            ) from e
        except Exception as e:
            logger.exception("Script: market data fetch failed: %s", e)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Failed to load market data",
            ) from e
        candles = cap_candles(candles)
        cache.set_cached(
            body.provider.value,
            sym,
            candles,
            period=body.period,
            interval=body.interval,
        )

    if not candles:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No data available for '{sym}'",
        )

    df = _candles_to_df(candles)
    return await run_in_threadpool(
        run_script,
        code,
        df,
        timeout_s=body.timeout_s,
        memory_mb=body.memory_mb,
    )


@router.get("", response_model=ScriptListResponse)
def list_scripts(
    user: AuthUserInfo = Depends(get_current_user),
) -> ScriptListResponse:
    db = get_database()
    try:
        resp = (
            db.from_("user_scripts")
            .select("id, name, code, created_at, updated_at")
            .eq("user_id", user.id)
            .order("updated_at", desc=True)
            .execute()
        )
    except Exception as e:
        raise scriptDBErrorHandler.handle_db_error(e, "list scripts") from e
    return ScriptListResponse(scripts=[_row_to_info(r) for r in resp.data or []])


@router.post("", response_model=ScriptInfo, status_code=status.HTTP_201_CREATED)
def create_script(
    body: ScriptCreateRequest,
    user: AuthUserInfo = Depends(get_current_user),
) -> ScriptInfo:
    db = get_database()
    try:
        resp = (
            db.from_("user_scripts")
            .insert(
                {
                    "user_id": user.id,
                    "name": body.name,
                    "code": body.code,
                }
            )
            .execute()
        )
    except Exception as e:
        raise scriptDBErrorHandler.handle_db_error(e, "create script") from e
    row = resp.data[0] if resp.data else None
    if not row:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to store script (no response).",
        )
    return _row_to_info(row)


@router.get("/{script_id}", response_model=ScriptInfo)
def get_script(
    script_id: str,
    user: AuthUserInfo = Depends(get_current_user),
) -> ScriptInfo:
    db = get_database()
    try:
        resp = (
            db.from_("user_scripts")
            .select("id, name, code, created_at, updated_at")
            .eq("user_id", user.id)
            .eq("id", script_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        raise scriptDBErrorHandler.handle_db_error(e, "read script") from e
    rows = resp.data or []
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Script {script_id} not found",
        )
    return _row_to_info(rows[0])


@router.put("/{script_id}", response_model=ScriptInfo)
def update_script(
    script_id: str,
    body: ScriptUpdateRequest,
    user: AuthUserInfo = Depends(get_current_user),
) -> ScriptInfo:
    patch: dict[str, str] = {}
    if body.name is not None:
        patch["name"] = body.name
    if body.code is not None:
        patch["code"] = body.code
    if not patch:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one of 'name' or 'code' must be provided.",
        )

    db = get_database()
    try:
        resp = (
            db.from_("user_scripts")
            .update(patch)
            .eq("user_id", user.id)
            .eq("id", script_id)
            .execute()
        )
    except Exception as e:
        raise scriptDBErrorHandler.handle_db_error(e, "update script") from e
    rows = resp.data or []
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Script {script_id} not found",
        )
    return _row_to_info(rows[0])


@router.delete("/{script_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_script(
    script_id: str,
    user: AuthUserInfo = Depends(get_current_user),
) -> None:
    db = get_database()
    try:
        resp = (
            db.from_("user_scripts")
            .delete()
            .eq("user_id", user.id)
            .eq("id", script_id)
            .execute()
        )
    except Exception as e:
        raise scriptDBErrorHandler.handle_db_error(e, "delete script") from e
    if not resp.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Script {script_id} not found",
        )

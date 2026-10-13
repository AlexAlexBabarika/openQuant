# backend/routes/backtest_routes.py
"""Single-run backtest endpoint.

Runs one strategy script against market data inside the spawn sandbox
(``run_strategy``) and returns the full canonical result blob plus run status
and captured stdout/stderr. Param values default to the first value of each
declared ``params`` entry; the request may override any of them. Market data
is loaded with the same cache+provider path as ``/sweeps``.
"""

from __future__ import annotations

import dataclasses
import logging
from typing import Literal, TypedDict

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from backend.backtesting.run_config import RunInputs
from backend.backtesting.data_quality import inspect_frame
from backend.backtesting.run_snapshot import assemble_snapshot
from backend.backtesting.run_store import RunStore
from backend.backtesting.sandbox import parse_strategy_schema, run_strategy
from backend.core.auth_deps import get_current_user
from backend.models.auth_models import AuthUserInfo
from backend.models.market_data_models import MarketDataProviderEnum
from backend.routes.sweep_routes import _load_research_frame as _load_frame
from backend.scripts.ast_guard import ScriptValidationError

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/backtests", tags=["backtests"])

_RUN_STORE = RunStore.default()

_RUN_TIMEOUT_S = 30.0
_RUN_BEARER = HTTPBearer(auto_error=False)


class RunPersistence(TypedDict):
    stored: bool
    reason: Literal["authenticated", "guest", "run_failed"]
    run_id: str | None


def optional_run_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_RUN_BEARER),
) -> AuthUserInfo | None:
    if "authorization" not in request.headers:
        return None
    return get_current_user(credentials)


class BacktestRunRequest(BaseModel):
    code: str = Field(..., min_length=1, max_length=200_000)
    symbol: str = Field(..., min_length=1, pattern=r"\S")
    provider: MarketDataProviderEnum
    period: str = "1y"
    interval: str = "1d"
    starting_cash: float = Field(100_000.0, gt=0, allow_inf_nan=False)
    seed: int = 0
    params: dict = Field(default_factory=dict)
    preview_data_version: str | None = Field(default=None, max_length=512)


class QualityPreviewRequest(BaseModel):
    symbol: str = Field(min_length=1, pattern=r"\S")
    provider: MarketDataProviderEnum
    period: str = "1y"
    interval: str = "1d"


def execution_quality(body, frame, data_version: str) -> dict:
    quality = inspect_frame(
        frame,
        provider=body.provider.value,
        interval=body.interval,
        data_version=data_version,
    )
    if getattr(body, "preview_data_version", None) not in (None, data_version):
        raise HTTPException(
            409,
            {
                "message": "Dataset changed since quality preview. Preview again before running.",
                "data_quality": quality,
            },
        )
    if quality["errors"]:
        raise HTTPException(
            422,
            {
                "message": "Data quality errors block execution.",
                "data_quality": quality,
            },
        )
    return quality


@router.post("/quality-preview")
async def quality_preview(
    body: QualityPreviewRequest, user: AuthUserInfo | None = Depends(optional_run_user)
) -> dict:
    frame, data_version = await _load_frame(body, user, cache_only=True)
    return {
        "data_quality": inspect_frame(
            frame,
            provider=body.provider.value,
            interval=body.interval,
            data_version=data_version,
        ),
        "data_version": data_version,
        "limitation": "Cache-only preview of canonical provider bars after upstream normalization; not provider certification. Execution re-inspects its loaded snapshot and rejects changed preview identity. Calendar, adjustment and freshness are unknown.",
    }


@router.post("/run")
async def run(
    body: BacktestRunRequest, user: AuthUserInfo | None = Depends(optional_run_user)
) -> dict:
    try:
        schema = parse_strategy_schema(body.code)
    except ScriptValidationError as e:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"strategy rejected: {e}"
        ) from e
    defaults = {name: p.values()[0] for name, p in schema.items()}
    params = {**defaults, **body.params}

    frame, data_version = await _load_frame(body, user)
    quality = execution_quality(body, frame, data_version)
    result = await run_in_threadpool(
        run_strategy,
        body.code,
        frame,
        starting_cash=body.starting_cash,
        timeout_s=_RUN_TIMEOUT_S,
        seed=body.seed,
        params=params,
    )
    blob = dataclasses.asdict(result)
    blob["meta"]["data_quality"] = quality
    blob["meta"]["data_version"] = data_version
    persistence: RunPersistence = {
        "stored": False,
        "reason": "guest" if user is None else "run_failed",
        "run_id": None,
    }
    blob["meta"].pop("run_id", None)
    if result.status == "ok" and user is not None:
        inputs = RunInputs(
            code=body.code,
            params=params,
            data_version=data_version,
            seed=body.seed,
            starting_cash=body.starting_cash,
            date_range={
                "start": quality["provenance"]["start"],
                "end": quality["provenance"]["end"],
            },
        )
        run_id = await run_in_threadpool(
            _RUN_STORE.for_owner(user.id).write, assemble_snapshot(blob, inputs)
        )
        blob["run_id"] = run_id
        # Expose the content-addressed id as meta.run_id too, so it matches the
        # stored snapshot (and what GET /backtests/runs/{id} returns) rather than
        # the engine's throwaway uuid.
        blob["meta"]["run_id"] = run_id
        persistence = {"stored": True, "reason": "authenticated", "run_id": run_id}
    blob["persistence"] = persistence
    return blob

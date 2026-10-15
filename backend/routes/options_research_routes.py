"""Guest-accessible, provider-free research in bounded disposable workers."""

from __future__ import annotations

import json
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, ValidationError
from starlette.concurrency import run_in_threadpool

from backend.derivatives.research import (
    analyze_distribution,
    evaluate_lifecycle,
    find_strategies,
    simulate_hedge,
)
from backend.derivatives.research_models import (
    DistributionRequest,
    DistributionResponse,
    FinderRequest,
    FinderResponse,
    HedgeRequest,
    HedgeResponse,
    LifecycleRequest,
    LifecycleResponse,
)
from backend.derivatives.runner import (
    DEFAULT_TIMEOUT_S,
    OptionsBusyError,
    OptionsRunError,
    OptionsTimeoutError,
    _WORKERS,
)
from backend.scripts.runner import (
    DEFAULT_MEMORY_MB,
    _apply_resource_limits,
    _block_network,
    spawn_and_collect,
)
from backend.routes.options_routes import OptionsRoute

MAX_OUTPUT_BYTES = 1_048_576
ResearchKind = Literal["finder", "lifecycle", "hedge", "distribution"]
_FUNCTIONS = {
    "finder": find_strategies,
    "lifecycle": evaluate_lifecycle,
    "hedge": simulate_hedge,
    "distribution": analyze_distribution,
}
_RESPONSES: dict[str, type[BaseModel]] = {
    "finder": FinderResponse,
    "lifecycle": LifecycleResponse,
    "hedge": HedgeResponse,
    "distribution": DistributionResponse,
}


class _OutputTooLarge(ValueError):
    pass


def _encode(result: BaseModel) -> bytes:
    encoded = json.dumps(
        result.model_dump(mode="json"),
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    if len(encoded) > MAX_OUTPUT_BYTES:
        raise _OutputTooLarge(
            "Research output exceeds 1048576 bytes; reduce path points, legs or result limit"
        )
    return encoded


def _research_child(conn: Any, kind: ResearchKind, request: dict[str, Any]) -> None:
    _apply_resource_limits(DEFAULT_MEMORY_MB)
    _block_network()
    try:
        result = _FUNCTIONS[kind](request)
        payload = {"status": "ok", "result": _encode(result)}
    except _OutputTooLarge as exc:
        payload = {"status": "oversize", "error": str(exc)}
    except ValidationError as exc:
        errors = [
            {"loc": e["loc"], "msg": e["msg"], "type": e["type"]} for e in exc.errors()
        ]
        payload = {
            "status": "error",
            "error": f"Invalid research inputs/result: {errors}"[:2000],
        }
    except (ValueError, ArithmeticError) as exc:
        payload = {"status": "error", "error": str(exc)[:2000]}
    except Exception:
        payload = {"status": "error", "error": "Research computation failed"}
    try:
        conn.send(payload)
    finally:
        conn.close()


def run_research(
    kind: ResearchKind, request: BaseModel, *, timeout_s: float = DEFAULT_TIMEOUT_S
) -> Response:
    # Shared with legacy options workers: new endpoints cannot multiply the process budget.
    if not _WORKERS.acquire(blocking=False):
        raise OptionsBusyError("Options workers are busy; retry shortly")
    try:
        payload, timed_out, _ = spawn_and_collect(
            _research_child, (kind, request.model_dump(mode="json")), timeout_s
        )
    finally:
        _WORKERS.release()
    if timed_out:
        raise OptionsTimeoutError("Options research timed out")
    if payload is None:
        raise OptionsRunError("Research worker exited without a result")
    if payload.get("status") == "oversize":
        raise HTTPException(status_code=413, detail=payload["error"])
    if payload.get("status") != "ok":
        raise OptionsRunError(
            str(payload.get("error", "Research computation failed"))[:2000]
        )
    try:
        result = _RESPONSES[kind].model_validate_json(payload["result"])
        encoded = _encode(result)
    except _OutputTooLarge as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except (ValueError, TypeError, KeyError) as exc:
        raise OptionsRunError("Invalid research worker result") from exc
    return Response(content=encoded, media_type="application/json")


router = APIRouter(
    prefix="/options/research", tags=["options"], route_class=OptionsRoute
)


@router.post("/finder", response_model=FinderResponse)
async def options_finder(body: FinderRequest) -> Response:
    return await run_in_threadpool(run_research, "finder", body)


@router.post("/lifecycle", response_model=LifecycleResponse)
async def options_lifecycle(body: LifecycleRequest) -> Response:
    return await run_in_threadpool(run_research, "lifecycle", body)


@router.post("/hedge", response_model=HedgeResponse)
async def options_hedge(body: HedgeRequest) -> Response:
    return await run_in_threadpool(run_research, "hedge", body)


@router.post("/distribution", response_model=DistributionResponse)
async def options_distribution(body: DistributionRequest) -> Response:
    return await run_in_threadpool(run_research, "distribution", body)

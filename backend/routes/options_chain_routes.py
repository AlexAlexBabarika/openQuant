"""Account-private, bounded GET-only Tradier options-chain routes."""

from __future__ import annotations

import asyncio
import threading
from collections import deque
from collections.abc import Awaitable, Callable, Coroutine
from time import monotonic
from typing import TypeVar

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from starlette.concurrency import run_in_threadpool

from backend.core.api_key_store import fetch_api_key
from backend.core.auth_deps import get_current_user
from backend.derivatives import chains
from backend.derivatives.research_models import (
    ChainDate,
    ChainExpirationsResponse,
    ChainResponse,
    ChainStatus,
    ChainStatusResponse,
    Environment,
    Symbol,
)
from backend.models.auth_models import AuthUserInfo

RATE_LIMIT = 30
RATE_WINDOW = 60
MAX_RATE_KEYS = 4096
REQUEST_TIMEOUT = 15
BODY_READ_TIMEOUT = 1
_windows: dict[tuple[str, str], deque[float]] = {}
_rate_lock = threading.Lock()
_slots = threading.BoundedSemaphore(8)
_key_slots = threading.BoundedSemaphore(4)
T = TypeVar("T")


class ChainRoute(APIRoute):
    def get_route_handler(self) -> Callable[[Request], Coroutine[None, None, Response]]:
        handler = super().get_route_handler()

        async def bounded(request: Request) -> Response:
            allowed = {
                "status": set(),
                "expirations": {"symbol", "environment"},
                "chain": {"symbol", "expiration", "environment"},
            }[request.url.path.rsplit("/", 1)[-1]]
            if len(request.scope.get("query_string", b"")) > 1024:
                raise HTTPException(
                    414, "Options chain query exceeds the length limit."
                )
            if any(
                key not in allowed or len(request.query_params.getlist(key)) != 1
                for key in request.query_params
            ):
                raise HTTPException(
                    422,
                    "Only the declared chain query parameters are accepted, once each.",
                )
            if request.headers.get("content-length", "0") != "0" or request.headers.get(
                "transfer-encoding"
            ):
                raise HTTPException(
                    422, "Options chain GETs do not accept request bodies."
                )
            try:
                async with asyncio.timeout(BODY_READ_TIMEOUT):
                    async for chunk in request.stream():
                        if chunk:
                            raise HTTPException(
                                422, "Options chain GETs do not accept request bodies."
                            )
            except TimeoutError:
                raise HTTPException(
                    408, "Options chain request body timed out."
                ) from None
            try:
                response = await handler(request)
            except RequestValidationError as exc:
                raise HTTPException(
                    422,
                    detail=[
                        {"loc": e["loc"], "msg": e["msg"], "type": e["type"]}
                        for e in exc.errors()
                    ],
                ) from None
            except chains.ChainError as exc:
                headers = (
                    {"Retry-After": "60"}
                    if exc.status_code == 429
                    else {"Retry-After": "1"}
                )
                raise HTTPException(
                    exc.status_code, str(exc), headers=headers
                ) from None
            response.headers["Cache-Control"] = "no-store, private"
            response.headers["Vary"] = "Authorization"
            return response

        return bounded


router = APIRouter(
    prefix="/options/chains", tags=["options-chains"], route_class=ChainRoute
)


def _allow(user_id: str, environment: str) -> bool:
    now = monotonic()
    with _rate_lock:
        expired = [
            key for key, window in _windows.items() if now - window[-1] >= RATE_WINDOW
        ]
        for key in expired:
            del _windows[key]
        key = (user_id, environment)
        if key not in _windows:
            if len(_windows) >= MAX_RATE_KEYS:
                return False
            _windows[key] = deque()
        window = _windows[key]
        while window and now - window[0] >= RATE_WINDOW:
            window.popleft()
        if len(window) >= RATE_LIMIT:
            return False
        window.append(now)
        return True


def _read_key(user_id: str, environment: Environment) -> str | None:
    # Keep the slot until the actual blocking lookup exits, even if its waiter cancels.
    if not _key_slots.acquire(blocking=False):
        raise chains.ChainError("Options key lookup is busy. Try again shortly.", 503)
    try:
        try:
            return fetch_api_key(user_id, chains.provider_key(environment))
        except ValueError:
            return None
        except Exception:
            raise chains.ChainError(
                "Options key configuration is unavailable. Try again shortly.", 503
            ) from None
    finally:
        _key_slots.release()


async def _required_key(user_id: str, environment: Environment) -> str:
    key = await run_in_threadpool(_read_key, user_id, environment)
    if key is None:
        raise chains.ChainError(
            "Add or re-save the selected Tradier environment key in API Keys settings.",
            409,
        )
    return key


async def _disconnected(request: Request) -> None:
    while not await request.is_disconnected():
        await asyncio.sleep(0.1)


async def _execute(
    request: Request,
    user: AuthUserInfo,
    environment: str,
    operation: Callable[[], Awaitable[T]],
) -> T:
    if not _allow(user.id, environment):
        raise chains.ChainError(
            "Too many options chain requests. Try again in a minute.", 429
        )
    if not _slots.acquire(blocking=False):
        raise chains.ChainError(
            "Options chain service is busy. Try again shortly.", 503
        )
    work = asyncio.ensure_future(operation())
    disconnect = asyncio.create_task(_disconnected(request))
    try:
        async with asyncio.timeout(REQUEST_TIMEOUT):
            done, _ = await asyncio.wait(
                (work, disconnect), return_when=asyncio.FIRST_COMPLETED
            )
            if disconnect in done:
                raise HTTPException(499, "Options chain request cancelled.")
            return await work
    except TimeoutError:
        raise chains.ChainError(
            "Options chain request timed out. Try again shortly.", 504
        ) from None
    finally:
        work.cancel()
        disconnect.cancel()
        try:
            await asyncio.gather(work, disconnect, return_exceptions=True)
        finally:
            _slots.release()


@router.get("/status", response_model=ChainStatusResponse)
async def chain_status(
    request: Request, user: AuthUserInfo = Depends(get_current_user)
) -> ChainStatusResponse:
    async def load() -> ChainStatusResponse:
        statuses = []
        for environment in ("production", "sandbox"):
            key = await run_in_threadpool(_read_key, user.id, environment)
            configured = key is not None
            statuses.append(
                ChainStatus(
                    environment=environment,
                    configured=configured,
                    available=configured,
                    message=(
                        "Key configured; read-only requests available. Entitlement and freshness not verified."
                        if configured
                        else "Add this environment's key in API Keys settings."
                    ),
                )
            )
        return ChainStatusResponse(environments=statuses)

    return await _execute(request, user, "status", load)


@router.get("/expirations", response_model=ChainExpirationsResponse)
async def chain_expirations(
    request: Request,
    symbol: Symbol,
    environment: Environment,
    user: AuthUserInfo = Depends(get_current_user),
) -> ChainExpirationsResponse:
    async def load() -> ChainExpirationsResponse:
        key = await _required_key(user.id, environment)
        return await chains.fetch_expirations(key, symbol, environment)

    return await _execute(request, user, environment, load)


@router.get("/chain", response_model=ChainResponse)
async def option_chain(
    request: Request,
    symbol: Symbol,
    expiration: ChainDate,
    environment: Environment,
    user: AuthUserInfo = Depends(get_current_user),
) -> ChainResponse:
    async def load() -> ChainResponse:
        key = await _required_key(user.id, environment)
        return await chains.fetch_chain(key, symbol, expiration, environment)

    return await _execute(request, user, environment, load)

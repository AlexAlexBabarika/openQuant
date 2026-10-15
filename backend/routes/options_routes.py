"""Guest-accessible manual options research; no providers or stored artifacts."""

from __future__ import annotations

from collections.abc import Callable, Coroutine

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

from backend.core.rate_limit import allow, client_key, retry_after_seconds
from backend.derivatives import OptionsAnalysis, OptionsAnalysisRequest
from backend.derivatives.runner import (
    MAX_SOURCE_LENGTH,
    MAX_STDOUT_BYTES,
    OptionsBusyError,
    OptionsRunError,
    OptionsTimeoutError,
    run_options_analysis,
    run_options_python,
)

MAX_REQUEST_BYTES = 131_072


class OptionsRoute(APIRoute):
    def get_route_handler(self) -> Callable[[Request], Coroutine[None, None, Response]]:
        handler = super().get_route_handler()

        async def bounded(request: Request) -> Response:
            key = "options:" + client_key(
                request.client.host if request.client else None
            )
            if not allow(key):
                raise HTTPException(
                    status_code=429,
                    detail="Too many options analyses. Try again shortly.",
                    headers={"Retry-After": str(retry_after_seconds())},
                )
            body = bytearray()
            async for chunk in request.stream():
                if len(body) + len(chunk) > MAX_REQUEST_BYTES:
                    raise HTTPException(
                        status_code=413, detail="Options request exceeds 131072 bytes"
                    )
                body.extend(chunk)
            request._body = bytes(body)
            try:
                return await handler(request)
            except RequestValidationError as exc:
                errors = [
                    {"loc": e["loc"], "msg": e["msg"], "type": e["type"]}
                    for e in exc.errors()
                ]
                raise HTTPException(status_code=422, detail=errors) from exc
            except RecursionError as exc:
                raise HTTPException(
                    status_code=422, detail="Options request is too deeply nested"
                ) from exc
            except OptionsTimeoutError as exc:
                raise HTTPException(status_code=408, detail=str(exc)) from exc
            except OptionsBusyError as exc:
                raise HTTPException(
                    status_code=503, detail=str(exc), headers={"Retry-After": "1"}
                ) from exc
            except OptionsRunError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc

        return bounded


router = APIRouter(prefix="/options", tags=["options"], route_class=OptionsRoute)


class OptionsPythonRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)
    source: str = Field(min_length=1, max_length=MAX_SOURCE_LENGTH)


class OptionsPythonAnalysis(OptionsAnalysis):
    stdout: str = Field(default="", max_length=MAX_STDOUT_BYTES)


@router.post("/analyze", response_model=OptionsAnalysis)
async def options_analyze(body: OptionsAnalysisRequest) -> OptionsAnalysis:
    return await run_in_threadpool(run_options_analysis, body)


@router.post(
    "/python", response_model=OptionsPythonAnalysis, response_model_exclude_unset=True
)
async def options_python(body: OptionsPythonRequest) -> OptionsPythonAnalysis:
    result = await run_in_threadpool(run_options_python, body.source)
    return OptionsPythonAnalysis.model_validate(result)

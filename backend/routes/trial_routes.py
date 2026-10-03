"""No-provider public demo endpoints for curated Strategy on Trial reports."""

from __future__ import annotations

from collections.abc import Callable, Coroutine

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from starlette.concurrency import run_in_threadpool

from backend.trial.models import TrialCatalog, TrialConfig, TrialReport
from backend.trial.report import TrialBusyError, catalog, get_report


class TrialRoute(APIRoute):
    def get_route_handler(self) -> Callable[[Request], Coroutine[None, None, Response]]:
        handler = super().get_route_handler()

        async def validated(request: Request) -> Response:
            try:
                return await handler(request)
            except RequestValidationError as exc:
                # Raw invalid inputs can contain non-JSON floats or private code.
                errors = [
                    {"loc": error["loc"], "msg": error["msg"], "type": error["type"]}
                    for error in exc.errors()
                ]
                raise HTTPException(status_code=422, detail=errors) from exc

        return validated


router = APIRouter(prefix="/trial", tags=["trial"], route_class=TrialRoute)


@router.get("/catalog", response_model=TrialCatalog)
async def trial_catalog() -> TrialCatalog:
    return catalog()


@router.post("/run", response_model=TrialReport)
async def trial_run(body: TrialConfig) -> TrialReport:
    try:
        return await run_in_threadpool(get_report, body)
    except TrialBusyError as exc:
        raise HTTPException(
            status_code=503,
            detail="Trial computation is busy; retry shortly.",
            headers={"Retry-After": "1"},
        ) from exc

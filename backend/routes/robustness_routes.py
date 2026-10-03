"""Private workspace robustness; never registered by the examples-only server."""

from threading import BoundedSemaphore

from fastapi import APIRouter, Depends, HTTPException
from starlette.concurrency import run_in_threadpool

from backend.backtesting.robustness import run_robustness
from backend.core.auth_deps import get_current_user
from backend.models.auth_models import AuthUserInfo
from backend.models.robustness_models import RobustnessRequest, WorkspaceReport
from backend.routes.sweep_routes import _load_frame
from backend.scripts.ast_guard import ScriptValidationError, validate

router = APIRouter(prefix="/backtests", tags=["backtests"])
_CAPACITY = BoundedSemaphore(2)


@router.post("/robustness", response_model=WorkspaceReport)
async def robustness(
    body: RobustnessRequest, user: AuthUserInfo = Depends(get_current_user)
) -> WorkspaceReport:
    try:
        validate(body.code)
    except ScriptValidationError as exc:
        raise HTTPException(400, f"strategy rejected: {exc}") from exc
    if not _CAPACITY.acquire(blocking=False):
        raise HTTPException(
            429, "Two robustness suites are already running. Retry when one finishes."
        )
    try:
        frame, data_version = await _load_frame(body)
        return await run_in_threadpool(run_robustness, body, frame, data_version)
    except (ValueError, ScriptValidationError) as exc:
        raise HTTPException(400, str(exc)) from exc
    finally:
        _CAPACITY.release()

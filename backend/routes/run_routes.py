# backend/routes/run_routes.py
"""Read / compare / rerun / export / import endpoints for stored run snapshots.

Thin layer over backend.backtesting.run_store + the pure diff/rerun functions.
Every endpoint requires authentication and uses only the caller's namespace.
"""

from __future__ import annotations

import logging
import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool

from backend.backtesting.run_diff import diff_runs
from backend.backtesting.run_id import run_status
from backend.backtesting.run_rerun import rerun
from backend.backtesting.run_store import (
    MAX_NOTEBOOK_BYTES,
    NotebookMetadata,
    NotebookUnreadableError,
    RunIntegrityError,
    RunStore,
    export_run,
    import_run,
)
from backend.core.uploads import read_upload
from backend.core.auth_deps import get_current_user
from backend.models.auth_models import AuthUserInfo

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/backtests/runs", tags=["runs"])

_RUN_STORE = RunStore.default()


def owner_run_store(user: AuthUserInfo = Depends(get_current_user)) -> RunStore:
    return _RUN_STORE.for_owner(user.id)


def _read(store: RunStore, run_id: str) -> dict:
    try:
        return store.read(run_id)
    except FileNotFoundError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"run {run_id} not found") from e


@router.get("")
def list_runs(store: RunStore = Depends(owner_run_store)) -> dict:
    return {"run_ids": store.list_ids()}


@router.get("/notebook/metadata", response_model=NotebookMetadata)
def get_notebook_metadata(
    store: RunStore = Depends(owner_run_store),
) -> NotebookMetadata:
    try:
        return store.read_notebook_metadata()
    except FileNotFoundError as exc:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "No notebook backup saved"
        ) from exc
    except NotebookUnreadableError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Existing notebook backup is unreadable; it has been preserved",
        ) from exc


@router.put("/notebook/metadata", response_model=NotebookMetadata)
async def put_notebook_metadata(
    body: NotebookMetadata,
    request: Request,
    store: RunStore = Depends(owner_run_store),
) -> NotebookMetadata:
    if len(await request.body()) > MAX_NOTEBOOK_BYTES:
        raise HTTPException(
            status.HTTP_413_CONTENT_TOO_LARGE,
            "Notebook metadata exceeds the 6 MiB limit",
        )
    try:
        await run_in_threadpool(store.write_notebook_metadata, body)
    except NotebookUnreadableError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Existing notebook backup is unreadable; it has been preserved",
        ) from exc
    return body


@router.get("/{run_id}")
def get_run(run_id: str, store: RunStore = Depends(owner_run_store)) -> dict:
    blob = _read(store, run_id)
    blob["status"] = run_status(blob["meta"])
    return blob


@router.get("/{a}/compare/{b}")
def compare(a: str, b: str, store: RunStore = Depends(owner_run_store)) -> dict:
    return diff_runs(_read(store, a), _read(store, b))


@router.post("/{run_id}/rerun")
async def rerun_run(run_id: str, store: RunStore = Depends(owner_run_store)) -> dict:
    original = _read(store, run_id)
    try:
        new_id = await run_in_threadpool(rerun, store, run_id)
    except ValueError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e
    return {"run_id": new_id, "diff": diff_runs(original, store.read(new_id))}


@router.get("/{run_id}/export")
def export(run_id: str, store: RunStore = Depends(owner_run_store)) -> FileResponse:
    if not store.exists(run_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"run {run_id} not found")
    dest = Path(tempfile.mkdtemp())
    tar = export_run(store, run_id, dest)
    return FileResponse(
        tar,
        media_type="application/gzip",
        filename=tar.name,
        background=BackgroundTask(shutil.rmtree, dest, ignore_errors=True),
    )


@router.post("/import")
async def import_tarball(
    file: UploadFile, store: RunStore = Depends(owner_run_store)
) -> dict:
    content = await read_upload(file)
    with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as tmp:
        tmp.write(content)
        tmp_path = Path(tmp.name)
    try:
        run_id = await run_in_threadpool(import_run, store, tmp_path)
    except RunIntegrityError as e:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "Invalid run archive"
        ) from e
    finally:
        tmp_path.unlink(missing_ok=True)
    return {"run_id": run_id}

"""Content-addressed, on-disk run snapshot store.

Authenticated callers use ``RunStore.for_owner``; unscoped stores are legacy.
Layout under ``<OPENQUANT_DATA_ROOT or backend/datastore/_data>/runs/``:
    runs/owners/<sha256(owner_id)>/<run_id>/
      meta.json strategy.py params.json config.json metrics.json log.jsonl
      bars.parquet result.json
Writes are atomic (temp dir -> rename) and idempotent (existing id is a no-op).
"""

from __future__ import annotations

import gzip
import json
import os
import re
import shutil
import tarfile
import tempfile
import zlib
from datetime import datetime
from hashlib import sha256
from pathlib import Path
from typing import BinaryIO, Literal

import polars as pl
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    field_validator,
    model_validator,
)

from backend.backtesting.run_id import run_key
from backend.backtesting.run_snapshot import AssembledSnapshot
from backend.scripts.ast_guard import ScriptValidationError, ast_hash

_DEFAULT_DATA_ROOT = Path(__file__).resolve().parents[1] / "datastore" / "_data"
_RUN_ID = re.compile(r"[0-9a-f]{64}")
_SNAPSHOT_FILES = frozenset(
    {
        "meta.json",
        "strategy.py",
        "params.json",
        "config.json",
        "metrics.json",
        "log.jsonl",
        "bars.parquet",
        "result.json",
    }
)
MAX_RUN_IMPORT_BYTES = 64 * 1024 * 1024
MAX_NOTEBOOK_BYTES = 6 * 1024 * 1024


class NotebookEntry(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")

    run_id: str = Field(min_length=1, max_length=256, pattern=r"^[A-Za-z0-9_-]+$")
    kind: Literal["single", "portfolio"]
    label: str = Field(min_length=1, max_length=120)
    created_at: str = Field(min_length=1, max_length=40)
    tags: list[str] = Field(max_length=12)
    notes: str = Field(max_length=10_000)
    baseline: bool
    decision: Literal["unreviewed", "continue", "revise", "reject"]

    @field_validator("label")
    @classmethod
    def nonempty_label(cls, value: str) -> str:
        if not value.strip() or len(value.encode("utf-16-le")) // 2 > 120:
            raise ValueError("label must not be blank")
        return value

    @field_validator("notes")
    @classmethod
    def bounded_notes(cls, value: str) -> str:
        if len(value.encode("utf-16-le")) // 2 > 10_000:
            raise ValueError("notes must be at most 10000 characters")
        return value

    @field_validator("tags")
    @classmethod
    def bounded_tags(cls, value: list[str]) -> list[str]:
        if any(
            not tag.strip() or len(tag.encode("utf-16-le")) // 2 > 600 for tag in value
        ):
            raise ValueError("tags must be nonblank and at most 600 characters")
        return value

    @field_validator("created_at")
    @classmethod
    def iso_date(cls, value: str) -> str:
        if not re.match(r"^\d{4}-\d{2}-\d{2}T", value):
            raise ValueError("created_at must be an ISO date-time")
        datetime.fromisoformat(value)
        return value


class NotebookMetadata(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")

    format: Literal["openquant-notebook-metadata"]
    version: StrictInt = Field(ge=1, le=1)
    entries: list[NotebookEntry] = Field(max_length=50)

    @model_validator(mode="after")
    def unique_references_and_baseline(self) -> "NotebookMetadata":
        if len({entry.run_id for entry in self.entries}) != len(self.entries):
            raise ValueError("duplicate run references are not allowed")
        baselines = [entry for entry in self.entries if entry.baseline]
        if len(baselines) > 1 or any(entry.kind != "single" for entry in baselines):
            raise ValueError("at most one single-symbol baseline is allowed")
        return self


class NotebookUnreadableError(ValueError):
    """An existing notebook cannot be read safely and must not be replaced."""


def _bars_frame(bars: dict) -> pl.DataFrame:
    """Single -> a frame; portfolio -> a frame with a ``symbol`` column."""
    if bars["kind"] == "single":
        rows = bars["data"]
        return (
            pl.DataFrame(rows)
            if rows
            else pl.DataFrame(
                schema={
                    "t": pl.Int64,
                    "open": pl.Float64,
                    "high": pl.Float64,
                    "low": pl.Float64,
                    "close": pl.Float64,
                    "volume": pl.Float64,
                }
            )
        )
    rows = [
        {**b, "symbol": sym} for sym, series in bars["data"].items() for b in series
    ]
    return pl.DataFrame(rows)


class RunStore:
    def __init__(self, root: Path) -> None:
        self._root = Path(root)

    @classmethod
    def default(cls) -> "RunStore":
        env = os.environ.get("OPENQUANT_DATA_ROOT")
        base = Path(env) if env else _DEFAULT_DATA_ROOT
        return cls(base / "runs")

    @property
    def root(self) -> Path:
        return self._root

    def for_owner(self, owner_id: str) -> "RunStore":
        """Select an account namespace without reading or moving legacy artifacts."""
        if not owner_id:
            raise ValueError("owner_id is required")
        return RunStore(self._root / "owners" / sha256(owner_id.encode()).hexdigest())

    def read_notebook_metadata(self) -> NotebookMetadata:
        path = self._root / "notebook-metadata.json"
        try:
            with path.open("rb") as source:
                raw = source.read(MAX_NOTEBOOK_BYTES + 1)
            if len(raw) > MAX_NOTEBOOK_BYTES:
                raise NotebookUnreadableError(
                    "notebook exceeds the metadata size limit"
                )
            return NotebookMetadata.model_validate_json(raw)
        except FileNotFoundError:
            raise
        except (OSError, ValueError) as exc:
            raise NotebookUnreadableError(
                "existing notebook metadata is unreadable"
            ) from exc

    def write_notebook_metadata(self, metadata: NotebookMetadata) -> None:
        data = metadata.model_dump_json().encode()
        if len(data) > MAX_NOTEBOOK_BYTES:
            raise ValueError("notebook exceeds the metadata size limit")
        try:
            self.read_notebook_metadata()
        except FileNotFoundError:
            pass
        self._root.mkdir(mode=0o700, parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            prefix=".notebook-", dir=self._root, delete=False
        ) as tmp:
            path = Path(tmp.name)
            try:
                tmp.write(data)
                tmp.flush()
                os.fsync(tmp.fileno())
                os.replace(path, self._root / "notebook-metadata.json")
            finally:
                path.unlink(missing_ok=True)

    def path(self, run_id: str) -> Path:
        if not _RUN_ID.fullmatch(run_id):
            raise FileNotFoundError("run not found")
        return self._root / run_id

    def exists(self, run_id: str) -> bool:
        try:
            return (self.path(run_id) / "meta.json").is_file()
        except FileNotFoundError:
            return False

    def list_ids(self) -> list[str]:
        if not self._root.exists():
            return []
        return sorted(
            p.name
            for p in self._root.iterdir()
            if _RUN_ID.fullmatch(p.name) and (p / "meta.json").is_file()
        )

    def _publish(self, tmp: Path, run_id: str) -> None:
        try:
            os.rename(tmp, self.path(run_id))
        except OSError:
            if not self.exists(run_id):
                raise

    def write(self, snap: AssembledSnapshot) -> str:
        if self.exists(snap.run_id):
            return snap.run_id
        self._root.mkdir(mode=0o700, parents=True, exist_ok=True)
        tmp = Path(tempfile.mkdtemp(prefix=f".{snap.run_id}.", dir=self._root))
        try:
            (tmp / "meta.json").write_text(json.dumps(snap.meta))
            (tmp / "strategy.py").write_text(snap.strategy_code)
            (tmp / "params.json").write_text(json.dumps(snap.params))
            (tmp / "config.json").write_text(json.dumps(snap.config))
            (tmp / "metrics.json").write_text(json.dumps(snap.metrics))
            (tmp / "log.jsonl").write_text(
                "".join(json.dumps(line) + "\n" for line in snap.log)
            )
            (tmp / "result.json").write_text(json.dumps(snap.result_body))
            _bars_frame(snap.bars).write_parquet(tmp / "bars.parquet")
            self._publish(tmp, snap.run_id)
        finally:
            if tmp.exists():
                shutil.rmtree(tmp, ignore_errors=True)
        return snap.run_id

    def read(self, run_id: str) -> dict:
        d = self.path(run_id)
        if not (d / "meta.json").exists():
            raise FileNotFoundError(f"run {run_id} not found")
        meta = json.loads((d / "meta.json").read_text())
        source = d / "strategy.py"
        source_info = None
        if source.is_file():
            code = source.read_bytes()
            try:
                code_ast_hash = ast_hash(code.decode("utf-8"))
            except (ScriptValidationError, UnicodeDecodeError):
                code_ast_hash = None
            source_info = {
                "sha256": sha256(code).hexdigest(),
                "ast_hash": code_ast_hash,
            }
        result_body = json.loads((d / "result.json").read_text())
        bars_df = pl.read_parquet(d / "bars.parquet")
        if "symbol" in bars_df.columns:
            bars: object = {
                sym: sub.drop("symbol").to_dicts()
                for (sym,), sub in bars_df.group_by("symbol", maintain_order=True)
            }
        else:
            bars = bars_df.to_dicts()
        log = [
            json.loads(line)
            for line in (d / "log.jsonl").read_text().splitlines()
            if line.strip()
        ]
        return {
            "meta": meta,
            "params": json.loads((d / "params.json").read_text()),
            "config": json.loads((d / "config.json").read_text()),
            "metrics": json.loads((d / "metrics.json").read_text()),
            "bars": bars,
            "log": log,
            **result_body,
            "strategy_source": source_info,
        }


class RunIntegrityError(ValueError):
    """A tarball's contents do not match its content-addressed run_id."""


def export_run(store: RunStore, run_id: str, dest_dir: Path) -> Path:
    src = store.path(run_id)
    if not (src / "meta.json").exists():
        raise FileNotFoundError(f"run {run_id} not found")
    dest_dir = Path(dest_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)
    out = dest_dir / f"{run_id}.tar.gz"
    with tarfile.open(out, "w:gz") as tar:
        tar.add(src, arcname=run_id)
    return out


def _verify_integrity(run_id: str, files: Path) -> None:
    meta = json.loads((files / "meta.json").read_text())
    params = json.loads((files / "params.json").read_text())
    config = json.loads((files / "config.json").read_text())
    code = (files / "strategy.py").read_text()

    if ast_hash(code) != meta.get("ast_hash"):
        raise RunIntegrityError(
            f"strategy source does not match recorded ast_hash for {run_id}"
        )
    recomputed = run_key(
        engine_version=meta["engine_version"],
        ast_hash=meta["ast_hash"],
        params=params,
        data_version=meta.get("data_version"),
        seed=meta["seed"],
        config=config,
    )
    if recomputed != run_id or meta.get("run_id") != run_id:
        raise RunIntegrityError(f"contents do not match run_id {run_id}")


def _extract_archive(archive: BinaryIO, files: Path) -> str:
    with tarfile.open(fileobj=archive, mode="r:") as tar:
        run_id = None
        names: set[str] = set()
        for count, member in enumerate(tar, start=1):
            parts = member.name.split("/")
            if count > len(_SNAPSHOT_FILES) + 1 or not _RUN_ID.fullmatch(parts[0]):
                raise RunIntegrityError("invalid run archive layout")
            if run_id is None:
                run_id = parts[0]
            if parts[0] != run_id or member.name in names:
                raise RunIntegrityError("archive must contain exactly one run")
            names.add(member.name)
            if member.isdir() and len(parts) == 1:
                continue
            if (
                not member.isfile()
                or len(parts) != 2
                or parts[1] not in _SNAPSHOT_FILES
            ):
                raise RunIntegrityError("invalid run archive member")
            source = tar.extractfile(member)
            if source is None:
                raise RunIntegrityError("missing run archive content")
            with source, (files / parts[1]).open("wb") as dest:
                shutil.copyfileobj(source, dest)
    if run_id is None or {p.name for p in files.iterdir()} != _SNAPSHOT_FILES:
        raise RunIntegrityError("archive must contain all snapshot files")
    return run_id


def import_run(store: RunStore, tar_path: Path) -> str:
    """Explicitly import a bounded snapshot into the supplied (caller-scoped) store."""
    if tar_path.stat().st_size > MAX_RUN_IMPORT_BYTES:
        raise RunIntegrityError("run archive exceeds the import size limit")
    store.root.mkdir(mode=0o700, parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".import-", dir=store.root) as tmp:
        files = Path(tmp)
        try:
            with tempfile.TemporaryFile() as archive:
                with gzip.open(tar_path, "rb") as compressed:
                    expanded = 0
                    while chunk := compressed.read(1024 * 1024):
                        expanded += len(chunk)
                        if expanded > MAX_RUN_IMPORT_BYTES:
                            raise RunIntegrityError(
                                "expanded archive exceeds the import size limit"
                            )
                        archive.write(chunk)
                archive.seek(0)
                run_id = _extract_archive(archive, files)
            _verify_integrity(run_id, files)
            for name in (
                "meta.json",
                "params.json",
                "config.json",
                "metrics.json",
                "result.json",
            ):
                if not isinstance(json.loads((files / name).read_text()), dict):
                    raise RunIntegrityError("invalid snapshot JSON")
            for line in (files / "log.jsonl").read_text().splitlines():
                if line.strip():
                    json.loads(line)
            result = json.loads((files / "result.json").read_text())
            if not {
                "orders",
                "fills",
                "equity",
                "trades",
            } <= result.keys() or result.keys() - {
                "orders",
                "fills",
                "equity",
                "trades",
                "symbols",
            }:
                raise RunIntegrityError("invalid snapshot result fields")
            pl.read_parquet_schema(files / "bars.parquet")
        except (
            tarfile.TarError,
            gzip.BadGzipFile,
            zlib.error,
            EOFError,
            ValueError,
            KeyError,
            TypeError,
            AttributeError,
            pl.exceptions.PolarsError,
        ) as exc:
            raise RunIntegrityError("invalid or inconsistent run archive") from exc
        if not store.exists(run_id):
            store._publish(files, run_id)
    return run_id

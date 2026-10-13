"""Offline integrity receipts for operator-managed PostgreSQL/data/secret backups.

Never connects to a database, generates secrets, or restores application data.
Receipts contain private paths/hashes and must stay alongside the private backup.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
from pathlib import Path

MAX_ENTRIES = 50_000
MAX_BYTES = 16 * 1024**3
MAX_MANIFEST_BYTES = 16 * 1024**2
MAX_SECRET_BYTES = 16 * 1024


class RecoveryError(ValueError):
    """Fixed diagnostics only; never include input paths or payloads."""


def _regular_file(path: Path):
    if not hasattr(os, "O_NOFOLLOW") or not hasattr(os, "O_NONBLOCK"):
        raise RecoveryError("unsupported_platform")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    handle = os.fdopen(fd, "rb")
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        handle.close()
        raise RecoveryError("unsafe_file")
    return handle


def _bounded_read(path: Path, limit: int) -> bytes:
    with _regular_file(path) as handle:
        raw = handle.read(limit + 1)
    if not raw or len(raw) > limit:
        raise RecoveryError("input_bounds")
    return raw


def _validate_secrets(path: Path) -> None:
    payload = json.loads(_bounded_read(path, MAX_SECRET_BYTES))
    if not isinstance(payload, dict):
        raise RecoveryError("invalid_secrets")
    jwt = payload.get("JWT_SECRET")
    key = payload.get("API_KEYS_ENCRYPTION_KEY")
    if (
        not isinstance(jwt, str)
        or len(jwt.strip()) < 32
        or not isinstance(key, str)
        or not re.fullmatch(r"[0-9a-fA-F]{64}", key.strip())
    ):
        raise RecoveryError("invalid_secrets")


def inventory(data_root: Path, dump: Path, secrets_file: Path, revision: str) -> dict:
    """Hash trusted, offline inputs; do not interpret/execute SQL or research code."""
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise RecoveryError("invalid_revision")
    if not stat.S_ISDIR(data_root.lstat().st_mode):
        raise RecoveryError("unsafe_root")
    _validate_secrets(secrets_file)
    files: dict[str, dict] = {}
    directories: list[str] = []
    total = 0

    def add(path: Path, label: str) -> None:
        nonlocal total
        if len(files) + len(directories) >= MAX_ENTRIES or len(label) > 4096:
            raise RecoveryError("input_bounds")
        with _regular_file(path) as handle:
            before = os.fstat(handle.fileno())
            if before.st_size > MAX_BYTES - total:
                raise RecoveryError("input_bounds")
            digest = hashlib.sha256()
            size = 0
            while chunk := handle.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_BYTES - total:
                    raise RecoveryError("input_bounds")
                digest.update(chunk)
            after = os.fstat(handle.fileno())
            if (
                size != before.st_size
                or before.st_mtime_ns != after.st_mtime_ns
                or before.st_ctime_ns != after.st_ctime_ns
            ):
                raise RecoveryError("input_changed")
        total += size
        files[label] = {"bytes": size, "sha256": digest.hexdigest()}

    add(dump, "database_dump")
    if files["database_dump"]["bytes"] == 0:
        raise RecoveryError("empty_dump")
    add(secrets_file, "runtime_secrets")

    def walk(directory: Path, depth: int = 0) -> None:
        if depth > 64:
            raise RecoveryError("input_bounds")
        with os.scandir(directory) as entries:
            for entry in entries:
                path = Path(entry.path)
                label = "data/" + path.relative_to(data_root).as_posix()
                if entry.is_dir(follow_symlinks=False):
                    if (
                        len(files) + len(directories) >= MAX_ENTRIES
                        or len(label) > 4096
                    ):
                        raise RecoveryError("input_bounds")
                    directories.append(label)
                    walk(path, depth + 1)
                else:
                    add(path, label)

    walk(data_root)
    return {
        "format": "openquant-offline-integrity",
        "version": 1,
        "revision": revision,
        "files": files,
        "directories": sorted(directories),
    }


def capture(
    output: Path, data_root: Path, dump: Path, secrets_file: Path, revision: str
):
    # Do not put the receipt inside the tree it measures or replace any input.
    if output.resolve().is_relative_to(data_root.resolve()) or output.resolve() in {
        dump.resolve(),
        secrets_file.resolve(),
    }:
        raise RecoveryError("unsafe_output")
    receipt = inventory(data_root, dump, secrets_file, revision)
    raw = json.dumps(receipt, sort_keys=True).encode()
    if len(raw) > MAX_MANIFEST_BYTES:
        raise RecoveryError("input_bounds")
    fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as handle:
        handle.write(raw)
        handle.flush()
        os.fsync(handle.fileno())


def verify(
    manifest: Path, data_root: Path, dump: Path, secrets_file: Path, revision: str
):
    expected = json.loads(_bounded_read(manifest, MAX_MANIFEST_BYTES))
    actual = inventory(data_root, dump, secrets_file, revision)
    if json.dumps(expected, sort_keys=True) != json.dumps(actual, sort_keys=True):
        raise RecoveryError("integrity_mismatch")


class _Parser(argparse.ArgumentParser):
    def error(self, message):
        self.exit(2, "recovery: invalid_arguments\n")


def main(argv: list[str] | None = None) -> int:
    parser = _Parser(description=__doc__)
    parser.add_argument("mode", choices=("capture", "verify"))
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--dump", type=Path, required=True)
    parser.add_argument("--secrets-file", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--quiesced", action="store_true")
    args = parser.parse_args(argv)
    if not args.quiesced:
        print("recovery: offline_confirmation_required")
        return 2
    try:
        operation = capture if args.mode == "capture" else verify
        operation(
            args.manifest, args.data_root, args.dump, args.secrets_file, args.revision
        )
    except (OSError, ValueError, RecursionError):
        print("recovery: verification_failed")
        return 1
    print(
        "recovery: receipt_created" if args.mode == "capture" else "recovery: verified"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

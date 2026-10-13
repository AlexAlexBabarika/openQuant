import json
import os
import shutil
import subprocess
import sys
from hashlib import sha256

import pytest

from backend.scripts import research_recovery as recovery

REVISION = "a" * 40


@pytest.fixture
def pair(tmp_path):
    root = tmp_path / "data"
    root.mkdir()
    (root / "empty-owner").mkdir()
    (root / "strategy.py").write_text("def on_bar(ctx): pass")
    dump = tmp_path / "database.sql"
    dump.write_text("synthetic-private-sql")
    key = tmp_path / "secrets.json"
    key.write_text(
        json.dumps({"JWT_SECRET": "b" * 64, "API_KEYS_ENCRYPTION_KEY": "c" * 64})
    )
    return root, dump, key


def test_restored_pair_and_restart_hashes_match(tmp_path, pair):
    receipt = tmp_path / "receipt.json"
    recovery.capture(receipt, *pair, REVISION)
    assert receipt.stat().st_mode & 0o777 == 0o600
    restored = tmp_path / "restored"
    shutil.copytree(pair[0], restored)
    for _ in range(2):
        recovery.verify(receipt, restored, pair[1], pair[2], REVISION)
    with pytest.raises(FileExistsError):
        recovery.capture(receipt, *pair, REVISION)


@pytest.mark.parametrize(
    "damage", ["code", "dump", "key", "missing-key", "extra", "empty-dir"]
)
def test_corruption_and_missing_inputs_fail_without_repair(tmp_path, pair, damage):
    receipt = tmp_path / "receipt.json"
    recovery.capture(receipt, *pair, REVISION)
    if damage == "code":
        (pair[0] / "strategy.py").write_text("broken")
    elif damage == "dump":
        pair[1].write_text("different")
    elif damage == "key":
        pair[2].write_text(
            json.dumps({"JWT_SECRET": "d" * 64, "API_KEYS_ENCRYPTION_KEY": "e" * 64})
        )
    elif damage == "missing-key":
        pair[2].unlink()
    elif damage == "extra":
        (pair[0] / "unexpected").write_text("new")
    else:
        (pair[0] / "empty-owner").rmdir()
    with pytest.raises((recovery.RecoveryError, FileNotFoundError)):
        recovery.verify(receipt, *pair, REVISION)
    if damage == "missing-key":
        assert not pair[2].exists()


@pytest.mark.parametrize("unsafe", ["symlink", "hardlink", "fifo", "root-symlink"])
def test_rejects_unsafe_files(tmp_path, pair, unsafe):
    root, dump, key = pair
    bad = root / "unsafe"
    if unsafe == "symlink":
        bad.symlink_to(dump)
    elif unsafe == "hardlink":
        os.link(dump, bad)
    elif unsafe == "fifo":
        os.mkfifo(bad)
    else:
        bad = tmp_path / "alias"
        bad.symlink_to(root, target_is_directory=True)
        root = bad
    with pytest.raises((recovery.RecoveryError, OSError)):
        recovery.inventory(root, dump, key, REVISION)


def test_bounded_count_bytes_and_manifest(tmp_path, pair, monkeypatch):
    monkeypatch.setattr(recovery, "MAX_ENTRIES", 2)
    with pytest.raises(recovery.RecoveryError):
        recovery.inventory(*pair, REVISION)
    monkeypatch.setattr(recovery, "MAX_ENTRIES", 50_000)
    monkeypatch.setattr(recovery, "MAX_BYTES", 2)
    with pytest.raises(recovery.RecoveryError):
        recovery.inventory(*pair, REVISION)
    monkeypatch.setattr(recovery, "MAX_BYTES", 16 * 1024**3)
    monkeypatch.setattr(recovery, "MAX_MANIFEST_BYTES", 2)
    with pytest.raises(recovery.RecoveryError):
        recovery.capture(tmp_path / "receipt", *pair, REVISION)
    assert not (tmp_path / "receipt").exists()


def test_no_output_inside_inputs(tmp_path, pair):
    for output in (pair[0] / "receipt", pair[1], pair[2]):
        with pytest.raises(recovery.RecoveryError):
            recovery.capture(output, *pair, REVISION)


def test_unsupported_platform_fails_closed(pair, monkeypatch):
    monkeypatch.delattr(os, "O_NOFOLLOW")
    with pytest.raises(recovery.RecoveryError, match="unsupported_platform"):
        recovery.inventory(*pair, REVISION)


def test_cli_redacts_all_diagnostics_and_requires_offline(tmp_path, pair, capsys):
    receipt = tmp_path / "receipt"
    args = [
        "capture",
        "--data-root",
        str(pair[0]),
        "--dump",
        str(pair[1]),
        "--secrets-file",
        str(pair[2]),
        "--manifest",
        str(receipt),
        "--revision",
        REVISION,
    ]
    assert recovery.main(args) == 2
    assert not receipt.exists()
    assert recovery.main([*args, "--quiesced"]) == 0
    pair[2].write_text("private-secret-payload")
    assert recovery.main(["verify", *args[1:], "--quiesced"]) == 1
    output = capsys.readouterr().out
    assert str(tmp_path) not in output
    assert "private" not in output
    assert "synthetic" not in output


def test_malformed_manifest_and_invalid_revision(tmp_path, pair):
    receipt = tmp_path / "receipt"
    receipt.write_text('{"files":{"../../do-not-read":"private"}}')
    with pytest.raises(recovery.RecoveryError):
        recovery.verify(receipt, *pair, REVISION)
    with pytest.raises(recovery.RecoveryError):
        recovery.inventory(*pair, "not-a-revision")


def test_filesystem_drill_native_runs_notebook_and_secret_restart(
    tmp_path, monkeypatch
):
    """Filesystem/crypto drill only: no PostgreSQL restore is implied by a SQL stub."""
    from backend.backtesting.run_store import NotebookMetadata, RunStore
    from backend.core import encryption, runtime_secrets
    from backend.tests.test_run_store import _snap

    root = tmp_path / "source-data"
    root.mkdir()
    secret_file = root / ".openquant" / "secrets.json"
    monkeypatch.setenv("OPENQUANT_SECRETS_FILE", str(secret_file))
    for name in runtime_secrets._SECRET_NAMES:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(runtime_secrets, "_cached", None)
    monkeypatch.setattr(encryption, "_cached_key", None)
    runtime_secrets.load_runtime_secrets()
    encrypted = encryption.encrypt_api_key("synthetic-not-a-provider-credential")
    (root / "synthetic-ciphertext").write_bytes(encrypted)
    expected = sha256(b"synthetic-not-a-provider-credential").hexdigest()
    owner = "00000000-0000-0000-0000-000000000001"
    other = "00000000-0000-0000-0000-000000000002"
    store = RunStore(root / "runs")
    snap = _snap()
    store.for_owner(owner).write(snap)
    store.write(snap)  # Legacy remains separate, never assigned to an account.
    metadata = NotebookMetadata.model_validate(
        {
            "format": "openquant-notebook-metadata",
            "version": 1,
            "entries": [
                {
                    "run_id": snap.run_id,
                    "kind": "single",
                    "label": "Synthetic",
                    "created_at": "2026-10-13T00:00:00Z",
                    "tags": ["synthetic"],
                    "notes": "Recovery fixture",
                    "baseline": True,
                    "decision": "revise",
                }
            ],
        }
    )
    store.for_owner(owner).write_notebook_metadata(metadata)
    dump = tmp_path / "sql-stub-not-a-database-drill"
    dump.write_text("-- filesystem unit fixture only, not a PostgreSQL dump\n")
    receipt = tmp_path / "receipt"
    recovery.capture(receipt, root, dump, secret_file, REVISION)
    restored = tmp_path / "restored-data"
    shutil.copytree(root, restored)
    restored_key = restored / ".openquant" / "secrets.json"
    recovery.verify(receipt, restored, dump, restored_key, REVISION)
    script = """
import hashlib, sys
from pathlib import Path
from backend.backtesting.run_store import RunStore
from backend.core.encryption import decrypt_api_key
try:
    root, owner, other, rid, digest = sys.argv[1:]
    store = RunStore(Path(root) / 'runs')
    blob = store.for_owner(owner).read(rid)
    assert blob['meta']['run_id'] == rid and blob['bars']
    assert blob['strategy_source']['sha256']
    assert store.for_owner(owner).read_notebook_metadata().entries[0].decision == 'revise'
    assert store.for_owner(other).list_ids() == []
    assert store.list_ids() == [rid]
    assert hashlib.sha256(decrypt_api_key((Path(root) / 'synthetic-ciphertext').read_bytes()).encode()).hexdigest() == digest
except Exception:
    sys.exit(1)
"""
    env = dict(os.environ, OPENQUANT_SECRETS_FILE=str(restored_key))
    for name in runtime_secrets._SECRET_NAMES:
        env.pop(name, None)
    command = [
        sys.executable,
        "-c",
        script,
        str(restored),
        owner,
        other,
        snap.run_id,
        expected,
    ]
    for _ in range(2):  # Fresh processes, not a warmed encryption/runtime-secret cache.
        result = subprocess.run(command, env=env, capture_output=True, timeout=30)
        assert result.returncode == 0
        assert not result.stdout and not result.stderr
    damaged = json.loads(restored_key.read_bytes())
    damaged["API_KEYS_ENCRYPTION_KEY"] = "0" * 64
    restored_key.write_text(json.dumps(damaged))
    assert (
        subprocess.run(command, env=env, capture_output=True, timeout=30).returncode
        == 1
    )
    with pytest.raises(recovery.RecoveryError):
        recovery.verify(receipt, restored, dump, restored_key, REVISION)
    restored_key.unlink()
    with pytest.raises(FileNotFoundError):
        recovery.verify(receipt, restored, dump, restored_key, REVISION)
    assert not restored_key.exists()  # Verifier never generates missing secrets.

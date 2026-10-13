# backend/tests/test_run_export.py
import json
import io
import tarfile
import gzip
from concurrent.futures import ThreadPoolExecutor

import pytest
import backend.backtesting.run_store as run_store

from backend.backtesting.engine import run_backtest
from backend.backtesting.run_config import RunInputs
from backend.backtesting.run_snapshot import assemble_snapshot
from backend.backtesting.run_store import (
    RunIntegrityError,
    RunStore,
    export_run,
    import_run,
)
from backend.backtesting.serialize import result_to_dict
from backend.tests._backtesting_fixtures import BuyAndHold, canonical_frame


def _write(store):
    blob = result_to_dict(
        run_backtest(
            frame=canonical_frame(), strategy=BuyAndHold(), starting_cash=1e4, seed=0
        )
    )
    return store.write(
        assemble_snapshot(
            blob,
            RunInputs(
                code="def on_bar(ctx):\n    pass\n",
                params={},
                data_version="v1",
                seed=0,
                starting_cash=1e4,
            ),
        )
    )


def test_export_then_import_round_trips(tmp_path):
    src = RunStore(tmp_path / "a")
    rid = _write(src)
    tar = export_run(src, rid, tmp_path)
    assert tar.exists()

    dst = RunStore(tmp_path / "b")
    assert import_run(dst, tar) == rid
    assert dst.read(rid)["meta"]["run_id"] == rid


def test_import_rejects_tampered_tarball(tmp_path):
    src = RunStore(tmp_path / "a")
    rid = _write(src)
    # tamper: change a param without updating meta -> run_id no longer matches contents
    params_path = src.path(rid) / "params.json"
    params_path.write_text(json.dumps({"n": 999}))
    tar = export_run(src, rid, tmp_path)

    dst = RunStore(tmp_path / "b")
    with pytest.raises(RunIntegrityError):
        import_run(dst, tar)


def test_expanded_archive_is_bounded_even_when_compressed_small(tmp_path, monkeypatch):
    archive = tmp_path / "oversized.tar.gz"
    archive.write_bytes(gzip.compress(b"x" * 20_000))
    monkeypatch.setattr(run_store, "MAX_RUN_IMPORT_BYTES", 10_000)
    store = RunStore(tmp_path / "runs").for_owner("a")
    with pytest.raises(RunIntegrityError):
        import_run(store, archive)
    assert store.list_ids() == []
    assert list(store.root.iterdir()) == []


@pytest.mark.parametrize(
    "member_kind", ["symlink", "hardlink", "traversal", "duplicate", "extra", "missing"]
)
def test_import_rejects_unsafe_or_ambiguous_layout(tmp_path, member_kind):
    src = RunStore(tmp_path / "src")
    rid = _write(src)
    archive = tmp_path / "invalid.tar.gz"
    with tarfile.open(archive, "w:gz") as tar:
        if member_kind != "missing":
            tar.add(src.path(rid), arcname=rid)
        extra = tarfile.TarInfo(f"{rid}/params.json")
        if member_kind in ("symlink", "hardlink"):
            extra.type = (
                tarfile.SYMTYPE if member_kind == "symlink" else tarfile.LNKTYPE
            )
            extra.linkname = "../../outside"
            tar.addfile(extra)
        else:
            if member_kind == "traversal":
                extra.name = f"{rid}/../outside"
            elif member_kind == "extra":
                extra.name = f"{rid}/owner.json"
            extra.size = 2
            tar.addfile(extra, io.BytesIO(b"{}"))
    dst = RunStore(tmp_path / "dst").for_owner("a")
    with pytest.raises(RunIntegrityError):
        import_run(dst, archive)
    assert dst.list_ids() == []
    assert list(dst.root.iterdir()) == []


def test_import_cannot_override_authoritative_snapshot_fields(tmp_path):
    src = RunStore(tmp_path / "src")
    rid = _write(src)
    result = src.path(rid) / "result.json"
    result.write_text(
        json.dumps({**json.loads(result.read_text()), "meta": {"run_id": "spoofed"}})
    )
    archive = export_run(src, rid, tmp_path)
    dst = RunStore(tmp_path / "dst")
    with pytest.raises(RunIntegrityError):
        import_run(dst, archive)
    assert dst.list_ids() == []


def test_concurrent_import_is_atomic_and_idempotent(tmp_path):
    src = RunStore(tmp_path / "src")
    rid = _write(src)
    archive = export_run(src, rid, tmp_path)

    def upload(_):
        return import_run(RunStore(tmp_path / "dst").for_owner("a"), archive)

    with ThreadPoolExecutor(max_workers=4) as pool:
        assert list(pool.map(upload, range(8))) == [rid] * 8
    dst = RunStore(tmp_path / "dst").for_owner("a")
    assert dst.read(rid)["meta"]["run_id"] == rid
    assert [p.name for p in dst.root.iterdir()] == [rid]

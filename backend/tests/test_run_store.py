from hashlib import sha256
from concurrent.futures import ThreadPoolExecutor

import pytest

from backend.backtesting.engine import run_backtest
from backend.backtesting.run_config import RunInputs
from backend.backtesting.run_snapshot import assemble_snapshot
from backend.backtesting.run_store import RunStore
from backend.backtesting.serialize import result_to_dict
from backend.tests._backtesting_fixtures import BuyAndHold, canonical_frame


def _snap():
    blob = result_to_dict(
        run_backtest(
            frame=canonical_frame(), strategy=BuyAndHold(), starting_cash=1e4, seed=0
        )
    )
    return assemble_snapshot(
        blob,
        RunInputs(
            code="def on_bar(ctx):\n    pass\n",
            params={},
            data_version="v1",
            seed=0,
            starting_cash=1e4,
        ),
    )


def test_write_creates_specced_files(tmp_path):
    store = RunStore(tmp_path)
    rid = store.write(_snap())
    d = store.path(rid)
    for name in (
        "meta.json",
        "strategy.py",
        "params.json",
        "config.json",
        "metrics.json",
        "log.jsonl",
        "bars.parquet",
        "result.json",
    ):
        assert (d / name).exists(), name


def test_write_is_idempotent_dedup(tmp_path):
    store = RunStore(tmp_path)
    rid1 = store.write(_snap())
    rid2 = store.write(_snap())
    assert rid1 == rid2
    assert store.list_ids() == [rid1]


def test_read_round_trips(tmp_path):
    store = RunStore(tmp_path)
    snap = _snap()
    rid = store.write(snap)
    blob = store.read(rid)
    assert blob["meta"]["run_id"] == rid
    assert blob["metrics"] == snap.metrics
    assert len(blob["bars"]) == len(snap.bars["data"])
    assert blob["bars"][0]["t"] == snap.bars["data"][0]["t"]
    assert blob["strategy_source"] == {
        "sha256": sha256(snap.strategy_code.encode()).hexdigest(),
        "ast_hash": snap.meta["ast_hash"],
    }


def test_read_reports_missing_or_unparseable_source_without_hiding_results(tmp_path):
    store = RunStore(tmp_path)
    rid = store.write(_snap())
    source = store.path(rid) / "strategy.py"
    source.unlink()
    assert store.read(rid)["strategy_source"] is None
    source.write_text("def invalid(")
    blob = store.read(rid)
    assert blob["strategy_source"]["ast_hash"] is None
    assert blob["strategy_source"]["sha256"] == sha256(source.read_bytes()).hexdigest()
    assert blob["metrics"] == _snap().metrics


def test_read_missing_raises(tmp_path):
    import pytest

    with pytest.raises(FileNotFoundError):
        RunStore(tmp_path).read("deadbeef")


def test_owner_namespaces_leave_legacy_and_other_accounts_untouched(tmp_path):
    legacy = RunStore(tmp_path)
    snap = _snap()
    rid = legacy.write(snap)
    a = legacy.for_owner("a")
    b = legacy.for_owner("b")
    assert a.list_ids() == b.list_ids() == []
    with pytest.raises(FileNotFoundError):
        a.read(rid)
    a.write(snap)
    assert b.exists(rid) is False
    b.write(snap)
    assert RunStore(tmp_path).for_owner("a").list_ids() == [rid]
    assert RunStore(tmp_path).for_owner("b").list_ids() == [rid]
    assert legacy.exists(rid)
    assert a.path(rid) != b.path(rid) != legacy.path(rid)


@pytest.mark.parametrize(
    "run_id", ["../outside", "..", "/absolute", "a" * 63, "A" * 64]
)
def test_invalid_run_paths_are_not_accessible(tmp_path, run_id):
    store = RunStore(tmp_path).for_owner("a")
    assert store.exists(run_id) is False
    with pytest.raises(FileNotFoundError):
        store.read(run_id)


def test_owner_ids_cannot_escape_namespace(tmp_path):
    store = RunStore(tmp_path).for_owner("../../outside")
    assert store.root.parent == tmp_path / "owners"
    with pytest.raises(ValueError):
        RunStore(tmp_path).for_owner("")


def test_concurrent_identical_snapshot_writes_are_idempotent(tmp_path):
    snap = _snap()

    def write(_):
        return RunStore(tmp_path).for_owner("a").write(snap)

    with ThreadPoolExecutor(max_workers=8) as pool:
        assert list(pool.map(write, range(16))) == [snap.run_id] * 16
    store = RunStore(tmp_path).for_owner("a")
    assert store.list_ids() == [snap.run_id]
    assert store.read(snap.run_id)["metrics"] == snap.metrics
    assert [p.name for p in store.root.iterdir()] == [snap.run_id]

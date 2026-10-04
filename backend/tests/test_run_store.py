from hashlib import sha256

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

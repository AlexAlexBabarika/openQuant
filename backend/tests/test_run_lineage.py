from copy import deepcopy

from backend.backtesting.run_config import costs_to_dict
from backend.backtesting.run_diff import diff_runs
from backend.backtesting.run_lineage import compare_lineage
from backend.backtesting.version import ENGINE_VERSION


def _blob():
    return {
        "strategy_source": {"sha256": "source-a", "ast_hash": "ast-a"},
        "meta": {
            "ast_hash": "ast-a",
            "engine_version": ENGINE_VERSION,
            "seed": 0,
            "data_version": "yfinance:AAPL:6mo:1d:" + "a" * 64,
        },
        "params": {},
        "config": {
            "starting_cash": 10000,
            "costs": costs_to_dict(None),
            "universe": None,
            "constraints": None,
        },
        "bars": [{"t": 1}],
    }


def _rows(lineage):
    return {r["path"]: r for r in lineage["rows"]}


def test_observed_changes_and_single_symbol_context():
    a = _blob()
    b = deepcopy(a)
    b["params"] = {"window": 20}
    b["meta"]["data_version"] = "binance:BTCUSDT:1y:1h:" + "b" * 64
    b["meta"]["seed"] = 12
    b["config"]["costs"]["commission"] = {"model": "FlatCommission", "fee": 1}
    rows = _rows(compare_lineage(a, b))
    for field in (
        "params",
        "dataset.provider",
        "dataset.symbol",
        "dataset.period",
        "dataset.interval",
        "dataset.sha256",
        "meta.seed",
        "config.costs",
    ):
        assert rows[field]["status"] == "changed"
    assert rows["dataset.provider"]["a"]["value"] == "yfinance"
    assert rows["dataset.sha256"]["b"]["value"] == "b" * 64
    assert rows["config.starting_cash"]["status"] == "unchanged"


def test_missing_metadata_is_not_reported_as_unchanged_or_inferred():
    lineage = compare_lineage({}, {})
    assert all(row["status"] == "unavailable" for row in lineage["rows"])
    assert all(not row["a"]["available"] for row in lineage["rows"])
    assert any(
        "Original strategy source is unavailable" in warning
        for warning in lineage["limitations"]["a"]
    )
    assert any(
        "dataset cannot be replayed" in warning
        for warning in lineage["limitations"]["a"]
    )
    a, b = _blob(), _blob()
    del a["params"]
    row = _rows(compare_lineage(a, b))["params"]
    assert row["status"] == "unavailable"
    assert row["a"] == {"available": False, "value": None}
    assert row["b"] == {"available": True, "value": {}}


def test_zero_empty_parameters_and_explicit_no_portfolio_config_are_recorded():
    a = _blob()
    a["config"]["starting_cash"] = 0
    rows = _rows(compare_lineage(a, a))
    for field in (
        "params",
        "meta.seed",
        "config.starting_cash",
        "config.universe",
        "config.constraints",
    ):
        assert rows[field]["a"]["available"]
        assert rows[field]["status"] == "unchanged"


def test_portfolio_version_is_opaque_but_portfolio_configuration_is_observed():
    a, b = _blob(), _blob()
    for blob in (a, b):
        blob["meta"]["data_version"] = "historical-store-v7"
        blob["bars"] = {"AAPL": [{"t": 1}], "MSFT": [{"t": 1}, {"t": 2}]}
        blob["config"]["universe"] = {"memberships": [{"symbol": "AAPL"}]}
        blob["config"]["constraints"] = {"long_only": True}
    b["config"]["constraints"]["long_only"] = False
    lineage = compare_lineage(a, b)
    rows = _rows(lineage)
    assert rows["dataset.provider"]["status"] == "unavailable"
    assert rows["snapshot.bar_count"]["a"]["value"] == 3
    assert rows["config.constraints"]["status"] == "changed"
    assert rows["config.universe"]["a"]["available"]
    assert any(
        "none are inferred" in warning for warning in lineage["limitations"]["a"]
    )


def test_hash_like_strings_without_loader_format_do_not_invent_provenance():
    a = _blob()
    a["meta"]["data_version"] = "provider:symbol:period:interval:not-a-data-hash"
    assert _rows(compare_lineage(a, a))["dataset.provider"]["status"] == "unavailable"
    a["meta"]["data_version"] = "yfinance::6mo:1d:" + "a" * 64
    a["meta"]["engine_version"] = ""
    rows = _rows(compare_lineage(a, a))
    assert rows["dataset.provider"]["status"] == "unavailable"
    assert rows["meta.engine_version"]["status"] == "unavailable"


def test_formatting_change_is_distinct_from_recorded_ast_change():
    a, b = _blob(), _blob()
    b["strategy_source"]["sha256"] = "source-b"
    rows = _rows(compare_lineage(a, b))
    assert rows["strategy_source.sha256"]["status"] == "changed"
    assert rows["meta.ast_hash"]["status"] == "unchanged"
    assert diff_runs(a, b)["inputs_diff"] == []


def test_stale_engine_source_mismatch_and_nondefault_costs_limit_replay():
    a = _blob()
    a["meta"]["engine_version"] = "historical-engine"
    a["strategy_source"]["ast_hash"] = "modified-source"
    a["config"]["costs"] = {"commission": {"fee": 2}}
    warnings = compare_lineage(a, _blob())["limitations"]["a"]
    assert any(
        "does not restore the historical engine" in warning for warning in warnings
    )
    assert any("original code is not verified" in warning for warning in warnings)
    assert any(
        "non-default costs will not be replayed" in warning for warning in warnings
    )


def test_complete_current_snapshot_has_no_run_specific_warnings_or_mutations():
    a = _blob()
    before = deepcopy(a)
    lineage = compare_lineage(a, a)
    assert lineage["limitations"] == {"a": [], "b": []}
    assert a == before


def test_invalid_stored_source_is_not_claimed_replayable():
    a = _blob()
    a["strategy_source"]["ast_hash"] = None
    assert any(
        "cannot be parsed" in warning
        for warning in compare_lineage(a, a)["limitations"]["a"]
    )

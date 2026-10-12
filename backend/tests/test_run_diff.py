from backend.backtesting.run_diff import diff_runs


def _blob(n, total_return, equity, trades):
    return {
        "meta": {
            "engine_version": "1.0.0",
            "data_version": "v1",
            "ast_hash": "h",
            "seed": 0,
        },
        "params": {"n": n},
        "config": {"starting_cash": 1e5},
        "metrics": {"total_return": total_return, "sharpe": 1.0},
        "equity": equity,
        "trades": trades,
    }


def _eq(t, v):
    return {"t": t, "value": v}


def _trade(sym, entry_t, direction, pnl):
    return {
        "symbol": sym,
        "entry_time": entry_t,
        "direction": direction,
        "exit_time": "x",
        "exit_price": 1.0,
        "pnl": pnl,
    }


def test_inputs_diff_shows_only_changed_param():
    a = _blob(10, 0.1, [], [])
    b = _blob(20, 0.1, [], [])
    diff = diff_runs(a, b)
    paths = {row["path"]: (row["a"], row["b"]) for row in diff["inputs_diff"]}
    assert paths == {"params.n": (10, 20)}


def test_metrics_diff_sorted_by_abs_delta():
    a = _blob(10, 0.10, [], [])
    b = _blob(10, 0.40, [], [])
    diff = diff_runs(a, b)
    top = diff["metrics_diff"][0]
    assert top["metric"] == "total_return"
    assert round(top["delta"], 2) == 0.30


def test_equity_overlay_aligns_and_residuals():
    a = _blob(10, 0.1, [_eq(1, 100.0), _eq(2, 110.0)], [])
    b = _blob(10, 0.1, [_eq(1, 100.0), _eq(2, 120.0)], [])
    overlay = diff_runs(a, b)["equity_overlay"]
    assert overlay["residual"] == [{"t": 1, "value": 0.0}, {"t": 2, "value": 10.0}]


def test_trades_diff_classifies():
    a = _blob(
        10,
        0.1,
        [],
        [_trade("AAPL", "t1", "buy", 5.0), _trade("MSFT", "t2", "buy", 1.0)],
    )
    b = _blob(
        10,
        0.1,
        [],
        [_trade("AAPL", "t1", "buy", 7.0), _trade("GOOG", "t3", "buy", 2.0)],
    )
    td = diff_runs(a, b)["trades_diff"]
    assert [c["key"] for c in td["changed"]] == [["AAPL", "t1", "buy"]]
    assert [c["key"] for c in td["only_in_a"]] == [["MSFT", "t2", "buy"]]
    assert [c["key"] for c in td["only_in_b"]] == [["GOOG", "t3", "buy"]]


def test_lineage_compares_recorded_quality_range_holdout_and_unknown_config():
    a, b = _blob(10, 0.1, [], []), _blob(10, 0.1, [], [])
    a["meta"]["data_quality"] = {"status": "ready", "missing_bars": 0}
    b["meta"]["data_quality"] = {"status": "warning", "missing_bars": 2}
    for blob in (a, b):
        blob["config"]["date_range"] = {"start": 1, "end": 20}
        blob["config"]["holdout"] = {"start": 15, "end": 20}
    b["config"]["custom_assumption"] = False
    rows = {r["path"]: r for r in diff_runs(a, b)["lineage"]["rows"]}
    assert rows["meta.data_quality"]["status"] == "changed"
    assert rows["meta.data_quality"]["category"] == "Dataset & quality"
    assert rows["config.date_range"]["status"] == "unchanged"
    assert rows["config.holdout"]["category"] == "Date range & holdout"
    assert rows["config.custom_assumption"]["status"] == "unavailable"
    assert rows["config.custom_assumption"]["b"] == {"available": True, "value": False}


def test_missing_context_is_unavailable_not_inferred_from_equity_or_bars():
    a = _blob(10, 0.1, [_eq(1, 100), _eq(2, 110)], [])
    rows = {r["path"]: r for r in diff_runs(a, a)["lineage"]["rows"]}
    for path in ("meta.data_quality", "config.date_range", "config.holdout"):
        assert rows[path]["status"] == "unavailable"
        assert rows[path]["a"] == {"available": False, "value": None}


def test_missing_metrics_and_unknown_structured_metrics_remain_visible():
    a, b = _blob(10, 0.1, [], []), _blob(10, 0.1, [], [])
    a["metrics"]["max_drawdown"] = -0.2
    a["metrics"]["turnover"] = 0
    b["metrics"]["turnover"] = 1.2
    a["metrics"]["custom"] = {"sample": 20}
    b["metrics"]["custom"] = {"sample": 30}
    a["metrics"]["invalid"] = float("nan")
    b["metrics"]["flag"] = True
    rows = {r["metric"]: r for r in diff_runs(a, b)["metrics_diff"]}
    assert rows["max_drawdown"]["status"] == "unavailable"
    assert rows["max_drawdown"]["delta"] is None
    assert rows["pct_time_in_market"]["status"] == "unavailable"
    assert rows["turnover"]["delta"] == 1.2
    assert rows["custom"]["a"] == {"sample": 20}
    assert rows["custom"]["delta"] is None
    assert rows["invalid"]["a"] is None
    assert rows["flag"]["delta"] is None
    assert rows["trade_count"]["a"] == 0


def test_equity_keeps_unmatched_path_and_reports_residual_coverage():
    a = _blob(10, 0.1, [_eq(1, 100), _eq(2, 110)], [])
    b = _blob(10, 0.1, [_eq(2, 120), _eq(3, 90)], [])
    overlay = diff_runs(a, b)["equity_overlay"]
    assert overlay["a"] == a["equity"]
    assert overlay["b"] == b["equity"]
    assert overlay["residual"] == [_eq(2, 10)]
    assert overlay["alignment"] == {"common": 1, "only_a": 1, "only_b": 1}
    del b["equity"]
    overlay = diff_runs(a, b)["equity_overlay"]
    assert overlay["available"] == {"a": True, "b": False}
    assert overlay["residual"] == []


def test_duplicate_trade_keys_are_not_collapsed_and_unknown_fields_are_compared():
    first = _trade("AAPL", "t1", "buy", 1.0)
    second = {**first, "pnl": 2.0, "custom_fill": "auction"}
    a = _blob(10, 0.1, [], [first, second])
    b = _blob(10, 0.1, [], [first, {**second, "custom_fill": "close"}, second])
    td = diff_runs(a, b)["trades_diff"]
    assert td["count"] == {"a": 2, "b": 3}
    assert td["changed"][0]["occurrence"] == 2
    assert td["changed"][0]["fields"]["custom_fill"]["status"] == "changed"
    assert td["only_in_b"][0]["occurrence"] == 3
    assert td["unavailable"][0]["occurrence"] == 1
    assert td["unavailable"][0]["fields"]["quantity"]["status"] == "unavailable"


def test_missing_trade_path_is_not_treated_as_an_empty_recorded_path():
    a = _blob(10, 0.1, [], [_trade(None, "t1", "buy", 0)])
    b = _blob(10, 0.1, [], [])
    del b["trades"]
    td = diff_runs(a, b)["trades_diff"]
    assert td["available"] == {"a": True, "b": False}
    assert td["count"] == {"a": 1, "b": None}
    assert td["only_in_a"] == []
    assert td["unchanged"] == []


def test_diff_does_not_mutate_snapshots():
    from copy import deepcopy

    a, b = _blob(10, 0.1, [], []), _blob(20, 0.2, [], [])
    before = deepcopy((a, b))
    diff_runs(a, b)
    assert (a, b) == before

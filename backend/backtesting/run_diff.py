"""Pure pairwise diff between two run blobs (as returned by RunStore.read)."""

from __future__ import annotations

from backend.backtesting.run_id import run_status
from backend.backtesting.run_lineage import compare_lineage

_TRADE_FIELDS = ("entry_price", "exit_price", "exit_time", "pnl", "pnl_pct", "quantity")


def _flatten(prefix: str, value: object, out: dict) -> None:
    if isinstance(value, dict):
        for k, v in value.items():
            _flatten(f"{prefix}.{k}" if prefix else str(k), v, out)
    else:
        out[prefix] = value


def _inputs_diff(a: dict, b: dict) -> list[dict]:
    fa: dict = {}
    fb: dict = {}
    for blob, dest in ((a, fa), (b, fb)):
        _flatten("params", blob.get("params", {}), dest)
        _flatten("config", blob.get("config", {}), dest)
        for key in ("data_version", "engine_version", "ast_hash", "seed"):
            dest[key] = blob.get("meta", {}).get(key)
    rows = [
        {"path": path, "a": fa.get(path), "b": fb.get(path)}
        for path in sorted(set(fa) | set(fb))
        if fa.get(path) != fb.get(path)
    ]
    return rows


def _metrics_diff(a: dict, b: dict) -> list[dict]:
    ma, mb = a.get("metrics", {}), b.get("metrics", {})
    rows = []
    for metric in sorted(set(ma) | set(mb)):
        va, vb = ma.get(metric), mb.get(metric)
        delta = (
            (vb - va)
            if isinstance(va, (int, float)) and isinstance(vb, (int, float))
            else None
        )
        rows.append(
            {
                "metric": metric,
                "a": va,
                "b": vb,
                "delta": delta,
                "abs_delta": abs(delta) if delta is not None else None,
            }
        )
    rows.sort(key=lambda r: (r["abs_delta"] is None, -(r["abs_delta"] or 0.0)))
    return rows


def _equity_overlay(a: dict, b: dict) -> dict:
    ea = {p["t"]: p["value"] for p in a.get("equity", [])}
    eb = {p["t"]: p["value"] for p in b.get("equity", [])}
    common = sorted(set(ea) & set(eb))
    return {
        "a": [{"t": t, "value": ea[t]} for t in common],
        "b": [{"t": t, "value": eb[t]} for t in common],
        "residual": [{"t": t, "value": eb[t] - ea[t]} for t in common],
    }


def _trade_key(t: dict) -> tuple:
    return (t.get("symbol"), t.get("entry_time"), t.get("direction"))


def _trades_diff(a: dict, b: dict) -> dict:
    ta = {_trade_key(t): t for t in a.get("trades", [])}
    tb = {_trade_key(t): t for t in b.get("trades", [])}
    common_keys = sorted(set(ta) & set(tb))
    changed: list[dict] = []
    unchanged: list[dict] = []
    for key in common_keys:
        deltas = {
            f: {"a": ta[key].get(f), "b": tb[key].get(f)}
            for f in _TRADE_FIELDS
            if ta[key].get(f) != tb[key].get(f)
        }
        entry = {"key": list(key), "fields": deltas}
        (changed if deltas else unchanged).append(entry)
    return {
        "changed": changed,
        "unchanged": unchanged,
        "only_in_a": [
            {"key": list(k), "trade": ta[k]} for k in sorted(set(ta) - set(tb))
        ],
        "only_in_b": [
            {"key": list(k), "trade": tb[k]} for k in sorted(set(tb) - set(ta))
        ],
    }


def diff_runs(a: dict, b: dict) -> dict:
    return {
        "lineage": compare_lineage(a, b),
        "inputs_diff": _inputs_diff(a, b),
        "metrics_diff": _metrics_diff(a, b),
        "equity_overlay": _equity_overlay(a, b),
        "trades_diff": _trades_diff(a, b),
        "status": {
            "a": run_status(a.get("meta", {})),
            "b": run_status(b.get("meta", {})),
        },
    }

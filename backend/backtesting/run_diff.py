"""Pure pairwise diff between two run blobs (as returned by RunStore.read)."""

from __future__ import annotations

import math

from backend.backtesting.run_id import run_status
from backend.backtesting.run_lineage import compare_lineage

_CONTEXT_FIELDS = (
    ("meta.data_quality", "Recorded data quality", "Dataset & quality"),
    ("config.date_range", "Recorded date range", "Date range & holdout"),
    ("config.holdout", "Recorded holdout", "Date range & holdout"),
)
_METRICS = {
    "max_drawdown": ("Maximum drawdown", "Drawdown"),
    "max_drawdown_length": ("Drawdown length", "Drawdown"),
    "avg_drawdown": ("Average drawdown", "Drawdown"),
    "time_underwater": ("Time underwater", "Drawdown"),
    "pct_time_in_market": ("Time in market", "Exposure"),
    "avg_position_pct": ("Average position fraction", "Exposure"),
    "max_leverage": ("Peak leverage", "Exposure"),
    "turnover": ("Turnover (recorded units)", "Turnover"),
    "trade_count": ("Recorded trade count", "Trades"),
}
_TRADE_FIELDS = ("entry_price", "exit_price", "exit_time", "pnl", "pnl_pct", "quantity")


def _category(path: str) -> str:
    if path.startswith(("strategy_source.", "meta.ast_hash", "params")):
        return "Strategy & parameters"
    if path.startswith(("dataset.", "snapshot.", "meta.data_")):
        return "Dataset & quality"
    if path.startswith(("config.date_range", "config.holdout")):
        return "Date range & holdout"
    if path.startswith(("config.costs", "config.starting_cash")):
        return "Costs & capital"
    if path.startswith(("config.universe", "config.constraints")):
        return "Portfolio context"
    if path in ("meta.engine_version", "meta.seed"):
        return "Runtime"
    return "Other recorded fields"


def _availability(a: object, b: object) -> dict:
    available = {"a": a is not None, "b": b is not None}
    return {
        "available": available,
        "status": "unavailable"
        if not all(available.values())
        else "unchanged"
        if a == b
        else "changed",
    }


def _flatten(prefix: str, value: object, out: dict) -> None:
    if isinstance(value, dict) and value:
        for k, v in value.items():
            _flatten(f"{prefix}.{k}" if prefix else str(k), v, out)
    else:
        out[prefix] = value


def _recorded_inputs(blob: dict) -> dict:
    out: dict = {}
    for key in ("params", "config"):
        if key in blob:
            _flatten(key, blob[key], out)
    for key in ("data_version", "engine_version", "ast_hash", "seed"):
        if key in blob.get("meta", {}):
            out[key] = blob["meta"][key]
    return out


def _comparison_lineage(a: dict, b: dict) -> dict:
    lineage = compare_lineage(a, b)
    rows = lineage["rows"]
    for row in rows:
        row["category"] = _category(row["path"])
    known = [row["path"] for row in rows]
    config_a: dict = {}
    config_b: dict = {}
    for blob, dest in ((a, config_a), (b, config_b)):
        if "config" in blob:
            _flatten("config", blob["config"], dest)
        for path, _, _ in _CONTEXT_FIELDS:
            root, key = path.split(".")
            dest[path] = blob.get(root, {}).get(key)
    fields = list(_CONTEXT_FIELDS)
    for path in sorted(set(config_a) | set(config_b)):
        if any(path == k or path.startswith(k + ".") for k in known):
            continue
        if any(path == k or path.startswith(k + ".") for k, _, _ in fields):
            continue
        fields.append((path, path, _category(path)))
    for path, label, category in fields:
        va, vb = config_a.get(path), config_b.get(path)
        state = _availability(va, vb)
        rows.append(
            {
                "path": path,
                "label": label,
                "category": category,
                "a": {"available": state["available"]["a"], "value": va},
                "b": {"available": state["available"]["b"], "value": vb},
                "status": state["status"],
            }
        )
    return lineage


def _inputs_diff(a: dict, b: dict) -> list[dict]:
    fa, fb = _recorded_inputs(a), _recorded_inputs(b)
    rows = [
        {
            "path": path,
            "a": fa.get(path),
            "b": fb.get(path),
            "category": _category(path if "." in path else "meta." + path),
            **_availability(fa.get(path), fb.get(path)),
        }
        for path in sorted(set(fa) | set(fb))
        if fa.get(path) != fb.get(path)
    ]
    return rows


def _metrics_diff(a: dict, b: dict) -> list[dict]:
    ma, mb = dict(a.get("metrics", {})), dict(b.get("metrics", {}))
    for blob, metrics in ((a, ma), (b, mb)):
        if "trade_count" not in metrics and isinstance(blob.get("trades"), list):
            metrics["trade_count"] = len(blob["trades"])
    rows = []
    for metric in sorted(set(ma) | set(mb) | set(_METRICS)):
        va, vb = ma.get(metric), mb.get(metric)
        va = None if isinstance(va, float) and not math.isfinite(va) else va
        vb = None if isinstance(vb, float) and not math.isfinite(vb) else vb
        delta = (
            (vb - va)
            if isinstance(va, (int, float))
            and not isinstance(va, bool)
            and isinstance(vb, (int, float))
            and not isinstance(vb, bool)
            else None
        )
        label, category = _METRICS.get(
            metric,
            (metric.replace("_", " ").capitalize(), "Other observed metrics"),
        )
        rows.append(
            {
                "metric": metric,
                "a": va,
                "b": vb,
                "delta": delta,
                "abs_delta": abs(delta) if delta is not None else None,
                "label": label,
                "category": category,
                **_availability(va, vb),
            }
        )
    rows.sort(key=lambda r: (r["abs_delta"] is None, -(r["abs_delta"] or 0.0)))
    return rows


def _equity_overlay(a: dict, b: dict) -> dict:
    ea = {p["t"]: p["value"] for p in a.get("equity") or []}
    eb = {p["t"]: p["value"] for p in b.get("equity") or []}
    common = sorted(set(ea) & set(eb))
    return {
        "a": [{"t": t, "value": ea[t]} for t in sorted(ea)],
        "b": [{"t": t, "value": eb[t]} for t in sorted(eb)],
        "residual": [{"t": t, "value": eb[t] - ea[t]} for t in common],
        "available": {
            "a": isinstance(a.get("equity"), list),
            "b": isinstance(b.get("equity"), list),
        },
        "alignment": {
            "common": len(common),
            "only_a": len(set(ea) - set(eb)),
            "only_b": len(set(eb) - set(ea)),
        },
    }


def _trade_key(t: dict) -> tuple:
    return (t.get("symbol"), t.get("entry_time"), t.get("direction"))


def _trades_diff(a: dict, b: dict) -> dict:
    def indexed(blob: dict) -> dict:
        counts: dict = {}
        out: dict = {}
        for trade in blob.get("trades") or []:
            key = _trade_key(trade)
            counts[key] = counts.get(key, 0) + 1
            out[(*key, counts[key])] = trade
        return out

    ta, tb = indexed(a), indexed(b)
    available = {
        "a": isinstance(a.get("trades"), list),
        "b": isinstance(b.get("trades"), list),
    }
    comparable = all(available.values())
    common_keys = sorted(set(ta) & set(tb), key=str) if comparable else []
    changed: list[dict] = []
    unchanged: list[dict] = []
    unavailable: list[dict] = []
    for key in common_keys:
        deltas = {
            f: {
                "a": ta[key].get(f),
                "b": tb[key].get(f),
                **_availability(ta[key].get(f), tb[key].get(f)),
            }
            for f in sorted(set(ta[key]) | set(tb[key]) | set(_TRADE_FIELDS))
            if f not in ("symbol", "entry_time", "direction")
            and (
                ta[key].get(f) != tb[key].get(f)
                or ta[key].get(f) is None
                or tb[key].get(f) is None
            )
        }
        entry = {"key": list(key[:3]), "occurrence": key[3], "fields": deltas}
        target = (
            changed
            if any(field["status"] == "changed" for field in deltas.values())
            else unavailable
            if deltas
            else unchanged
        )
        target.append(entry)
    return {
        "changed": changed,
        "unchanged": unchanged,
        "unavailable": unavailable,
        "only_in_a": [
            {"key": list(k[:3]), "occurrence": k[3], "trade": ta[k]}
            for k in sorted(set(ta) - set(tb), key=str)
        ]
        if comparable
        else [],
        "only_in_b": [
            {"key": list(k[:3]), "occurrence": k[3], "trade": tb[k]}
            for k in sorted(set(tb) - set(ta), key=str)
        ]
        if comparable
        else [],
        "available": available,
        "count": {
            "a": len(ta) if available["a"] else None,
            "b": len(tb) if available["b"] else None,
        },
    }


def diff_runs(a: dict, b: dict) -> dict:
    return {
        "lineage": _comparison_lineage(a, b),
        "inputs_diff": _inputs_diff(a, b),
        "metrics_diff": _metrics_diff(a, b),
        "equity_overlay": _equity_overlay(a, b),
        "trades_diff": _trades_diff(a, b),
        "status": {
            "a": run_status(a.get("meta", {})),
            "b": run_status(b.get("meta", {})),
        },
    }

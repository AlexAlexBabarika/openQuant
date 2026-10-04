"""Observed input provenance, separate from numerical result differences."""

from __future__ import annotations

import re

from backend.backtesting.run_config import costs_to_dict
from backend.backtesting.run_id import run_status

_FIELDS = (
    ("strategy_source.sha256", "Stored source file SHA-256"),
    ("meta.ast_hash", "Recorded AST fingerprint"),
    ("params", "Resolved parameters"),
    ("config.costs", "Execution costs"),
    ("config.starting_cash", "Starting cash"),
    ("meta.data_version", "Dataset version"),
    ("dataset.provider", "Provider"),
    ("dataset.symbol", "Single-symbol instrument"),
    ("dataset.period", "Requested period"),
    ("dataset.interval", "Requested interval"),
    ("dataset.sha256", "Recorded input data SHA-256"),
    ("snapshot.bar_count", "Stored bar count"),
    ("meta.engine_version", "Engine version"),
    ("meta.seed", "Random seed"),
    ("config.universe", "Portfolio universe"),
    ("config.constraints", "Portfolio constraints"),
)


def _context(blob: dict) -> dict:
    version = blob.get("meta", {}).get("data_version")
    parts = version.split(":") if isinstance(version, str) else []
    dataset = {}
    # Only the single-symbol loader's documented version format carries context.
    if len(parts) == 5 and all(parts[:-1]) and re.fullmatch(r"[0-9a-f]{64}", parts[-1]):
        dataset = dict(
            zip(("provider", "symbol", "period", "interval", "sha256"), parts)
        )
    bars = blob.get("bars")
    count = (
        sum(len(series) for series in bars.values())
        if isinstance(bars, dict)
        else len(bars)
        if isinstance(bars, list)
        else None
    )
    return {**blob, "dataset": dataset, "snapshot": {"bar_count": count}}


def _cell(blob: dict, path: str) -> dict:
    value: object = blob
    for key in path.split("."):
        if not isinstance(value, dict) or key not in value:
            return {"available": False, "value": None}
        value = value[key]
    nullable = path in ("config.universe", "config.constraints")
    return {
        "available": nullable or (value is not None and value != ""),
        "value": value,
    }


def _limitations(blob: dict) -> list[str]:
    warnings = []
    source = blob.get("strategy_source") or {}
    if not source.get("sha256"):
        warnings.append(
            "Original strategy source is unavailable; an AST fingerprint cannot recover it."
        )
    elif not source.get("ast_hash"):
        warnings.append(
            "Stored strategy source cannot be parsed and cannot be replayed."
        )
    elif source["ast_hash"] != blob.get("meta", {}).get("ast_hash"):
        warnings.append(
            "Stored source does not match the recorded AST fingerprint; the original code is not verified."
        )
    if not blob["snapshot"]["bar_count"]:
        warnings.append(
            "Stored bars are unavailable or empty; the original dataset cannot be replayed."
        )
    if not blob["dataset"]:
        warnings.append(
            "Provider, instrument, period and interval are unavailable in this dataset version; none are inferred."
        )
    for path, label in (
        ("meta.data_version", "Dataset version"),
        ("params", "Resolved parameters"),
        ("config.costs", "Execution costs"),
        ("config.starting_cash", "Starting cash"),
        ("meta.seed", "Random seed"),
        ("meta.engine_version", "Engine version"),
    ):
        if not _cell(blob, path)["available"]:
            warnings.append(
                f"{label} was not recorded; original replay assumptions cannot be verified."
            )
    status = run_status(blob.get("meta", {}))
    if _cell(blob, "meta.engine_version")["available"] and status["stale"]:
        warnings.append(
            f"Recorded engine {status['recorded']} differs from current engine {status['current']}; rerun does not restore the historical engine."
        )
    costs = _cell(blob, "config.costs")
    if costs["available"] and costs["value"] != costs_to_dict(None):
        warnings.append(
            "Rerun currently uses default execution costs; these recorded non-default costs will not be replayed."
        )
    return warnings


def compare_lineage(a: dict, b: dict) -> dict:
    a, b = _context(a), _context(b)
    rows = []
    for path, label in _FIELDS:
        ca, cb = _cell(a, path), _cell(b, path)
        status = (
            "unavailable"
            if not ca["available"] or not cb["available"]
            else "unchanged"
            if ca["value"] == cb["value"]
            else "changed"
        )
        rows.append({"path": path, "label": label, "a": ca, "b": cb, "status": status})
    return {"rows": rows, "limitations": {"a": _limitations(a), "b": _limitations(b)}}

"""Read-only inspection of canonical OHLCV frames, not provider certification."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, TypedDict

import polars as pl

from backend.market.shared_config import (
    ALLOWED_INTERVALS,
    TWELVEDATA_INTERVAL_MAP,
    TWELVEDATA_NATIVE_INTERVALS,
)

EXAMPLE_LIMIT = 5
_PRICES = ("open", "high", "low", "close")
_NUMERIC = (*_PRICES, "volume")
_REQUIRED = ("timestamp", *_NUMERIC)


class DataQualityIssue(TypedDict):
    code: str
    message: str
    column: str | None
    count: int
    rows: list[int]


class DataQualityProvenance(TypedDict):
    provider: str
    interval: str
    data_version: str
    row_count: int
    start: str | None
    end: str | None
    timestamp_timezone: str | None
    timestamp_unit: str | None
    nominal_interval_seconds: int | None
    calendar: Literal["unknown"]
    adjustment: Literal["unknown"]
    staleness: Literal["not_assessed"]
    example_limit: int


class DataQualityReport(TypedDict):
    errors: list[DataQualityIssue]
    warnings: list[DataQualityIssue]
    provenance: DataQualityProvenance


def _interval_seconds(interval: str) -> int | None:
    if interval not in ALLOWED_INTERVALS | TWELVEDATA_NATIVE_INTERVALS:
        return None
    native = TWELVEDATA_INTERVAL_MAP.get(interval, interval)
    for suffix, seconds in (("min", 60), ("h", 3600), ("day", 86400), ("week", 604800)):
        if native.endswith(suffix) and native[: -len(suffix)].isdigit():
            return int(native[: -len(suffix)]) * seconds
    return None


def inspect_frame(
    frame: pl.DataFrame, *, provider: str, interval: str, data_version: str
) -> DataQualityReport:
    """Return deterministic JSON-safe diagnostics without sorting or repairing.

    Any ``errors`` block execution; ``warnings`` do not. Counts are exact,
    while ``rows`` contains at most five zero-based input row indices. Schema
    and limitation issues have count=1 and no row examples. Inspect before
    normalization/sorting: this cannot detect values already repaired upstream.
    """
    errors: list[DataQualityIssue] = []
    warnings: list[DataQualityIssue] = []

    def add(
        target: list[DataQualityIssue],
        code: str,
        message: str,
        column: str | None = None,
        mask: pl.Series | None = None,
    ) -> None:
        count = 1 if mask is None else int(mask.fill_null(False).sum())
        if count:
            target.append(
                {
                    "code": code,
                    "message": message,
                    "column": column,
                    "count": count,
                    "rows": []
                    if mask is None
                    else mask.fill_null(False).arg_true().head(EXAMPLE_LIMIT).to_list(),
                }
            )

    seconds = _interval_seconds(interval)
    provenance: DataQualityProvenance = {
        "provider": provider,
        "interval": interval,
        "data_version": data_version,
        "row_count": frame.height,
        "start": None,
        "end": None,
        "timestamp_timezone": None,
        "timestamp_unit": None,
        "nominal_interval_seconds": seconds,
        "calendar": "unknown",
        "adjustment": "unknown",
        "staleness": "not_assessed",
        "example_limit": EXAMPLE_LIMIT,
    }
    add(
        warnings,
        "calendar_unknown",
        "No provider/exchange calendar was supplied; elapsed gaps do not establish missing bars.",
    )
    add(
        warnings,
        "adjustment_unknown",
        "Split/dividend adjustment assumptions are unknown; prices alone do not establish them.",
    )
    add(
        warnings,
        "staleness_not_assessed",
        "Freshness is not assessed without a requested end time and provider calendar; historical data is not inherently stale.",
    )
    if seconds is None:
        add(
            warnings,
            "interval_not_assessed",
            "No fixed duration is assessed for this interval; calendar-month bars and unsupported intervals are not approximated.",
        )
    if frame.is_empty():
        add(errors, "empty_frame", "At least one market bar is required.")
    for column in _REQUIRED:
        if column not in frame.columns:
            add(errors, "missing_column", "Required OHLCV column is missing.", column)
    if frame.is_empty():
        return {"errors": errors, "warnings": warnings, "provenance": provenance}

    if "timestamp" in frame.columns:
        timestamps = frame["timestamp"]
        dtype = timestamps.dtype
        if not isinstance(dtype, pl.Datetime):
            add(
                errors,
                "invalid_timestamp_type",
                "Timestamps must be timezone-aware Datetime values; strings, dates and epoch units must be normalized explicitly.",
                "timestamp",
            )
        else:
            provenance["timestamp_timezone"] = dtype.time_zone
            provenance["timestamp_unit"] = dtype.time_unit
            if dtype.time_zone is None:
                add(
                    errors,
                    "timestamp_timezone_unknown",
                    "Naive timestamps have no established timezone; normalize explicitly before inspection.",
                    "timestamp",
                )
            ticks = timestamps.cast(pl.Int64)
            valid = ticks.is_not_null()
            # Python/JSON consumers require years 1..9999. All Int64 ns dates fit.
            if dtype.time_unit != "ns":
                units = {"ms": 1000, "us": 1_000_000}[dtype.time_unit]
                epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
                lower = (
                    (datetime(1, 1, 1, tzinfo=timezone.utc) - epoch).days
                    * 86400
                    * units
                )
                upper = (
                    datetime(9999, 12, 31, tzinfo=timezone.utc) - epoch
                ).days * 86400 * units + 86400 * units
                valid = valid & (ticks >= lower) & (ticks < upper)
            add(
                errors,
                "invalid_timestamp",
                "Timestamp is null or outside the supported year range 1..9999.",
                "timestamp",
                ~valid.fill_null(False),
            )
            add(
                errors,
                "duplicate_timestamp",
                "Rows share a timestamp; all occurrences are counted.",
                "timestamp",
                valid & ticks.is_duplicated(),
            )
            # Compare native ticks, preserving nanosecond uniqueness and ordering.
            previous = ticks.shift(1)
            comparable = valid & valid.shift(1).fill_null(False)
            add(
                errors,
                "nonmonotonic_timestamp",
                "Timestamp precedes the immediately previous input bar.",
                "timestamp",
                comparable & (ticks < previous),
            )
            if not any(issue["column"] == "timestamp" for issue in errors):
                utc = timestamps.dt.convert_time_zone("UTC")
                provenance["start"] = utc.head(1).dt.to_string("%+").item()
                provenance["end"] = utc.tail(1).dt.to_string("%+").item()
                if seconds is not None:
                    units = {"ms": 1000, "us": 1_000_000, "ns": 1_000_000_000}[
                        dtype.time_unit
                    ]
                    # Widen before subtraction to avoid overflow or ns rounding.
                    elapsed = ticks.cast(pl.Int128).diff()
                    add(
                        warnings,
                        "elapsed_gap",
                        "Adjacent bars are more than one nominal interval apart; closures, weekends, holidays or provider coverage may explain this. Missing-bar counts are unknown.",
                        "timestamp",
                        elapsed > seconds * units,
                    )

    numeric: dict[str, pl.Series] = {}
    for column in _NUMERIC:
        if column not in frame.columns:
            continue
        if not frame[column].dtype.is_numeric():
            add(
                errors,
                "invalid_numeric_type",
                "OHLCV values must be numeric, not strings or booleans.",
                column,
            )
            continue
        values = frame[column]
        finite = values.is_not_null() & values.cast(pl.Float64).is_finite()
        add(
            errors,
            "invalid_volume" if column == "volume" else "invalid_price",
            "Volume must be finite and nonnegative."
            if column == "volume"
            else "Prices must be finite and strictly positive.",
            column,
            ~(finite & (values >= 0 if column == "volume" else values > 0)).fill_null(
                False
            ),
        )
        numeric[column] = values
    if all(column in numeric for column in _PRICES):
        o, h, low, c = (numeric[column] for column in _PRICES)
        finite_prices = pl.Series([True] * frame.height)
        for column in _PRICES:
            finite_prices = finite_prices & numeric[column].cast(
                pl.Float64
            ).is_finite().fill_null(False)
        add(
            errors,
            "inconsistent_ohlc",
            "High must contain open/close/low, and low must contain open/close.",
            None,
            finite_prices & ((h < low) | (h < o) | (h < c) | (low > o) | (low > c)),
        )
    return {"errors": errors, "warnings": warnings, "provenance": provenance}

"""Provider response validation before the shared normalizer can repair values."""

from datetime import date, datetime, timezone
import re
from typing import Any

import polars as pl

from backend.backtesting.data_quality import DataQualityReport, inspect_frame
from backend.market.models import OHLCVCandle
from backend.market.normalizer import normalize_column_name, normalize_rows

_NUMERIC = ("open", "high", "low", "close", "volume")


class RawProviderDataError(ValueError):
    """Safe diagnostics only: no upstream payload or credentials in the message."""

    def __init__(self, report: DataQualityReport) -> None:
        self.data_quality = report
        codes = sorted({issue["code"] for issue in report["errors"]})
        super().__init__("Raw provider data failed quality checks: " + ", ".join(codes))


def _timestamp(value: Any) -> datetime | None:
    try:
        if isinstance(value, str):
            # The canonical research pipeline is microsecond-based. Never truncate.
            fractions = re.findall(r"[.,](\d+)", value)
            if any(any(c != "0" for c in fraction[6:]) for fraction in fractions):
                return None
            value = datetime.fromisoformat(value.strip())
        elif isinstance(value, date) and not isinstance(value, datetime):
            value = datetime(value.year, value.month, value.day)
        if not isinstance(value, datetime) or getattr(value, "nanosecond", 0):
            return None
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    except (ValueError, TypeError, OverflowError):
        return None


def _number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        # Provider decimal strings are not locale-formatted CSV numbers.
        return float(value)
    except (ValueError, TypeError, OverflowError):
        return None


def inspect_raw_rows(
    rows: list[dict[str, Any]], *, provider: str, interval: str
) -> DataQualityReport:
    """Project raw aliases without defaults/repairs, then use canonical policy.

    Naive provider dates mean UTC here (Twelve Data is requested with UTC).
    Invalid/unrepresentable values become null *only in this diagnostic frame*;
    the original rows are neither mutated nor returned as usable candles.
    This unversioned raw report is not a cache/preview identity.
    """
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise ValueError("Raw provider response must contain a list of OHLCV rows.")
    mapped = []
    for row in rows:
        record = {}
        for key, value in row.items():
            name = normalize_column_name(key)
            if name is None:
                continue
            if name in record:
                raise ValueError("Raw provider row has ambiguous OHLCV aliases.")
            record[name] = value
        mapped.append(record)
    frame = pl.DataFrame(
        {
            "timestamp": pl.Series(
                [_timestamp(row.get("timestamp")) for row in mapped],
                dtype=pl.Datetime("us", "UTC"),
            ),
            **{
                column: pl.Series(
                    [_number(row.get(column)) for row in mapped], dtype=pl.Float64
                )
                for column in _NUMERIC
            },
        }
    )
    return inspect_frame(
        frame,
        provider=provider,
        interval=interval,
        data_version="raw-upstream:unversioned",
    )


def normalize_provider_rows(
    rows: list[dict[str, Any]], symbol: str, *, provider: str, interval: str
) -> list[OHLCVCandle]:
    if rows == []:
        return []
    report = inspect_raw_rows(rows, provider=provider, interval=interval)
    if report["errors"]:
        raise RawProviderDataError(report)
    return normalize_rows(rows, symbol)

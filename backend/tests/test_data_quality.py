"""Behavioral gating and conservative provenance for pre-run frame inspection."""

import json
from datetime import datetime, timedelta, timezone

import polars as pl
import pytest
from polars.testing import assert_frame_equal

from backend.backtesting.data_quality import EXAMPLE_LIMIT, inspect_frame
from backend.datastore.schema import BARS_SCHEMA
from backend.tests._backtesting_fixtures import canonical_frame


def inspect(frame, *, provider="fixture", interval="1d"):
    report = inspect_frame(
        frame, provider=provider, interval=interval, data_version="snapshot-v1"
    )
    assert json.loads(json.dumps(report, allow_nan=False)) == report
    return report


def codes(report, kind="errors"):
    return {issue["code"] for issue in report[kind]}


def issue(report, code, column=None, kind="errors"):
    return next(
        item
        for item in report[kind]
        if item["code"] == code and item["column"] == column
    )


def test_valid_fixture_is_read_only_deterministic_and_has_clear_provenance():
    frame = canonical_frame(3)
    before = frame.clone()
    report = inspect(frame)
    assert not report["errors"]
    assert codes(report, "warnings") == {
        "calendar_unknown",
        "adjustment_unknown",
        "staleness_not_assessed",
    }
    assert report["provenance"] == {
        "provider": "fixture",
        "interval": "1d",
        "data_version": "snapshot-v1",
        "row_count": 3,
        "start": "2024-01-01T00:00:00+00:00",
        "end": "2024-01-03T00:00:00+00:00",
        "timestamp_timezone": "UTC",
        "timestamp_unit": "us",
        "nominal_interval_seconds": 86400,
        "calendar": "unknown",
        "adjustment": "unknown",
        "staleness": "not_assessed",
        "example_limit": EXAMPLE_LIMIT,
    }
    assert inspect(frame) == report
    assert_frame_equal(frame, before)


@pytest.mark.parametrize("frame", [pl.DataFrame(), pl.DataFrame(schema=BARS_SCHEMA)])
def test_empty_frame_blocks_without_raising(frame):
    report = inspect(frame)
    assert "empty_frame" in codes(report)
    assert report["provenance"]["row_count"] == 0
    assert report["provenance"]["start"] is None


def test_missing_columns_are_schema_errors_not_silently_filled():
    report = inspect(canonical_frame(2).drop("timestamp", "volume"))
    missing = [item for item in report["errors"] if item["code"] == "missing_column"]
    assert {item["column"] for item in missing} == {"timestamp", "volume"}
    assert all(item["count"] == 1 and not item["rows"] for item in missing)


@pytest.mark.parametrize(
    "timestamps", [["2024-01-01", "bad"], [0, 1], [True, False], [None, None]]
)
def test_timestamp_types_are_not_guessed_or_coerced(timestamps):
    report = inspect(
        canonical_frame(2).with_columns(pl.Series("timestamp", timestamps))
    )
    assert "invalid_timestamp_type" in codes(report)
    assert report["provenance"]["start"] is None


def test_null_and_out_of_range_timestamps_block_and_serialize():
    timestamps = pl.Series("timestamp", [None, 2**63 - 1, 0], dtype=pl.Int64).cast(
        pl.Datetime("us", "UTC")
    )
    report = inspect(canonical_frame(3).with_columns(timestamps))
    invalid = issue(report, "invalid_timestamp", "timestamp")
    assert invalid["count"] == 2
    assert invalid["rows"] == [0, 1]
    assert "duplicate_timestamp" not in codes(report)


def test_naive_timezone_blocks_but_aware_timezone_has_utc_range():
    frame = canonical_frame(2)
    naive = inspect(frame.with_columns(pl.col("timestamp").dt.replace_time_zone(None)))
    assert "timestamp_timezone_unknown" in codes(naive)
    shifted = inspect(
        frame.with_columns(pl.col("timestamp").dt.convert_time_zone("America/New_York"))
    )
    assert not shifted["errors"]
    assert shifted["provenance"]["timestamp_timezone"] == "America/New_York"
    assert shifted["provenance"]["start"] == inspect(frame)["provenance"]["start"]


def test_duplicates_include_nonadjacent_occurrences_and_do_not_mutate_order():
    frame = canonical_frame(3)
    frame = frame.with_columns(
        pl.Series(
            "timestamp",
            [frame["timestamp"][0], frame["timestamp"][1], frame["timestamp"][0]],
        )
    )
    before = frame.clone()
    report = inspect(frame)
    duplicate = issue(report, "duplicate_timestamp", "timestamp")
    assert duplicate["count"] == 2 and duplicate["rows"] == [0, 2]
    assert issue(report, "nonmonotonic_timestamp", "timestamp")["rows"] == [2]
    assert "elapsed_gap" not in codes(report, "warnings")
    assert_frame_equal(frame, before)


def test_nonmonotonic_input_blocks_instead_of_being_sorted():
    report = inspect(canonical_frame(4).reverse())
    assert issue(report, "nonmonotonic_timestamp", "timestamp")["count"] == 3
    assert issue(report, "nonmonotonic_timestamp", "timestamp")["rows"] == [1, 2, 3]
    assert "duplicate_timestamp" not in codes(report)


def test_nanosecond_timestamps_retain_distinctness_and_order():
    timestamps = pl.Series(
        "timestamp", [1704067200000000000, 1704067200000000001], dtype=pl.Int64
    ).cast(pl.Datetime("ns", "UTC"))
    frame = canonical_frame(2).with_columns(timestamps)
    report = inspect(frame)
    assert not report["errors"]
    assert report["provenance"]["end"] == "2024-01-01T00:00:00.000000001+00:00"
    assert "nonmonotonic_timestamp" in codes(inspect(frame.reverse()))


def test_nanosecond_gap_does_not_round_to_the_nominal_interval():
    start = 1704067200000000000
    frame = canonical_frame(2).with_columns(
        pl.Series(
            "timestamp", [start, start + 86400 * 1_000_000_000 + 1], dtype=pl.Int64
        ).cast(pl.Datetime("ns", "UTC"))
    )
    assert "elapsed_gap" in codes(inspect(frame), "warnings")


def test_extreme_supported_dates_do_not_overflow_gap_subtraction():
    frame = canonical_frame(2).with_columns(
        pl.Series(
            "timestamp",
            [
                datetime(1, 1, 1, tzinfo=timezone.utc),
                datetime(9999, 12, 31, tzinfo=timezone.utc),
            ],
        )
    )
    report = inspect(frame)
    assert not report["errors"]
    assert "elapsed_gap" in codes(report, "warnings")


@pytest.mark.parametrize("column", ["open", "high", "low", "close"])
@pytest.mark.parametrize(
    "value", [None, float("nan"), float("inf"), -float("inf"), 0.0, -1.0]
)
def test_invalid_prices_block(column, value):
    report = inspect(
        canonical_frame(2).with_columns(
            pl.Series(column, [100.0, value], dtype=pl.Float64)
        )
    )
    invalid = issue(report, "invalid_price", column)
    assert invalid["count"] == 1 and invalid["rows"] == [1]


@pytest.mark.parametrize(
    "value", [None, float("nan"), float("inf"), -float("inf"), -1.0]
)
def test_invalid_volume_blocks(value):
    report = inspect(
        canonical_frame(2).with_columns(
            pl.Series("volume", [0.0, value], dtype=pl.Float64)
        )
    )
    invalid = issue(report, "invalid_volume", "volume")
    assert invalid["count"] == 1 and invalid["rows"] == [1]


@pytest.mark.parametrize(
    "column, values",
    [("open", ["100", "bad"]), ("volume", [True, False]), ("close", [[], []])],
)
def test_non_numeric_ohlcv_types_block_without_coercion(column, values):
    report = inspect(canonical_frame(2).with_columns(pl.Series(column, values)))
    assert "invalid_numeric_type" in codes(report)
    assert issue(report, "invalid_numeric_type", column)["rows"] == []


@pytest.mark.parametrize(
    "column, value", [("high", 1), ("low", 1000), ("open", 1000), ("close", 1)]
)
def test_inconsistent_ohlc_blocks(column, value):
    report = inspect(canonical_frame(2).with_columns(pl.lit(value).alias(column)))
    assert issue(report, "inconsistent_ohlc")["rows"] == [0, 1]


def test_flat_prices_and_zero_volume_are_valid():
    frame = canonical_frame(3).with_columns(
        *[pl.lit(10).alias(col) for col in ("open", "high", "low", "close")],
        pl.lit(0).alias("volume"),
    )
    assert not inspect(frame)["errors"]


def test_large_integer_ohlc_inconsistency_is_not_hidden_by_float_rounding():
    frame = canonical_frame(2).with_columns(
        *[
            pl.lit(2**60 + (1 if col == "open" else 0), dtype=pl.Int64).alias(col)
            for col in ("open", "high", "low", "close")
        ]
    )
    assert issue(inspect(frame), "inconsistent_ohlc")["rows"] == [0, 1]


def test_decimal_numeric_columns_are_supported():
    frame = canonical_frame(2).with_columns(
        pl.col("open", "high", "low", "close", "volume").cast(pl.Decimal(20, 4))
    )
    assert not inspect(frame)["errors"]


def test_gap_examples_are_bounded_without_inventing_missing_counts():
    start = datetime(2024, 1, 1, tzinfo=timezone.utc)
    frame = canonical_frame(100).with_columns(
        pl.Series("timestamp", [start + timedelta(days=i * 2) for i in range(100)])
    )
    gap = issue(inspect(frame), "elapsed_gap", "timestamp", "warnings")
    assert gap["count"] == 99
    assert gap["rows"] == [1, 2, 3, 4, 5]


@pytest.mark.parametrize(
    "provider", ["yfinance", "twelvedata", "binance", "csv", "unrecognized"]
)
def test_weekend_elapsed_gap_does_not_claim_missing_bars_or_calendar(provider):
    friday = datetime(2024, 1, 5, tzinfo=timezone.utc)
    frame = canonical_frame(2).with_columns(
        pl.Series("timestamp", [friday, friday + timedelta(days=3)])
    )
    report = inspect(frame, provider=provider)
    assert not report["errors"]
    gap = issue(report, "elapsed_gap", "timestamp", "warnings")
    assert gap["count"] == 1 and gap["rows"] == [1]
    assert "may explain" in gap["message"] and "counts are unknown" in gap["message"]
    assert "calendar_unknown" in codes(report, "warnings")
    assert report["provenance"]["calendar"] == "unknown"


@pytest.mark.parametrize("interval", ["1h", "1min", "45min", "1day", "1week"])
def test_fixed_interval_gap_is_nonblocking(interval):
    frame = canonical_frame(2).with_columns(
        pl.Series(
            "timestamp",
            [
                datetime(2024, 1, 1, tzinfo=timezone.utc),
                datetime(2024, 2, 1, tzinfo=timezone.utc),
            ],
        )
    )
    report = inspect(frame, interval=interval)
    assert not report["errors"]
    assert "elapsed_gap" in codes(report, "warnings")


@pytest.mark.parametrize("interval", ["1mo", "1month", "unsupported", "0m", ""])
def test_calendar_month_and_unknown_intervals_have_no_invented_gap_counts(interval):
    report = inspect(canonical_frame(2), interval=interval)
    assert not report["errors"]
    assert "interval_not_assessed" in codes(report, "warnings")
    assert "elapsed_gap" not in codes(report, "warnings")
    assert report["provenance"]["nominal_interval_seconds"] is None


def test_old_prices_do_not_infer_staleness_or_adjustments():
    frame = canonical_frame(2).with_columns(
        pl.Series("close", [100.0, 1.0]), pl.Series("low", [1.0, 1.0])
    )
    report = inspect(frame, provider="yfinance")
    assert not report["errors"]
    assert report["provenance"]["adjustment"] == "unknown"
    assert report["provenance"]["staleness"] == "not_assessed"


def test_large_diagnostic_counts_are_exact_but_examples_and_report_are_bounded():
    frame = canonical_frame(10_000).with_columns(
        pl.lit(float("nan")).alias("volume"),
        pl.lit(datetime(2024, 1, 1, tzinfo=timezone.utc)).alias("timestamp"),
    )
    report = inspect(frame)
    for code, column in [
        ("invalid_volume", "volume"),
        ("duplicate_timestamp", "timestamp"),
    ]:
        diagnostic = issue(report, code, column)
        assert diagnostic["count"] == 10_000
        assert diagnostic["rows"] == list(range(EXAMPLE_LIMIT))
    assert len(json.dumps(report, allow_nan=False)) < 5000

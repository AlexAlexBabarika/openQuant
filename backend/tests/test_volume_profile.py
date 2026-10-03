"""Unit tests for volume-profile math (path A)."""

from __future__ import annotations

import math
from datetime import datetime, timezone

import pytest

from backend.market.models import OHLCVCandle
from backend.market.volume_profile import bin_from_candle_distribution


def _candle(o: float, h: float, lo: float, c: float, v: float) -> OHLCVCandle:
    return OHLCVCandle(
        symbol="TEST",
        timestamp=datetime(2025, 1, 1, tzinfo=timezone.utc),
        open=o,
        high=h,
        low=lo,
        close=c,
        volume=v,
    )


def test_empty_candles_returns_zero_result():
    res = bin_from_candle_distribution([], row_size=1.0, va_pct=0.7)
    assert res.bins == []
    assert res.poc is None
    assert res.vah is None
    assert res.val is None


def test_single_candle_volume_is_preserved():
    # H-L span = 4, row_size = 1 -> 4-5 bins; total volume conserved.
    c = _candle(o=10, h=14, lo=10, c=14, v=100)
    res = bin_from_candle_distribution([c], row_size=1.0, va_pct=0.7)
    total = sum(b.up_vol + b.down_vol for b in res.bins)
    assert math.isclose(total, 100.0, rel_tol=1e-9)


def test_up_candle_puts_all_volume_in_up_side():
    c = _candle(o=10, h=12, lo=10, c=12, v=50)
    res = bin_from_candle_distribution([c], row_size=1.0, va_pct=0.7)
    assert sum(b.up_vol for b in res.bins) == pytest.approx(50.0)
    assert sum(b.down_vol for b in res.bins) == 0.0


def test_down_candle_puts_all_volume_in_down_side():
    c = _candle(o=12, h=12, lo=10, c=10, v=40)
    res = bin_from_candle_distribution([c], row_size=1.0, va_pct=0.7)
    assert sum(b.down_vol for b in res.bins) == pytest.approx(40.0)
    assert sum(b.up_vol for b in res.bins) == 0.0


def test_poc_is_heaviest_bin():
    # Two candles overlap at 11; heaviest row should be at 11.
    c1 = _candle(o=10, h=12, lo=10, c=12, v=100)
    c2 = _candle(o=11, h=11, lo=11, c=11, v=1000)  # doji concentrates at 11
    res = bin_from_candle_distribution([c1, c2], row_size=1.0, va_pct=0.7)
    assert res.poc == pytest.approx(11.0)


def test_value_area_contains_poc():
    c = _candle(o=10, h=14, lo=10, c=14, v=100)
    res = bin_from_candle_distribution([c], row_size=1.0, va_pct=0.7)
    assert res.val is not None and res.poc is not None and res.vah is not None
    assert res.val <= res.poc < res.vah


def test_row_size_must_be_positive():
    with pytest.raises(ValueError):
        bin_from_candle_distribution([], row_size=0.0, va_pct=0.7)


def test_va_pct_must_be_in_valid_range():
    with pytest.raises(ValueError):
        bin_from_candle_distribution([], row_size=1.0, va_pct=0.0)
    with pytest.raises(ValueError):
        bin_from_candle_distribution([], row_size=1.0, va_pct=1.5)


def test_doji_candle_dropped_into_single_bin():
    c = _candle(o=10, h=10, lo=10, c=10, v=25)
    res = bin_from_candle_distribution([c], row_size=1.0, va_pct=0.7)
    nonzero = [b for b in res.bins if b.up_vol + b.down_vol > 0]
    assert len(nonzero) == 1
    assert nonzero[0].up_vol == pytest.approx(25.0)


def test_partial_rows_are_weighted_by_overlap():
    res = bin_from_candle_distribution(
        [_candle(o=0.9, h=2.1, lo=0.9, c=2.1, v=120)], 1.0, 0.7
    )
    assert (res.price_min, res.price_max) == (0.0, 3.0)
    volumes = [b.up_vol + b.down_vol for b in res.bins]
    assert volumes == pytest.approx([10, 100, 10], abs=1e-9)
    assert sum(volumes) == pytest.approx(120, rel=1e-12)
    assert res.poc == 1.0


def test_high_endpoint_is_half_open_and_zero_volume_extension_preserves_weights():
    candle = _candle(o=1, h=2, lo=1, c=2, v=120)
    original = bin_from_candle_distribution([candle], 1.0, 0.7)
    extended = bin_from_candle_distribution(
        [candle, _candle(o=0.5, h=4, lo=0, c=3, v=0)], 1.0, 0.7
    )
    by_price = {b.price: b.up_vol + b.down_vol for b in extended.bins}
    assert by_price == {0: 0, 1: 120, 2: 0, 3: 0}
    assert by_price[original.bins[0].price] == original.bins[0].up_vol
    assert extended.poc == original.poc
    assert (extended.val, extended.vah) == (original.val, original.vah)


def test_flat_candle_at_row_boundary_uses_one_containing_row():
    res = bin_from_candle_distribution(
        [_candle(o=2, h=2, lo=2, c=2, v=25), _candle(o=1, h=4, lo=0, c=3, v=0)],
        1.0,
        1.0,
    )
    assert [b.up_vol for b in res.bins] == [0, 0, 25, 0]


def test_zero_volume_has_no_supported_levels():
    res = bin_from_candle_distribution([_candle(o=5, h=6, lo=5, c=6, v=0)], 1.0, 0.7)
    assert res.poc is None and res.vah is None and res.val is None
    assert all(b.up_vol + b.down_vol == 0 for b in res.bins)


def test_poc_ties_choose_lowest_row_lower_edge():
    res = bin_from_candle_distribution([_candle(o=5, h=7, lo=5, c=7, v=100)], 1.0, 0.5)
    assert res.poc == 5
    assert (res.val, res.vah) == (5, 6)


@pytest.mark.parametrize("flat", [False, True])
def test_one_row_value_area_brackets_full_row(flat):
    res = bin_from_candle_distribution(
        [_candle(o=5, h=5 if flat else 6, lo=5, c=5, v=100)], 1.0, 1.0
    )
    assert (res.val, res.vah) == (5, 6)
    assert res.price_max - res.price_min == res.row_size


@pytest.mark.parametrize("row_size", [0.1, 0.3, 1.0, 2.5])
def test_volume_conservation_and_selected_value_area_width(row_size):
    candles = [
        _candle(o=0.9, h=2.1, lo=0.9, c=2, v=120),
        _candle(o=3, h=3.14, lo=1.2, c=2, v=55),
        _candle(o=1.3, h=1.3, lo=1.3, c=1.3, v=7),
    ]
    res = bin_from_candle_distribution(candles, row_size, 0.7)
    assert sum(b.up_vol + b.down_vol for b in res.bins) == pytest.approx(182, rel=1e-12)
    assert res.val is not None and res.vah is not None
    selected = [b for b in res.bins if res.val <= b.price < res.vah]
    assert res.vah - res.val == pytest.approx(len(selected) * row_size, abs=1e-9)
    assert sum(b.up_vol + b.down_vol for b in selected) >= 182 * 0.7

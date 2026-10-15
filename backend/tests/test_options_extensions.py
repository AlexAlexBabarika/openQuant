"""Independent boundary and serialization regressions for manual extensions."""

from copy import deepcopy
from datetime import date, timedelta
import json

import pytest
from pydantic import ValidationError

from backend.derivatives import OptionsAnalysisRequest, analyze_options, runner


def extension_payload(axis="elapsed_days"):
    return dict(
        strategy=dict(
            underlying="MANUAL-XYZ",
            valuation_date="2024-02-28",
            expiry_date="2024-03-29",
            days_to_expiry=30,
            entry_fee_per_contract=2.5,
            legs=[
                dict(
                    kind="call",
                    quantity=2,
                    strike=100.125,
                    entry_premium=5,
                    implied_volatility=0.15,
                    bid=9,
                    ask=11,
                    quote_as_of="2024-02-28T14:15:16.125Z",
                ),
                dict(
                    kind="put",
                    quantity=-1,
                    strike=95.375,
                    entry_premium=3,
                    implied_volatility=0.55,
                ),
                dict(kind="call", quantity=1, strike=110.875, entry_premium=1),
                dict(kind="underlying", quantity=-10, multiplier=1, entry_premium=99),
                dict(
                    kind="call",
                    quantity=1,
                    strike=103,
                    implied_volatility=0,
                    enabled=False,
                ),
            ],
        ),
        spot=101.25,
        volatility=0.3,
        rate=-0.01,
        dividend_yield=0.02,
        spot_grid=[50, 150],
        scenarios=[dict(name="Parallel", elapsed_days=7.5, iv_shift_pp=5)],
        surface=dict(
            axis=axis,
            spots=[0, 95.375, 101.25, 150],
            steps=[0, 7.5, 30] if axis == "elapsed_days" else [-15, 0, 25],
        ),
    )


def extension_source(data):
    return (
        f"payload = {data!r}\n"
        "payload['strategy']['legs'] = [OptionLeg(**item) for item in payload['strategy']['legs']]\n"
        "payload['strategy'] = OptionStrategy(**payload['strategy'])\n"
        "result = analyze_options(payload)\n"
    )


def maximum_extension_payload(axis):
    data = extension_payload(axis)
    start = date(2016, 1, 1)
    data["strategy"].update(
        name="\x00" * 119 + "Q",
        underlying="\x00" * 79 + "Q",
        days_to_expiry=3650,
        valuation_date=start.isoformat(),
        expiry_date=(start + timedelta(days=3650)).isoformat(),
        entry_fee_per_contract=9999.987654321,
        legs=[
            dict(
                kind="call" if i % 2 else "put",
                quantity=9999 if i % 2 else -9999,
                strike=100.1234567890123 + i,
                entry_premium=999999.987654321,
                multiplier=999,
                implied_volatility=0.231234567890123 + i / 100,
                bid=999998.987654321,
                ask=999999.987654321,
                quote_as_of="2016-01-01T12:34:56." + "1" * 38 + "+00:00",
            )
            for i in range(16)
        ],
    )
    data["spot_grid"] = [i + 0.123456789012345 for i in range(201)]
    data["scenarios"] = [
        dict(
            name=str(i) + "\x00" * 79,
            elapsed_days=10.1234567890123 * i,
            iv_shift_pp=1.1234567890123 * i,
        )
        for i in range(3)
    ]
    data["surface"] = dict(
        axis=axis,
        spots=[i * 5 + 0.123456789012345 for i in range(41)],
        steps=[i * 182.5 for i in range(21)]
        if axis == "elapsed_days"
        else list(range(-20, 21, 2)),
    )
    return data


def set_path(data, path, value):
    target = data
    for part in path[:-1]:
        target = target[part]
    target[path[-1]] = value


@pytest.mark.parametrize(
    "path,value",
    [
        (("strategy", "underlying"), " "),
        (("strategy", "underlying"), "x" * 81),
        (("strategy", "valuation_date"), None),
        (("strategy", "expiry_date"), None),
        (("strategy", "valuation_date"), "2023-02-29"),
        (("strategy", "expiry_date"), "2024-02-30"),
        (("strategy", "expiry_date"), "2024-02-27"),
        (("strategy", "expiry_date"), "2024-03-30"),
        (("strategy", "expiry_date"), "2035-01-01"),
        (("strategy", "valuation_date"), "0000-01-01"),
        (("strategy", "valuation_date"), "2024-2-28"),
        (("strategy", "valuation_date"), "2024-02-28T00:00:00Z"),
        (("strategy", "valuation_date"), "2024-02-28+00:00"),
        (("strategy", "days_to_expiry"), 30.5),
        (("strategy", "legs", 0, "expiry_date"), "2024-02-27"),
        (("strategy", "legs", 0, "implied_volatility"), -0.001),
        (("strategy", "legs", 0, "implied_volatility"), 5.001),
        (("strategy", "legs", 0, "implied_volatility"), "0.2"),
        (("strategy", "legs", 0, "implied_volatility"), True),
        (("strategy", "legs", 0, "ask"), None),
        (("strategy", "legs", 0, "bid"), None),
        (("strategy", "legs", 0, "bid"), 12),
        (("strategy", "legs", 0, "bid"), -0.001),
        (("strategy", "legs", 0, "ask"), 1000000.001),
        (("strategy", "legs", 0, "bid"), "9"),
        (("strategy", "legs", 0, "ask"), True),
        (("strategy", "legs", 0, "quote_as_of"), None),
        (("strategy", "legs", 3, "implied_volatility"), 0),
        (("strategy", "legs", 3, "bid"), 0),
        (("strategy", "legs", 3, "ask"), 0),
        (("strategy", "legs", 3, "quote_as_of"), "2024-02-28T00:00Z"),
        (("strategy", "legs", 4, "implied_volatility"), -1),
        (("scenarios", 0, "iv_shift_pp"), -15.001),
        (("scenarios", 0, "iv_shift_pp"), 100.001),
        (("surface", "axis"), "probability"),
        (("surface", "spots"), [1]),
        (("surface", "spots"), list(range(42))),
        (("surface", "spots"), [1, 1]),
        (("surface", "spots"), [2, 1]),
        (("surface", "spots"), [-1, 100]),
        (("surface", "spots"), [0, 1000001]),
        (("surface", "spots"), [False, 100]),
        (("surface", "steps"), [0]),
        (("surface", "steps"), list(range(22))),
        (("surface", "steps"), [0, 0]),
        (("surface", "steps"), [1, 0]),
        (("surface", "steps"), [-1, 0]),
        (("surface", "steps"), [0, 30.001]),
        (("surface", "steps"), [0, 3651]),
        (("surface", "steps"), [False, 30]),
        (("surface", "steps"), ["0", 30]),
        (("surface", "pnl"), [[0, 0], [0, 0]]),
    ],
)
def test_extension_invalid_inputs_are_rejected_without_coercion(path, value):
    data = extension_payload()
    set_path(data, path, value)
    with pytest.raises(ValidationError):
        analyze_options(data)


@pytest.mark.parametrize(
    "timestamp",
    [
        "",
        "2024-02-28",
        "2024-02-28T14:15:16",
        "2024-02-28 14:15:16Z",
        "2024-02-28T14:15:16z",
        "2024-02-30T14:15:16Z",
        "2024-02-28T24:00:00Z",
        "2024-02-28T14:60:00Z",
        "2024-02-28T14:15:60Z",
        "2024-02-28T14:15:16+24:00",
        "2024-02-28T14:15:16+00:60",
        "2024-02-28T14:15:16+0000",
        "2024-02-28T14:15:16Z ",
        "2024-02-28T14:15:16." + "1" * 45 + "Z",
    ],
)
def test_invalid_manual_quote_timestamps(timestamp):
    data = extension_payload()
    data["strategy"]["legs"][0]["quote_as_of"] = timestamp
    with pytest.raises(ValidationError):
        analyze_options(data)


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
@pytest.mark.parametrize(
    "path",
    [
        ("strategy", "legs", 0, "implied_volatility"),
        ("strategy", "legs", 0, "bid"),
        ("strategy", "legs", 0, "ask"),
        ("surface", "spots", 0),
        ("surface", "steps", 0),
    ],
)
def test_nonfinite_extension_values_fail_before_analysis(path, value):
    data = extension_payload()
    set_path(data, path, value)
    with pytest.raises(ValidationError):
        analyze_options(data)


@pytest.mark.parametrize(
    "start,end,days",
    [
        ("2024-02-28", "2024-02-29", 1),
        ("2024-02-29", "2024-03-01", 1),
        ("2024-12-31", "2025-01-01", 1),
        ("2024-02-29", "2024-02-29", 0),
        ("2016-01-01", "2025-12-29", 3650),
    ],
)
def test_common_calendar_dates_are_exact_metadata_not_inferred_horizons(
    start, end, days
):
    data = extension_payload()
    data["strategy"].update(valuation_date=start, expiry_date=end, days_to_expiry=days)
    data["scenarios"] = []
    data["surface"] = None
    result = analyze_options(data)
    without_dates = deepcopy(data)
    without_dates["strategy"].update(valuation_date=None, expiry_date=None)
    baseline = analyze_options(without_dates)
    assert result.request.strategy.valuation_date == start
    assert result.request.strategy.expiry_date == end
    assert result.summary == baseline.summary
    assert result.legs == baseline.legs
    assert result.today_pnl == baseline.today_pnl
    assert result.greeks == baseline.greeks
    if days != 30:
        del data["strategy"]["days_to_expiry"]
        with pytest.raises(ValidationError):
            analyze_options(data)


@pytest.mark.parametrize(
    "timestamp",
    [
        "1999-01-01T00:00Z",
        "2024-02-28T14:15:16.123456-05:30",
        "2099-12-31T23:59:59+00:00",
    ],
)
def test_manual_quotes_preserve_premiums_and_never_certify_freshness(timestamp):
    data = extension_payload()
    data["strategy"]["legs"][0]["quote_as_of"] = timestamp
    result = analyze_options(data).model_dump(mode="json")
    baseline = deepcopy(data)
    baseline["strategy"]["legs"][0].update(bid=None, ask=None, quote_as_of=None)
    without_quotes = analyze_options(baseline).model_dump(mode="json")
    assert result["request"]["strategy"]["legs"][0]["entry_premium"] == 5
    assert result["request"]["strategy"]["legs"][0]["quote_as_of"] == timestamp
    assert result["model"]["input_source"] == "manual"
    del result["request"], without_quotes["request"]
    assert result == without_quotes
    baseline["strategy"]["legs"][0]["quote_as_of"] = timestamp
    assert analyze_options(baseline).request.strategy.legs[0].bid is None


@pytest.mark.parametrize("shift", [-100.001, -15.001, 100.001])
def test_iv_surface_rejects_axis_and_resolved_leg_limits(shift):
    data = extension_payload("iv_shift_pp")
    data["surface"]["steps"] = sorted([0, shift])
    with pytest.raises(ValidationError):
        analyze_options(data)


@pytest.mark.parametrize("axis", ["scenario", "iv_shift_pp"])
@pytest.mark.parametrize(
    "base,leg_iv,shift",
    [(0.1, 0.5, -20), (4.9, 0.5, 20), (0.5, 0.1, -20), (0.5, 4.9, 20)],
)
def test_parallel_shifts_bound_declared_base_and_explicit_iv_independently(
    axis, base, leg_iv, shift
):
    data = extension_payload()
    data["volatility"] = base
    for item in data["strategy"]["legs"]:
        if item["kind"] != "underlying" and item.get("enabled", True):
            item["implied_volatility"] = 0.5
    data["strategy"]["legs"][0]["implied_volatility"] = leg_iv
    data["scenarios"] = (
        [dict(name="Bound", iv_shift_pp=shift)] if axis == "scenario" else []
    )
    data["surface"] = (
        None
        if axis == "scenario"
        else dict(axis=axis, spots=[0, 100], steps=sorted([0, shift]))
    )
    with pytest.raises(ValidationError):
        analyze_options(data)


def test_zero_day_time_surface_has_no_two_distinct_in_range_steps():
    data = extension_payload()
    data["strategy"].update(days_to_expiry=0, expiry_date="2024-02-28")
    data["scenarios"] = []
    for steps in [[0, 0], [0, 0.001]]:
        data["surface"]["steps"] = steps
        with pytest.raises(ValidationError):
            analyze_options(data)
    data["surface"] = None
    assert analyze_options(data).surface is None


@pytest.mark.parametrize("iv,quote", [(0, 0), (5, 1000000)])
def test_closed_iv_quote_bounds_and_equal_bid_ask_are_accepted(iv, quote):
    data = extension_payload()
    data["scenarios"] = []
    data["surface"] = None
    data["strategy"]["legs"][0].update(implied_volatility=iv, bid=quote, ask=quote)
    result = analyze_options(data)
    assert result.legs[0].resolved_implied_volatility == iv
    assert result.request.strategy.legs[0].bid == quote
    assert result.request.strategy.legs[0].ask == quote
    assert result.request.strategy.legs[0].entry_premium == 5


def test_legacy_request_defaults_and_explicit_null_extensions_are_equivalent():
    legacy = dict(
        strategy=dict(
            legs=[dict(kind="call", quantity=1, strike=100, entry_premium=5)]
        ),
        spot=100,
        spot_grid=[50, 150],
    )
    result = analyze_options(legacy)
    explicit = deepcopy(legacy)
    explicit["strategy"].update(underlying=None, valuation_date=None, expiry_date=None)
    explicit["strategy"]["legs"][0].update(
        implied_volatility=None, bid=None, ask=None, quote_as_of=None
    )
    explicit["surface"] = None
    assert analyze_options(explicit) == result
    assert result.surface is None
    assert result.legs[0].resolved_implied_volatility == 0.2
    assert result.request.strategy.days_to_expiry == 30
    assert result.request.strategy.underlying is None
    assert len(result.expiry_curve) == 4
    encoded = result.model_dump_json()
    assert json.loads(encoded)["surface"] is None
    assert (
        OptionsAnalysisRequest.model_validate_json(json.dumps(legacy)) == result.request
    )


@pytest.mark.parametrize("axis", ["elapsed_days", "iv_shift_pp"])
def test_real_spawn_builders_preserve_all_extensions(axis):
    data = extension_payload(axis)
    expected = analyze_options(data).model_dump(mode="json")
    assert runner.run_options_analysis(data).model_dump(mode="json") == expected
    assert runner.run_options_python(extension_source(data)) == expected


@pytest.mark.parametrize("axis", ["elapsed_days", "iv_shift_pp"])
def test_maximum_extended_payload_and_fully_escaped_stdout_fit_existing_cap(axis):
    data = maximum_extension_payload(axis)
    assert len(data["strategy"]["legs"][0]["quote_as_of"]) == 64
    expected = analyze_options(data).model_dump(mode="json")
    assert runner.run_options_analysis(data).model_dump(mode="json") == expected
    source = extension_source(data) + "print('\\x00' * 16384, end='')"
    assert len(source) <= 20000
    result = runner.run_options_python(source)
    assert result.pop("stdout") == "\x00" * 16384
    assert result == expected
    assert len(result["legs"]) == 16
    assert len(result["greeks_grid"]) == 201
    assert len(result["scenarios"]) == 3
    assert len(result["surface"]["pnl"]) == 21
    assert all(len(row) == 41 for row in result["surface"]["pnl"])
    envelope = dict(status="ok", analysis={**result, "stdout": "\x00" * 16384})
    wire = json.dumps(envelope, ensure_ascii=False, allow_nan=False).encode("utf-8")
    assert len(wire) < 262144
    assert runner.MAX_OUTPUT_BYTES == 262144
    assert runner.DEFAULT_TIMEOUT_S == 5

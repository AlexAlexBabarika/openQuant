"""Manual European options contract, exact expiry geometry and BSM regressions."""

from copy import deepcopy
import json
from math import exp, fsum, isfinite

import pytest
from pydantic import ValidationError

from backend.derivatives import (
    OptionLeg,
    OptionStrategy,
    OptionsAnalysis,
    OptionsAnalysisRequest,
    analyze_options,
)


def leg(kind="call", quantity=1, strike=100, premium=10, multiplier=100, **kw):
    return dict(
        kind=kind,
        quantity=quantity,
        strike=strike,
        entry_premium=premium,
        multiplier=multiplier,
        **kw,
    )


def request(legs=None, days=365, **kw):
    return dict(
        strategy=dict(name="Research", days_to_expiry=days, legs=legs or [leg()]),
        spot=100,
        volatility=0.2,
        rate=0.05,
        dividend_yield=0,
        spot_grid=[0, 80, 90, 100, 110, 120, 200],
        **kw,
    )


def condor():
    return request(
        [
            leg("put", 1, 80, 1),
            leg("put", -1, 90, 3),
            leg("call", -1, 110, 3),
            leg("call", 1, 120, 1),
        ],
        days=30,
    )


def test_greek_curves_align_with_canonical_spot_exposures():
    data = condor()
    result = analyze_options(data)
    assert len(result.greeks_grid) == len(result.spot_grid)
    for spot, exposure in zip(result.spot_grid, result.greeks_grid):
        if spot == 0:
            assert exposure.delta is None
        else:
            at_spot = {**data, "spot": spot}
            assert exposure == analyze_options(at_spot).greeks


@pytest.mark.parametrize("field,value", [("volatility", 0), ("days", 0)])
def test_greek_curves_preserve_unavailable_values(field, value):
    data = condor()
    if field == "days":
        data["strategy"]["days_to_expiry"] = value
    else:
        data[field] = value
    result = analyze_options(data)
    assert all(g.delta is None and g.gamma is None for g in result.greeks_grid)


def test_condor_credit_bounds_and_all_roots_outside_display_grid():
    data = condor()
    data["spot_grid"] = [99, 100, 101]
    result = analyze_options(data)
    summary = result.summary
    assert summary.gross_entry_cost == -400
    assert summary.entry_credit == summary.max_profit == 400
    assert summary.max_loss == 600
    assert summary.entry_debit == summary.entry_fees == 0
    assert summary.breakevens == [86, 114]
    assert summary.zero_intervals == []
    assert not summary.profit_unbounded and not summary.loss_unbounded


def test_condor_expiry_curve_fees_and_fixed_scenario_premiums():
    data = condor()
    data["strategy"]["entry_fee_per_contract"] = 2.5
    data["scenarios"] = [dict(name="Expiry + 5 pp", elapsed_days=30, iv_shift_pp=5)]
    result = analyze_options(data)
    assert result.summary.entry_fees == 10
    assert result.summary.entry_credit == result.summary.max_profit == 390
    assert result.summary.max_loss == 610
    assert result.summary.breakevens == [86.1, 113.9]
    assert result.expiry_pnl == [-610, -610, 390, 390, 390, -610, -610]
    assert result.scenarios[0].pnl == result.expiry_pnl
    assert result.scenarios[0].volatility == 0.25
    assert result.request.strategy.legs[0].entry_premium == 1


@pytest.mark.parametrize(
    "kind,qty,profit,loss,roots",
    [
        ("call", 1, None, 1000, [110]),
        ("call", -1, 1000, None, [110]),
        ("put", 1, 9000, 1000, [90]),
        ("put", -1, 1000, 9000, [90]),
    ],
)
def test_single_option_unbounded_distinction(kind, qty, profit, loss, roots):
    result = analyze_options(request([leg(kind, qty)]))
    assert result.summary.max_profit == profit
    assert result.summary.max_loss == loss
    assert result.summary.profit_unbounded == (profit is None)
    assert result.summary.loss_unbounded == (loss is None)
    assert result.summary.breakevens == roots


def test_long_put_has_bounded_downside_domain():
    data = request([leg("put", premium=120)])
    result = analyze_options(data)
    assert result.summary.max_profit == 0
    assert result.summary.max_loss == 12000
    assert result.summary.breakevens == []  # A root at -20 is outside S>=0.


def test_butterfly_tangent_root_and_multiple_roots():
    legs = [
        leg(strike=90, premium=0),
        leg(quantity=-2, premium=5),
        leg(strike=110, premium=0),
    ]
    result = analyze_options(request(legs))
    assert result.summary.max_profit == 2000
    assert result.summary.max_loss == 0
    assert result.summary.breakevens == []
    # Debit 10 has a single tangent root at the middle strike.
    legs[0]["entry_premium"] = 20
    result = analyze_options(request(legs))
    assert result.summary.max_profit == 0
    assert result.summary.max_loss == 1000
    assert result.summary.breakevens == [100]
    # Debit 5 crosses twice.
    legs[0]["entry_premium"] = 15
    assert analyze_options(request(legs)).summary.breakevens == [95, 105]


def test_zero_intervals_are_explicit_and_merged():
    result = analyze_options(request([leg(premium=0)]))
    assert result.summary.breakevens == []
    assert [z.model_dump() for z in result.summary.zero_intervals] == [
        dict(start=0, end=100)
    ]
    offset = [leg(premium=0), leg(quantity=-1, premium=0)]
    result = analyze_options(request(offset))
    assert result.summary.max_profit == result.summary.max_loss == 0
    assert result.summary.breakevens == []
    assert [z.model_dump() for z in result.summary.zero_intervals] == [
        dict(start=0, end=None)
    ]
    result = analyze_options(request([leg("put", premium=0)]))
    assert [z.model_dump() for z in result.summary.zero_intervals] == [
        dict(start=100, end=None)
    ]


def test_zero_boundary_root_and_no_small_value_rounding():
    result = analyze_options(request([leg("put", premium=100)]))
    assert result.summary.breakevens == [0]
    result = analyze_options(request([leg(premium=1e-9)]))
    assert result.summary.max_loss == pytest.approx(1e-7)
    assert result.summary.breakevens == [100 + 1e-9]
    assert result.summary.zero_intervals == []


def test_all_five_roots_and_tail_not_limited_to_grid():
    data = request(
        [leg("underlying", 1, None, 5, 1)]
        + [
            leg("call", qty, strike, 0, 1)
            for strike, qty in [(10, -2), (20, 2), (30, -2), (40, 2)]
        ]
    )
    data["spot_grid"] = [100, 101]
    result = analyze_options(data)
    assert result.summary.breakevens == [5, 15, 25, 35, 45]
    assert result.summary.max_profit is None
    assert result.summary.max_loss == 5


def test_zero_interval_between_strikes_and_unbounded_zero_tail():
    # Value is -10 below 90, zero between 90 and 110, then positive.
    data = request([leg("put", -1, 90, 0), leg("call", 1, 110, 0)])
    result = analyze_options(data)
    assert [z.model_dump() for z in result.summary.zero_intervals] == [
        dict(start=90, end=110)
    ]
    assert result.summary.breakevens == []


@pytest.mark.parametrize(
    "template,kind,qty,profit,loss,roots",
    [
        ("covered_call", "call", -1, 1000, 9000, [90]),
        ("protective_put", "put", 1, None, 1000, [110]),
    ],
)
def test_share_hedge_templates(template, kind, qty, profit, loss, roots):
    data = request(
        [
            leg("underlying", 100, None, 100, 1),
            leg(kind, qty),
        ]
    )
    data["strategy"]["template"] = template
    data["strategy"]["entry_fee_per_contract"] = 1
    result = analyze_options(data)
    assert result.summary.entry_fees == 1  # Not 101, not multiplier-weighted.
    data["strategy"]["entry_fee_per_contract"] = 0
    result = analyze_options(data)
    assert result.summary.max_profit == profit
    assert result.summary.max_loss == loss
    assert result.summary.breakevens == roots
    assert result.request.strategy.template == template


@pytest.mark.parametrize("qty", [100, -100])
def test_stock_only_has_defined_greeks_even_at_expiry_and_zero_iv(qty):
    data = request([leg("underlying", qty, None, 100, 1)], days=0)
    data["volatility"] = 0
    result = analyze_options(data)
    assert result.greeks.model_dump() == dict(
        delta=float(qty), gamma=0, theta=0, vega=0, rho=0
    )
    assert result.today_pnl == result.expiry_pnl
    assert result.summary.breakevens == [100]


def test_disabled_legs_have_no_price_fees_greeks_or_geometry_effect():
    data = request([leg(), leg("put", -1000, 50, 1000, enabled=False)])
    assert analyze_options(data).summary == analyze_options(request()).summary
    assert analyze_options(data).greeks == analyze_options(request()).greeks
    assert len(analyze_options(data).request.strategy.legs) == 2


def test_reference_bsm_call_and_put_values():
    call = analyze_options(request())
    put = analyze_options(request([leg("put")]))
    assert call.summary.theoretical_value_today == pytest.approx(1045.0583572185565)
    assert put.summary.theoretical_value_today == pytest.approx(557.3526022256971)
    assert call.greeks.delta == pytest.approx(63.68306511756191)
    assert call.greeks.gamma == pytest.approx(1.8762017345846895)
    assert call.greeks.vega == pytest.approx(37.52403469169379)
    assert call.greeks.rho == pytest.approx(53.232481545376345)


def test_continuous_yield_put_call_price_and_greek_parities():
    call_data = request()
    call_data["dividend_yield"] = 0.03
    put_data = deepcopy(call_data)
    put_data["strategy"]["legs"][0]["kind"] = "put"
    call, put = analyze_options(call_data), analyze_options(put_data)
    dq, dr = exp(-0.03), exp(-0.05)
    assert (
        call.summary.theoretical_value_today - put.summary.theoretical_value_today
        == pytest.approx(10000 * (dq - dr))
    )
    assert call.greeks.delta - put.greeks.delta == pytest.approx(100 * dq)
    assert call.greeks.gamma == put.greeks.gamma
    assert call.greeks.vega == put.greeks.vega
    assert call.greeks.rho - put.greeks.rho == pytest.approx(100 * dr)
    assert call.greeks.theta - put.greeks.theta == pytest.approx(
        10000 * (0.03 * dq - 0.05 * dr) / 365
    )


@pytest.mark.parametrize("kind", ["call", "put"])
def test_signed_multiplier_greeks_match_finite_differences(kind):
    data = request([leg(kind, -3, 95, 7, 17)], days=180)
    data["dividend_yield"] = 0.02
    result = analyze_options(data)

    def value(field, increment):
        shifted = deepcopy(data)
        if field == "days":
            shifted["strategy"]["days_to_expiry"] += increment
        else:
            shifted[field] += increment
        return analyze_options(shifted).summary.theoretical_value_today

    h = 0.01
    delta = (value("spot", h) - value("spot", -h)) / (2 * h)
    gamma = (
        value("spot", h)
        - 2 * result.summary.theoretical_value_today
        + value("spot", -h)
    ) / h**2
    theta = (value("days", -h) - value("days", h)) / (2 * h)
    h = 1e-5
    vega = (value("volatility", h) - value("volatility", -h)) / (2 * h) / 100
    rho = (value("rate", h) - value("rate", -h)) / (2 * h) / 100
    for key, expected in dict(
        delta=delta, gamma=gamma, theta=theta, vega=vega, rho=rho
    ).items():
        assert getattr(result.greeks, key) == pytest.approx(expected, rel=1e-6)
    assert result.greeks.delta > 0 if kind == "put" else result.greeks.delta < 0


def test_today_scenario_curves_match_same_canonical_analysis():
    data = request(days=50)
    data["scenarios"] = [dict(name="10 days + 5 pp", elapsed_days=10, iv_shift_pp=5)]
    shifted = deepcopy(data)
    shifted["scenarios"] = []
    shifted["strategy"]["days_to_expiry"] = 40
    shifted["volatility"] = 0.25
    result = analyze_options(data)
    other = analyze_options(shifted)
    scenario = result.scenarios[0]
    assert scenario.remaining_days == 40
    assert scenario.volatility == 0.25
    assert scenario.pnl == other.today_pnl
    assert scenario.greeks == other.greeks
    assert result.summary.net_entry_cost == other.summary.net_entry_cost
    assert result.expiry_pnl == other.expiry_pnl
    assert result.request.scenarios[0].iv_shift_pp == 5


@pytest.mark.parametrize("kind", ["call", "put"])
def test_zero_iv_is_discounted_deterministic_mark_not_terminal_payoff(kind):
    data = request([leg(kind)], days=365)
    data["volatility"] = 0
    data["dividend_yield"] = 0.02
    result = analyze_options(data)
    difference = 100 * exp(-0.02) - 100 * exp(-0.05)
    expected = max(difference if kind == "call" else -difference, 0) * 100
    assert result.summary.theoretical_value_today == pytest.approx(expected)
    assert result.greeks.model_dump() == dict.fromkeys(
        ["delta", "gamma", "theta", "vega", "rho"]
    )
    assert result.expiry_pnl[3] == -1000
    assert "Null Greeks" in result.warnings[-1]


@pytest.mark.parametrize("kind", ["call", "put"])
def test_expiry_and_zero_spot_boundary_are_exact(kind):
    data = request([leg(kind)], days=0)
    result = analyze_options(data)
    assert result.today_pnl == result.expiry_pnl
    assert all(v is None for v in result.greeks.model_dump().values())
    data["strategy"]["days_to_expiry"] = 365
    result = analyze_options(data)
    expected = 0 if kind == "call" else 10000 * exp(-0.05)
    assert result.today_pnl[0] == pytest.approx(expected - 1000)


@pytest.mark.parametrize("rate,yield_,vol", [(-1, 1, 5), (1, -1, 0), (-1, -1, 1e-300)])
def test_extreme_supported_values_remain_finite_or_null(rate, yield_, vol):
    data = request([leg("put", -10000, 1e6, 1e6, 1000)], days=3650)
    data.update(
        spot=1e-300,
        rate=rate,
        dividend_yield=yield_,
        volatility=vol,
        spot_grid=[0, 1e-300, 1e6],
    )
    result = analyze_options(data)
    assert all(isfinite(v) for v in result.today_pnl + result.expiry_pnl)
    assert all(v is None or isfinite(v) for v in result.greeks.model_dump().values())
    json.dumps(result.model_dump(mode="json"), allow_nan=False)


@pytest.mark.parametrize(
    "field,value",
    [
        ("quantity", True),
        ("quantity", 1.0),
        ("quantity", "1"),
        ("quantity", 0),
        ("quantity", 10001),
        ("strike", 0),
        ("strike", -1),
        ("strike", None),
        ("entry_premium", -1),
        ("entry_premium", "1"),
        ("entry_premium", True),
        ("multiplier", 0),
        ("multiplier", 1001),
        ("multiplier", 100.0),
        ("enabled", "false"),
        ("enabled", 1),
        ("kind", "american"),
        ("strike", float("nan")),
        ("entry_premium", float("inf")),
    ],
)
def test_leg_strict_invalid_inputs(field, value):
    data = leg()
    data[field] = value
    with pytest.raises(ValidationError):
        OptionLeg.model_validate(data)


@pytest.mark.parametrize(
    "field,value",
    [
        ("spot", 0),
        ("spot", -1),
        ("spot", 1_000_001),
        ("spot", "100"),
        ("spot", True),
        ("volatility", -0.01),
        ("volatility", 5.01),
        ("volatility", float("nan")),
        ("rate", float("inf")),
        ("rate", 1.01),
        ("dividend_yield", -1.01),
        ("spot_grid", [0]),
        ("spot_grid", [1, 0]),
        ("spot_grid", [0, 0]),
        ("spot_grid", [0, float("inf")]),
        ("spot_grid", [0, True]),
        ("spot_grid", [0, "100"]),
        ("spot_grid", list(range(202))),
        ("spot_grid", [-1, 0]),
        ("spot_grid", [0, 1_000_001]),
        ("unexpected", 123),
    ],
)
def test_request_strict_invalid_inputs(field, value):
    data = request()
    data[field] = value
    with pytest.raises(ValidationError):
        analyze_options(data)


@pytest.mark.parametrize(
    "field,value",
    [
        ("name", ""),
        ("name", " "),
        ("name", "x" * 121),
        ("days_to_expiry", -1),
        ("days_to_expiry", 3651),
        ("currency", "EUR"),
        ("exercise_style", "american"),
        ("settlement", "physical"),
        ("entry_fee_per_contract", -1),
        ("entry_fee_per_contract", 10001),
        ("legs", []),
        ("legs", [leg()] * 17),
        ("legs", [leg(enabled=False)]),
        ("template", "brokerage"),
        ("unknown", True),
    ],
)
def test_strategy_strict_invalid_inputs(field, value):
    data = request()["strategy"]
    data[field] = value
    with pytest.raises(ValidationError):
        OptionStrategy.model_validate(data)


@pytest.mark.parametrize(
    "scenarios",
    [
        [dict(name="Late", elapsed_days=366)],
        [dict(name="Past", elapsed_days=-1)],
        [dict(name="Negative IV", iv_shift_pp=-21)],
        [dict(name="Large IV", iv_shift_pp=101)],
        [dict(name=" ")],
        [dict(name="x" * 81)],
        [dict(name="Same"), dict(name="Same")],
        [dict(name=str(i)) for i in range(4)],
        [dict(name="Strict", elapsed_days="1")],
        [dict(name="Extra", import_module="os")],
    ],
)
def test_scenario_bounds(scenarios):
    with pytest.raises(ValidationError):
        analyze_options(request(scenarios=scenarios))


def test_shifted_volatility_upper_bound_and_zero_boundary():
    data = request(scenarios=[dict(name="Up", iv_shift_pp=2)])
    data["volatility"] = 4.99
    with pytest.raises(ValidationError):
        analyze_options(data)
    data["volatility"] = 0.2
    data["scenarios"] = [dict(name="Zero", iv_shift_pp=-20)]
    assert analyze_options(data).scenarios[0].volatility == 0


@pytest.mark.parametrize(
    "changes", [dict(multiplier=100), dict(strike=100), dict(quantity=1_000_001)]
)
def test_underlying_share_schema(changes):
    data = leg("underlying", 100, None, 100, 1)
    data.update(changes)
    with pytest.raises(ValidationError):
        OptionLeg.model_validate(data)


def test_maximum_shape_is_bounded_and_serializable():
    data = request(
        [leg(quantity=(1 if i % 2 else -1), strike=100 + i) for i in range(16)]
    )
    data["spot_grid"] = list(range(201))
    data["scenarios"] = [
        dict(name=str(i), elapsed_days=i, iv_shift_pp=i) for i in range(3)
    ]
    result = analyze_options(data)
    assert len(result.today_pnl) == len(result.expiry_pnl) == 201
    assert all(len(s.pnl) == 201 for s in result.scenarios)
    dumped = result.model_dump_json()
    assert OptionsAnalysis.model_validate_json(dumped) == result
    assert result.model.input_source == "manual"


def test_defaults_full_request_echo_schema_and_no_input_mutation():
    data = dict(strategy=dict(legs=[leg()]), spot=100, spot_grid=[0, 200])
    original = deepcopy(data)
    result = analyze_options(data)
    assert data == original
    assert result.request.strategy.days_to_expiry == 30
    assert result.request.strategy.exercise_style == "european"
    assert result.request.strategy.settlement == "cash"
    assert result.request.strategy.currency == "USD"
    assert result.request.strategy.template == "custom"
    assert result.request.rate == 0.03 and result.request.volatility == 0.2
    assert result.request.dividend_yield == 0 and result.request.scenarios == []
    assert result.greek_units.theta == "USD per calendar day elapsed"
    assert OptionsAnalysisRequest.model_json_schema()["additionalProperties"] is False
    assert (
        OptionsAnalysis.model_json_schema()["$defs"]["OptionsProvenance"]["properties"][
            "input_source"
        ]["const"]
        == "manual"
    )


def test_mutated_and_constructed_model_inputs_cannot_bypass_limits():
    data = OptionsAnalysisRequest.model_validate(request())
    data.spot_grid.append(-1)
    with pytest.raises(ValidationError):
        analyze_options(data)
    data = OptionsAnalysisRequest.model_construct(
        **OptionsAnalysisRequest.model_validate(request()).__dict__
    )
    data.volatility = float("nan")
    with pytest.raises(ValidationError):
        analyze_options(data)


def test_sparse_expiry_curve_includes_exact_strike_and_root_not_interpolation():
    data = request([leg(premium=5)])
    data["spot_grid"] = [50, 150]
    result = analyze_options(data)
    assert result.expiry_pnl == [-500, 4500]
    assert [point.model_dump() for point in result.expiry_curve] == [
        dict(spot=50, pnl=-500),
        dict(spot=100, pnl=-500),
        dict(spot=105, pnl=0),
        dict(spot=150, pnl=4500),
    ]
    data["spot_grid"] = [50, 60, 100, 105, 110, 150]
    assert analyze_options(data).expiry_curve == result.expiry_curve


@pytest.mark.parametrize(
    "legs,domain,vertices",
    [
        ([leg(strike=97.3, premium=2.7)], [50, 150], [50, 97.3, 100, 150]),
        ([leg(strike=100, premium=5)], [101, 105], [101, 105]),
        ([leg(strike=100, premium=5)], [106, 110], [106, 110]),
        ([leg(strike=100, premium=5)], [100, 150], [100, 105, 150]),
        (
            [leg(strike=97.3, premium=5), leg(quantity=-1, strike=111.7, premium=2)],
            [90, 120],
            [90, 97.3, 100.3, 111.7, 120],
        ),
        ([leg("underlying", 2, None, 99.7, 1)], [90, 110], [90, 99.7, 110]),
        ([leg("put", premium=100)], [0, 100], [0, 100]),
        ([leg(premium=0)], [0, 150], [0, 100, 150]),
        (
            [leg(premium=0), leg(quantity=-1, premium=0)],
            [50, 150],
            [50, 100, 150],
        ),
        (
            [leg(premium=5), leg(strike=75, premium=100, enabled=False)],
            [50, 150],
            [50, 100, 105, 150],
        ),
        (
            [leg("put", -1, 90, 0), leg("call", 1, 110, 0)],
            [80, 120],
            [80, 90, 110, 120],
        ),
    ],
)
def test_expiry_vertices_cover_spreads_shares_zeros_disabled_and_zoom(
    legs, domain, vertices
):
    data = request(legs)
    data["spot_grid"] = domain
    result = analyze_options(data)
    assert [p.spot for p in result.expiry_curve] == pytest.approx(vertices)
    for point in result.expiry_curve:
        independent = 0
        for item in legs:
            if not item.get("enabled", True):
                continue
            value = (
                point.spot
                if item["kind"] == "underlying"
                else max(
                    (point.spot - item["strike"])
                    * (1 if item["kind"] == "call" else -1),
                    0,
                )
            )
            independent += (
                item["quantity"] * item["multiplier"] * (value - item["entry_premium"])
            )
        assert point.pnl == pytest.approx(independent)
    for left, right in zip(result.expiry_curve, result.expiry_curve[1:]):
        middle = (left.spot + right.spot) / 2
        check = {**data, "spot_grid": [left.spot, middle, right.spot]}
        assert analyze_options(check).expiry_pnl[1] == pytest.approx(
            (left.pnl + right.pnl) / 2
        )


def test_manual_dates_and_quotes_echo_without_changing_premiums_or_freshness():
    data = request([leg(premium=5, implied_volatility=0.3)], days=30)
    data["strategy"].update(
        underlying="XYZ", valuation_date="2026-10-14", expiry_date="2026-11-13"
    )
    original = analyze_options(data)
    data["strategy"]["legs"][0].update(
        bid=1, ask=2, quote_as_of="2020-01-01T10:00:00+02:30"
    )
    result = analyze_options(data)
    assert result.summary == original.summary
    assert result.greeks == original.greeks
    assert result.today_pnl == original.today_pnl
    assert result.request.strategy.legs[0].entry_premium == 5
    assert result.request.strategy.legs[0].quote_as_of == "2020-01-01T10:00:00+02:30"
    assert result.request.strategy.underlying == "XYZ"
    assert result.model.input_source == "manual"
    assert result.warnings == original.warnings


@pytest.mark.parametrize(
    "valuation,expiry,days",
    [
        ("2024-02-28", "2024-03-01", 2),
        ("2024-02-29", "2024-02-29", 0),
        ("2026-12-31", "2027-01-01", 1),
    ],
)
def test_valid_calendar_dates_use_common_utc_calendar_horizon(valuation, expiry, days):
    data = request(days=days)
    data["strategy"].update(valuation_date=valuation, expiry_date=expiry)
    assert analyze_options(data).request.strategy.days_to_expiry == days


@pytest.mark.parametrize(
    "metadata",
    [
        dict(valuation_date="2026-10-14"),
        dict(expiry_date="2026-11-13"),
        dict(valuation_date="2026-02-29", expiry_date="2026-03-31"),
        dict(valuation_date="2026-10-14", expiry_date="2026-10-13"),
        dict(valuation_date="2026-10-14", expiry_date="2026-11-14"),
        dict(valuation_date="2026-10-14T00:00:00Z", expiry_date="2026-11-13"),
        dict(valuation_date="20261014", expiry_date="2026-11-13"),
        dict(valuation_date="2026-10-14", expiry_date="2026-13-13"),
        dict(underlying=" "),
        dict(underlying="x" * 81),
    ],
)
def test_invalid_manual_strategy_metadata_rejected(metadata):
    data = request(days=30)
    data["strategy"].update(metadata)
    with pytest.raises(ValidationError):
        analyze_options(data)


@pytest.mark.parametrize(
    "metadata",
    [
        dict(implied_volatility=-0.01),
        dict(implied_volatility=5.01),
        dict(implied_volatility=float("nan")),
        dict(bid=1),
        dict(ask=1),
        dict(bid=1, ask=2),
        dict(bid=-1, ask=2, quote_as_of="2026-10-14T10:00:00Z"),
        dict(bid=3, ask=2, quote_as_of="2026-10-14T10:00:00Z"),
        dict(bid=0, ask=1_000_001, quote_as_of="2026-10-14T10:00:00Z"),
        dict(quote_as_of="2026-10-14T10:00:00"),
        dict(quote_as_of="2026-02-29T10:00:00Z"),
        dict(quote_as_of="2026-10-14T25:00:00Z"),
        dict(quote_as_of="2026-10-14T10:00:00+24:00"),
        dict(quote_as_of="2026-10-14T10:00:00+01:60"),
        dict(quote_as_of="2026-10-14"),
        dict(expiry_date="2026-11-13"),
    ],
)
def test_invalid_option_metadata_rejected(metadata):
    with pytest.raises(ValidationError):
        analyze_options(request([leg(**metadata)]))


@pytest.mark.parametrize(
    "timestamp", ["2026-10-14T10:00Z", "2026-10-14T10:00:00.123456-04:00"]
)
def test_timezone_aware_manual_quotes_allow_zero_and_timestamp_only(timestamp):
    assert OptionLeg.model_validate(leg(quote_as_of=timestamp)).quote_as_of == timestamp
    assert (
        OptionLeg.model_validate(leg(bid=0, ask=0, quote_as_of=timestamp)).entry_premium
        == 10
    )


@pytest.mark.parametrize(
    "metadata",
    [
        dict(implied_volatility=0.2),
        dict(bid=1, ask=2, quote_as_of="2026-10-14T10:00:00Z"),
        dict(quote_as_of="2026-10-14T10:00:00Z"),
    ],
)
def test_underlying_rejects_option_iv_and_quote_metadata(metadata):
    with pytest.raises(ValidationError):
        analyze_options(request([leg("underlying", 100, None, 100, 1, **metadata)]))


def test_per_leg_marks_fees_signed_greeks_sum_and_iv_fallback():
    data = request(
        [
            leg("put", 2, 97, 4, implied_volatility=0.4),
            leg("call", -3, 103, 3),
            leg("underlying", 25, None, 95, 1),
            leg("call", 5, 101, 1, implied_volatility=0, enabled=False),
        ],
        days=30,
    )
    data["strategy"]["entry_fee_per_contract"] = 1.25
    result = analyze_options(data)
    assert len(result.legs) == 4
    assert [r.leg_index for r in result.legs] == [0, 1, 2, 3]
    assert [r.resolved_implied_volatility for r in result.legs] == [0.4, 0.2, None, 0]
    assert [r.entry_fees for r in result.legs] == [2.5, 3.75, 0, 0]
    for index, item in enumerate(data["strategy"]["legs"][:3]):
        individual = deepcopy(data)
        individual["strategy"]["legs"] = [item]
        single = analyze_options(individual)
        assert (
            result.legs[index].theoretical_value_today
            == single.summary.theoretical_value_today
        )
        assert result.legs[index].pnl_today == single.summary.pnl_today
        assert result.legs[index].greeks == single.greeks
    for field in (
        "gross_entry_cost",
        "entry_fees",
        "net_entry_cost",
        "theoretical_value_today",
        "pnl_today",
    ):
        assert getattr(result.summary, field) == fsum(
            getattr(r, field) for r in result.legs
        )
    for key in type(result.greeks).model_fields:
        assert getattr(result.greeks, key) == pytest.approx(
            fsum(getattr(r.greeks, key) for r in result.legs)
        )
    disabled = result.legs[-1]
    assert not disabled.enabled
    assert (
        disabled.theoretical_value_today
        == disabled.pnl_today
        == disabled.entry_fees
        == 0
    )
    assert set(disabled.greeks.model_dump().values()) == {0}


def test_active_undefined_leg_greeks_propagate_without_disabled_nulls():
    data = request([leg(implied_volatility=0), leg(enabled=False)])
    result = analyze_options(data)
    assert set(result.legs[0].greeks.model_dump().values()) == {None}
    assert set(result.legs[1].greeks.model_dump().values()) == {0}
    assert set(result.greeks.model_dump().values()) == {None}


def test_per_leg_iv_used_in_grid_scenarios_and_greeks():
    data = request([leg(implied_volatility=0.4), leg("put", -1, 95, 2)], days=30)
    data["scenarios"] = [dict(name="Shift", elapsed_days=10, iv_shift_pp=5)]
    result = analyze_options(data)
    for spot, pnl, greeks in zip(
        result.spot_grid, result.today_pnl, result.greeks_grid
    ):
        at_spot = {**data, "spot": max(spot, 0.01)}
        if spot > 0:
            direct = analyze_options(at_spot)
            assert pnl == direct.summary.pnl_today
            assert greeks == direct.greeks
    shifted = deepcopy(data)
    shifted["strategy"]["days_to_expiry"] = 20
    shifted["strategy"]["legs"][0]["implied_volatility"] = 0.45
    shifted["volatility"] = 0.25
    shifted["scenarios"] = []
    direct = analyze_options(shifted)
    assert result.scenarios[0].pnl == pytest.approx(direct.today_pnl)
    assert result.scenarios[0].greeks == direct.greeks
    assert result.scenarios[0].volatility == 0.25
    assert result.request.strategy.legs[0].implied_volatility == 0.4


def test_override_iv_marks_match_independently_resolved_single_leg_requests():
    data = request(
        [leg(implied_volatility=0.6), leg("put", -2, 95, 2, implied_volatility=0.1)],
        days=30,
    )
    data["scenarios"] = [dict(name="Shift", elapsed_days=10, iv_shift_pp=5)]
    result = analyze_options(data)
    singles = []
    for item in data["strategy"]["legs"]:
        independent = deepcopy(data)
        resolved = deepcopy(item)
        independent["volatility"] = resolved.pop("implied_volatility")
        independent["strategy"]["legs"] = [resolved]
        singles.append(analyze_options(independent))
    assert result.summary.theoretical_value_today == fsum(
        single.summary.theoretical_value_today for single in singles
    )
    assert result.today_pnl == [
        fsum(values) for values in zip(*(s.today_pnl for s in singles))
    ]
    assert result.scenarios[0].pnl == [
        fsum(values) for values in zip(*(s.scenarios[0].pnl for s in singles))
    ]
    for key in type(result.greeks).model_fields:
        assert getattr(result.greeks, key) == pytest.approx(
            fsum(getattr(single.greeks, key) for single in singles)
        )
        assert getattr(result.scenarios[0].greeks, key) == pytest.approx(
            fsum(getattr(single.scenarios[0].greeks, key) for single in singles)
        )
    fallback_only = deepcopy(data)
    for item in fallback_only["strategy"]["legs"]:
        item.pop("implied_volatility")
    assert result.today_pnl != analyze_options(fallback_only).today_pnl


@pytest.mark.parametrize("iv,shift", [(0.01, -2), (4.99, 2)])
def test_enabled_override_shift_bounds_apply_to_scenarios_and_surfaces(iv, shift):
    data = request([leg(implied_volatility=iv)], days=30)
    data["scenarios"] = [dict(name="Invalid", iv_shift_pp=shift)]
    with pytest.raises(ValidationError, match="shifted volatility"):
        analyze_options(data)
    data["scenarios"] = []
    data["surface"] = dict(
        axis="iv_shift_pp", spots=[80, 120], steps=sorted([0, shift])
    )
    with pytest.raises(ValidationError, match="shifted volatility"):
        analyze_options(data)
    data["strategy"]["legs"].append(leg())
    data["strategy"]["legs"][0]["enabled"] = False
    assert analyze_options(data).surface is not None


@pytest.mark.parametrize(
    "axis,steps", [("elapsed_days", [0, 10, 30]), ("iv_shift_pp", [-10, 0, 10])]
)
def test_surface_baselines_orientation_cells_and_fee_consistency(axis, steps):
    data = request(
        [
            leg(implied_volatility=0.4),
            leg("put", -1, 95, 2),
            leg("underlying", 10, None, 98, 1),
        ],
        days=30,
    )
    data["strategy"]["entry_fee_per_contract"] = 2
    data["surface"] = dict(axis=axis, spots=[0, 80, 100, 120], steps=steps)
    original = deepcopy(data)
    result = analyze_options(data)
    assert data == original
    surface = result.surface
    assert surface.axis == axis and surface.steps == steps
    assert surface.spots == [0, 80, 100, 120]
    for step, row in zip(steps, surface.pnl):
        direct = deepcopy(data)
        direct.pop("surface")
        direct["spot_grid"] = surface.spots
        if axis == "elapsed_days":
            direct["strategy"]["days_to_expiry"] -= step
        else:
            direct["volatility"] += step / 100
            direct["strategy"]["legs"][0]["implied_volatility"] += step / 100
        analysis = analyze_options(direct)
        assert row == pytest.approx(analysis.today_pnl)
        assert analysis.summary.entry_fees == 4
        if step == 0:
            assert row[2] == result.summary.pnl_today
        if axis == "elapsed_days" and step == 30:
            direct["spot_grid"] = surface.spots
            assert row == analyze_options(direct).expiry_pnl


@pytest.mark.parametrize(
    "config",
    [
        dict(axis="unknown", spots=[80, 120], steps=[0, 1]),
        dict(axis="elapsed_days", spots=[80], steps=[0, 1]),
        dict(axis="elapsed_days", spots=list(range(42)), steps=[0, 1]),
        dict(axis="elapsed_days", spots=[80, 80], steps=[0, 1]),
        dict(axis="elapsed_days", spots=[120, 80], steps=[0, 1]),
        dict(axis="elapsed_days", spots=[-1, 80], steps=[0, 1]),
        dict(axis="elapsed_days", spots=[0, 1_000_001], steps=[0, 1]),
        dict(axis="elapsed_days", spots=[0, float("inf")], steps=[0, 1]),
        dict(axis="elapsed_days", spots=[80, 120], steps=[0]),
        dict(axis="elapsed_days", spots=[80, 120], steps=list(range(22))),
        dict(axis="elapsed_days", spots=[80, 120], steps=[0, 0]),
        dict(axis="elapsed_days", spots=[80, 120], steps=[1, 0]),
        dict(axis="elapsed_days", spots=[80, 120], steps=[-1, 0]),
        dict(axis="elapsed_days", spots=[80, 120], steps=[0, 31]),
        dict(axis="elapsed_days", spots=[80, 120], steps=[0, float("nan")]),
        dict(axis="iv_shift_pp", spots=[80, 120], steps=[-21, 0]),
        dict(axis="iv_shift_pp", spots=[80, 120], steps=[0, 101]),
        dict(axis="iv_shift_pp", spots=[80, 120], steps=[-101, 0]),
    ],
)
def test_surface_request_bounds(config):
    with pytest.raises(ValidationError):
        analyze_options(request(days=30, surface=config))


def test_declared_base_iv_shift_is_validated_even_with_all_overrides():
    data = request([leg(implied_volatility=0.5)])
    data["volatility"] = 0
    data["surface"] = dict(axis="iv_shift_pp", spots=[80, 120], steps=[-1, 0])
    with pytest.raises(ValidationError, match="shifted volatility"):
        analyze_options(data)


def test_maximum_surface_shape_and_old_request_nullable_defaults():
    data = request(
        [leg(strike=90 + i, implied_volatility=0.2 + i / 100) for i in range(16)]
    )
    data["spot_grid"] = list(range(201))
    data["scenarios"] = [
        dict(name=str(i), elapsed_days=i, iv_shift_pp=i) for i in range(3)
    ]
    data["surface"] = dict(
        axis="iv_shift_pp", spots=list(range(41)), steps=list(range(21))
    )
    result = analyze_options(data)
    assert len(result.surface.pnl) == 21
    assert all(len(row) == 41 for row in result.surface.pnl)
    assert all(isfinite(cell) for row in result.surface.pnl for cell in row)
    assert len(result.legs) == 16
    assert OptionsAnalysis.model_validate_json(result.model_dump_json()) == result
    legacy = analyze_options(
        dict(strategy=dict(legs=[leg()]), spot=100, spot_grid=[50, 150])
    )
    assert legacy.surface is None and legacy.request.surface is None
    assert legacy.request.strategy.underlying is None
    assert legacy.request.strategy.valuation_date is None
    assert legacy.request.strategy.expiry_date is None
    assert legacy.request.strategy.legs[0].implied_volatility is None
    assert legacy.request.strategy.legs[0].bid is None
    assert legacy.request.strategy.legs[0].ask is None
    assert legacy.request.strategy.legs[0].quote_as_of is None
    assert legacy.legs[0].resolved_implied_volatility == 0.2

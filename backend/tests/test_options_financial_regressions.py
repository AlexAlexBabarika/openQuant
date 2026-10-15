"""Independent European pricing checks, using only the public research contract.

References: Black & Scholes (1973), Journal of Political Economy 81(3),
637-654; Merton (1973), Bell Journal 4(1), 141-183. Marks below are also
checked by direct discounted lognormal payoff integration, not the BSM formula.
Expiry expectations are hand-derived piecewise linear cash flows on S >= 0.
"""

from copy import deepcopy
import json
from math import exp, fsum, isfinite, log, pi, sqrt
from random import Random

import pytest
from pydantic import ValidationError

from backend.derivatives import (
    OptionLeg,
    OptionStrategy,
    OptionsAnalysis,
    OptionsAnalysisRequest,
    OptionsScenario,
    analyze_options,
)


def leg(kind="call", quantity=1, strike=100, premium=0, multiplier=1, **kwargs):
    return dict(
        kind=kind,
        quantity=quantity,
        strike=strike,
        entry_premium=premium,
        multiplier=multiplier,
        **kwargs,
    )


def request(legs=None, days=365, **kwargs):
    return dict(
        strategy=dict(days_to_expiry=days, legs=legs if legs is not None else [leg()]),
        spot=100,
        volatility=0.2,
        rate=0,
        dividend_yield=0,
        spot_grid=[0, 50, 100, 150, 200],
        **kwargs,
    )


def discounted_payoff(kind, spot, strike, days, iv, rate, yield_):
    """Integrate e^-rT E[intrinsic(S_T)] with composite Simpson quadrature.

    S_T = S exp((r-q-sigma^2/2)T + sigma sqrt(T) Z), Z standard normal.
    Split at the exercise threshold so the integrand has no payoff kink.
    Test parameters have negligible Gaussian tails beyond +/-12 SD.
    """
    t = days / 365
    if t == 0:
        return max(spot - strike if kind == "call" else strike - spot, 0)
    if spot == 0:
        return 0 if kind == "call" else strike * exp(-rate * t)
    if iv == 0:
        forward = spot * exp((rate - yield_) * t)
        return exp(-rate * t) * max(
            forward - strike if kind == "call" else strike - forward, 0
        )
    drift = (rate - yield_ - iv * iv / 2) * t
    width = iv * sqrt(t)
    threshold = (log(strike / spot) - drift) / width
    lower, upper = (
        (max(-12, threshold), 12) if kind == "call" else (-12, min(12, threshold))
    )
    if lower >= upper:
        return 0.0
    panels = 2048
    step = (upper - lower) / panels

    def integrand(z):
        terminal = spot * exp(drift + width * z)
        payoff = max(terminal - strike if kind == "call" else strike - terminal, 0)
        return payoff * exp(-z * z / 2) / sqrt(2 * pi)

    terms = [integrand(lower), integrand(upper)]
    terms.extend(
        (4 if i % 2 else 2) * integrand(lower + i * step) for i in range(1, panels)
    )
    return exp(-rate * t) * step * fsum(terms) / 3


def reference_value(data, spot=None, days=None, iv=None, iv_shift_pp=0):
    strategy = data["strategy"]
    spot = data["spot"] if spot is None else spot
    days = strategy["days_to_expiry"] if days is None else days
    iv = data["volatility"] if iv is None else iv
    return fsum(
        item["quantity"]
        * item["multiplier"]
        * (
            spot
            if item["kind"] == "underlying"
            else discounted_payoff(
                item["kind"],
                spot,
                item["strike"],
                days,
                (
                    iv
                    if item.get("implied_volatility") is None
                    else item["implied_volatility"]
                )
                + iv_shift_pp / 100,
                data["rate"],
                data["dividend_yield"],
            )
        )
        for item in strategy["legs"]
        if item.get("enabled", True)
    )


def test_condor_hand_derived_boundary_and_tail_values():
    data = request(
        [
            leg("put", 1, 80, 1, 100),
            leg("put", -1, 90, 3, 100),
            leg("call", -1, 110, 3, 100),
            leg("call", 1, 120, 1, 100),
        ],
        days=0,
    )
    data["strategy"]["template"] = "iron_condor"
    data["spot_grid"] = [0, 79, 80, 85, 86, 89, 90, 100, 110, 111, 114, 115, 120, 1e6]
    result = analyze_options(data)
    assert result.expiry_pnl == [
        -600,
        -600,
        -600,
        -100,
        0,
        300,
        400,
        400,
        400,
        300,
        0,
        -100,
        -600,
        -600,
    ]
    assert result.today_pnl == result.expiry_pnl
    assert result.summary.gross_entry_cost == result.summary.net_entry_cost == -400
    assert result.summary.entry_credit == result.summary.max_profit == 400
    assert result.summary.max_loss == 600
    assert result.summary.entry_debit == result.summary.entry_fees == 0
    assert result.summary.breakevens == [86, 114]
    assert result.summary.zero_intervals == []
    assert not result.summary.profit_unbounded and not result.summary.loss_unbounded
    data["spot_grid"] = [99, 101]
    assert analyze_options(data).summary == result.summary


@pytest.mark.parametrize(
    "kind,quantity,premium,profit,loss,roots,payoffs",
    [
        ("call", 3, 2, None, 42, [12], [-42, -42, 0, 168]),
        ("call", -3, 2, 42, None, [12], [42, 42, 0, -168]),
        ("put", 3, 2, 168, 42, [8], [168, -42, -42, -42]),
        ("put", -3, 2, 42, 168, [8], [-168, 42, 42, 42]),
        ("put", 3, 12, 0, 252, [], [-42, -252, -252, -252]),
        ("put", 3, 10, 0, 210, [0], [0, -210, -210, -210]),
    ],
)
def test_long_short_and_nonnegative_spot_domain(
    kind, quantity, premium, profit, loss, roots, payoffs
):
    data = request([leg(kind, quantity, 10, premium, 7)], days=0)
    data["spot_grid"] = [0, 10, 12, 20]
    result = analyze_options(data)
    assert result.expiry_pnl == payoffs
    assert result.summary.max_profit == profit
    assert result.summary.max_loss == loss
    assert result.summary.breakevens == roots
    assert result.summary.profit_unbounded == (profit is None)
    assert result.summary.loss_unbounded == (loss is None)


@pytest.mark.parametrize("sign", [1, -1])
def test_five_roots_and_alternating_slopes_outside_display_grid(sign):
    data = request(
        [leg("underlying", sign, None, 5)]
        + [leg("call", sign * q, k) for k, q in [(10, -2), (20, 2), (30, -2), (40, 2)]],
        days=0,
    )
    data["spot_grid"] = [100, 101]
    result = analyze_options(data)
    assert result.summary.breakevens == [5, 15, 25, 35, 45]
    assert result.summary.max_profit == (None if sign == 1 else 5)
    assert result.summary.max_loss == (5 if sign == 1 else None)
    data["spot_grid"] = list(range(0, 51, 5))
    assert analyze_options(data).expiry_pnl == [
        sign * x for x in [-5, 0, 5, 0, -5, 0, 5, 0, -5, 0, 5]
    ]


@pytest.mark.parametrize(
    "debit,roots,profit,loss",
    [(0, [], 10, 0), (5, [15, 25], 5, 5), (10, [20], 0, 10), (11, [], 0, 11)],
)
def test_butterfly_crossing_tangent_and_no_roots(debit, roots, profit, loss):
    data = request(
        [leg(strike=10, premium=debit), leg(quantity=-2, strike=20), leg(strike=30)]
    )
    result = analyze_options(data)
    assert result.summary.breakevens == roots
    assert result.summary.max_profit == profit
    assert result.summary.max_loss == loss
    assert [(i.start, i.end) for i in result.summary.zero_intervals] == (
        [(0, 10), (30, None)] if debit == 0 else []
    )


def test_disconnected_zero_regions_are_closed_and_not_isolated_roots():
    data = request(
        [
            leg(strike=k, quantity=q)
            for k, q in [(10, 1), (20, -2), (30, 1), (40, 1), (50, -2), (60, 1)]
        ],
        days=0,
    )
    data["spot_grid"] = [0, 10, 20, 30, 35, 40, 50, 60, 100]
    result = analyze_options(data)
    assert result.expiry_pnl == [0, 0, 10, 0, 0, 0, 10, 0, 0]
    assert result.summary.breakevens == []
    assert [(i.start, i.end) for i in result.summary.zero_intervals] == [
        (0, 10),
        (30, 40),
        (60, None),
    ]
    assert result.summary.max_profit == 10 and result.summary.max_loss == 0


def test_identically_zero_position_and_zero_strip():
    result = analyze_options(request([leg(premium=3), leg(quantity=-1, premium=3)]))
    assert result.summary.max_profit == result.summary.max_loss == 0
    assert result.summary.breakevens == []
    assert [(i.start, i.end) for i in result.summary.zero_intervals] == [(0, None)]
    assert result.today_pnl == result.expiry_pnl == [0] * 5
    strip = analyze_options(request([leg("put", -1, 80), leg("call", 1, 120)]))
    assert strip.summary.breakevens == []
    assert [(i.start, i.end) for i in strip.summary.zero_intervals] == [(80, 120)]


@pytest.mark.parametrize(
    "kind,quantity,stock_entry,roots,profit,loss,entry_cost",
    [
        ("call", -2, 95, [92], 1600, 18400, 18400),
        ("put", 2, 100, [103], None, 600, 20600),
        ("put", 2, 95, [], None, 0, 19600),
    ],
)
def test_fully_matched_underlying_hedges(
    kind, quantity, stock_entry, roots, profit, loss, entry_cost
):
    data = request(
        [leg("underlying", 200, None, stock_entry), leg(kind, quantity, 100, 3, 100)]
    )
    result = analyze_options(data)
    assert result.summary.breakevens == roots
    assert result.summary.max_profit == profit
    assert result.summary.max_loss == loss
    assert result.summary.profit_unbounded == (profit is None)
    assert not result.summary.loss_unbounded
    assert result.summary.net_entry_cost == entry_cost


@pytest.mark.parametrize("shares", [11, -11])
def test_stock_only_cash_flows_and_greeks_at_zero_iv_and_expiry(shares):
    data = request([leg("underlying", shares, None, 80), leg(enabled=False)], days=0)
    data["volatility"] = 0
    data["strategy"]["entry_fee_per_contract"] = 100
    result = analyze_options(data)
    assert (
        result.today_pnl
        == result.expiry_pnl
        == [shares * (s - 80) for s in data["spot_grid"]]
    )
    assert result.summary.entry_fees == 0
    assert result.summary.breakevens == [80]
    assert result.greeks.model_dump() == dict(
        delta=shares, gamma=0, theta=0, vega=0, rho=0
    )


def test_signed_multipliers_fees_and_disabled_legs_excluded_everywhere():
    data = request(
        [
            leg("call", 2, 100, 7, 10),
            leg("put", -3, 90, 4, 20),
            leg("underlying", -11, None, 100),
        ]
    )
    data["strategy"]["entry_fee_per_contract"] = 0.75
    data["scenarios"] = [dict(name="Expiry", elapsed_days=365, iv_shift_pp=5)]
    result = analyze_options(data)
    assert result.summary.gross_entry_cost == -1200
    assert result.summary.entry_fees == 3.75
    assert result.summary.net_entry_cost == -1196.25
    assert result.summary.entry_credit == 1196.25
    assert result.summary.entry_debit == 0
    assert result.expiry_pnl == [
        20 * max(s - 100, 0) - 60 * max(90 - s, 0) - 11 * s + 1196.25
        for s in data["spot_grid"]
    ]
    assert result.scenarios[0].pnl == result.expiry_pnl
    data["strategy"]["legs"].append(leg("put", -10000, 1e6, 1e6, 1000, enabled=False))
    disabled = analyze_options(data)
    assert disabled.summary == result.summary
    assert disabled.greeks == result.greeks
    assert disabled.today_pnl == result.today_pnl
    assert disabled.expiry_pnl == result.expiry_pnl
    assert disabled.scenarios == result.scenarios
    assert disabled.warnings == result.warnings
    assert not disabled.request.strategy.legs[-1].enabled
    data["strategy"]["legs"][-1]["strike"] = 0
    with pytest.raises(ValidationError):
        analyze_options(data)


def test_entry_fees_can_turn_a_credit_into_a_debit_and_remove_roots():
    data = request([leg("call", -1, 100, 0.01, 100)], days=0)
    data["strategy"]["entry_fee_per_contract"] = 2
    result = analyze_options(data)
    assert result.summary.gross_entry_cost == -1
    assert result.summary.net_entry_cost == result.summary.entry_debit == 1
    assert result.summary.entry_credit == result.summary.max_profit == 0
    assert result.summary.max_loss is None and result.summary.loss_unbounded
    assert result.summary.breakevens == []


def test_breakevens_are_not_clipped_to_the_request_price_limit():
    data = request([leg(strike=1e6, premium=1e6)])
    result = analyze_options(data)
    assert result.summary.breakevens == [2e6]
    assert result.summary.max_profit is None
    assert result.summary.max_loss == 1e6


@pytest.mark.parametrize("kind", ["call", "put"])
@pytest.mark.parametrize(
    "spot,strike,days,iv,rate,yield_",
    [
        (42, 40, 182.5, 0.2, 0.1, 0),
        (100, 100, 365, 0.2, 0, 0),
        (80, 110, 90, 0.6, -0.04, 0.02),
        (130, 100, 730, 0.35, 0.03, 0.07),
    ],
)
def test_marks_against_discounted_lognormal_payoff_integral(
    kind, spot, strike, days, iv, rate, yield_
):
    data = request([leg(kind, 1, strike)], days=days)
    data.update(spot=spot, volatility=iv, rate=rate, dividend_yield=yield_)
    result = analyze_options(data)
    expected = discounted_payoff(kind, spot, strike, days, iv, rate, yield_)
    assert result.summary.theoretical_value_today == pytest.approx(
        expected, abs=2e-8, rel=2e-9
    )
    for s, pnl in zip(result.spot_grid, result.today_pnl):
        assert pnl == pytest.approx(
            discounted_payoff(kind, s, strike, days, iv, rate, yield_),
            abs=2e-8,
            rel=2e-9,
        )


def test_standard_hull_call_example_and_atm_reference_greek_scales():
    # Hull's standard European example: S=42, K=40, T=.5, r=.1, sigma=.2;
    # the textbook call rounds to 4.76. Extra digits follow the BSM derivation.
    data = request([leg(strike=40)], days=182.5)
    data.update(spot=42, rate=0.1)
    assert analyze_options(data).summary.theoretical_value_today == pytest.approx(
        4.75942239287153, abs=1e-12
    )
    # At S=K=100, r=q=0, T=1, sigma=.2: d1=.1, d2=-.1.
    # Phi(.1)=.539827837277029, phi(.1)=.3969525474770118.
    result = analyze_options(request())
    assert result.summary.theoretical_value_today == pytest.approx(
        7.9655674554058, abs=1e-12
    )
    assert result.greeks.delta == pytest.approx(0.539827837277029, abs=1e-14)
    assert result.greeks.gamma == pytest.approx(0.01984762737385059, abs=1e-14)
    assert result.greeks.theta == pytest.approx(-3.969525474770118 / 365, abs=1e-14)
    assert result.greeks.vega == pytest.approx(39.69525474770118 / 100, abs=1e-14)
    assert result.greeks.rho == pytest.approx(46.0172162722971 / 100, abs=1e-14)
    assert result.greek_units.theta == "USD per calendar day elapsed"
    assert result.greek_units.vega == "USD per 1 volatility percentage point"
    assert result.greek_units.rho == "USD per 1 rate percentage point"


@pytest.mark.parametrize(
    "spot,strike,days,iv,rate,yield_",
    [
        (100, 95, 180, 0.3, 0.04, 0.02),
        (70, 120, 730, 0.5, -0.05, 0.08),
        (150, 90, 30, 0.15, 0.02, -0.03),
    ],
)
def test_put_call_parity_price_bounds_and_greek_parity(
    spot, strike, days, iv, rate, yield_
):
    data = request([leg(strike=strike)], days=days)
    data.update(spot=spot, volatility=iv, rate=rate, dividend_yield=yield_)
    call = analyze_options(data)
    data["strategy"]["legs"][0]["kind"] = "put"
    put = analyze_options(data)
    t = days / 365
    discounted_spot, discounted_strike = (
        spot * exp(-yield_ * t),
        strike * exp(-rate * t),
    )
    c, p = call.summary.theoretical_value_today, put.summary.theoretical_value_today
    assert c - p == pytest.approx(discounted_spot - discounted_strike, abs=1e-12)
    assert (
        max(discounted_spot - discounted_strike, 0) - 1e-12
        <= c
        <= discounted_spot + 1e-12
    )
    assert (
        max(discounted_strike - discounted_spot, 0) - 1e-12
        <= p
        <= discounted_strike + 1e-12
    )
    assert call.greeks.delta - put.greeks.delta == pytest.approx(exp(-yield_ * t))
    assert call.greeks.gamma == pytest.approx(put.greeks.gamma)
    assert call.greeks.vega == pytest.approx(put.greeks.vega)
    assert call.greeks.rho - put.greeks.rho == pytest.approx(
        t * discounted_strike / 100
    )
    assert call.greeks.theta - put.greeks.theta == pytest.approx(
        (yield_ * discounted_spot - rate * discounted_strike) / 365
    )


@pytest.mark.parametrize("iv", [0, 5])
@pytest.mark.parametrize("rate,yield_", [(-1, 1), (1, -1), (-1, -1), (1, 1)])
def test_price_limits_at_supported_carry_and_volatility_boundaries(iv, rate, yield_):
    data = request(days=3650)
    data.update(rate=rate, dividend_yield=yield_, volatility=iv)
    call = analyze_options(data)
    data["strategy"]["legs"][0]["kind"] = "put"
    put = analyze_options(data)
    for spot, c, p in zip(call.spot_grid, call.today_pnl, put.today_pnl):
        discounted_spot, discounted_strike = (
            spot * exp(-yield_ * 10),
            100 * exp(-rate * 10),
        )
        tolerance = 1e-9 * max(1, discounted_spot, discounted_strike)
        assert (
            max(discounted_spot - discounted_strike, 0) - tolerance
            <= c
            <= discounted_spot + tolerance
        )
        assert (
            max(discounted_strike - discounted_spot, 0) - tolerance
            <= p
            <= discounted_strike + tolerance
        )
        assert c - p == pytest.approx(
            discounted_spot - discounted_strike, abs=tolerance
        )


@pytest.mark.parametrize(
    "kind,quantity,multiplier", [("call", 2, 100), ("put", -3, 17)]
)
def test_greeks_against_independent_integral_finite_differences(
    kind, quantity, multiplier
):
    data = request(
        [leg(kind, quantity, 105, 7, multiplier), leg("underlying", -11, None, 90)],
        days=180,
    )
    data.update(volatility=0.35, rate=0.04, dividend_yield=0.02)
    result = analyze_options(data)
    h = 0.05
    up, down, base = (
        reference_value(data, spot=100 + h),
        reference_value(data, spot=100 - h),
        reference_value(data),
    )
    expected = dict(delta=(up - down) / (2 * h), gamma=(up - 2 * base + down) / h**2)
    h = 0.02
    expected["theta"] = (
        reference_value(data, days=180 - h) - reference_value(data, days=180 + h)
    ) / (2 * h)
    h = 1e-4
    expected["vega"] = (
        reference_value(data, iv=0.35 + h) - reference_value(data, iv=0.35 - h)
    ) / (2 * h * 100)
    up_data, down_data = deepcopy(data), deepcopy(data)
    up_data["rate"] += h
    down_data["rate"] -= h
    expected["rho"] = (reference_value(up_data) - reference_value(down_data)) / (
        2 * h * 100
    )
    for key, value in expected.items():
        assert getattr(result.greeks, key) == pytest.approx(value, rel=4e-6, abs=1e-6)
    assert result.greeks.gamma > 0 if quantity > 0 else result.greeks.gamma < 0
    assert result.greeks.vega > 0 if quantity > 0 else result.greeks.vega < 0


@pytest.mark.parametrize("kind", ["call", "put"])
@pytest.mark.parametrize("rate,yield_", [(0.07, 0.02), (-0.03, 0.04)])
def test_zero_iv_discounted_forward_intrinsic_and_null_propagation(kind, rate, yield_):
    data = request([leg(kind, -2, 100, 4, 17), leg("underlying", 3, None, 90)])
    data.update(volatility=0, rate=rate, dividend_yield=yield_)
    result = analyze_options(data)
    cost = -136 + 270
    for spot, pnl in zip(result.spot_grid, result.today_pnl):
        difference = spot * exp(-yield_) - 100 * exp(-rate)
        expected = (
            -34 * max(difference if kind == "call" else -difference, 0)
            + 3 * spot
            - cost
        )
        assert pnl == pytest.approx(expected)
    assert result.summary.theoretical_value_today == pytest.approx(
        reference_value(data)
    )
    assert all(value is None for value in result.greeks.model_dump().values())
    assert result.today_pnl != result.expiry_pnl


@pytest.mark.parametrize("kind", ["call", "put"])
def test_zero_time_exact_intrinsic_and_tiny_positive_time(kind):
    data = request([leg(kind, 1, 100, 2, 100)], days=0)
    data.update(rate=-0.03, dividend_yield=0.05)
    result = analyze_options(data)
    assert result.today_pnl == result.expiry_pnl
    assert result.summary.theoretical_value_today == 0
    assert all(g is None for g in result.greeks.model_dump().values())
    data.update(rate=0, dividend_yield=0)
    data["strategy"]["days_to_expiry"] = 1e-8
    result = analyze_options(data)
    # ATM, zero carry: C=P=S[2 Phi(sigma sqrt(T)/2)-1]
    # = S sigma sqrt(T)/sqrt(2 pi) + O(T^(3/2)).
    expected = 10000 * 0.2 * sqrt(1e-8 / 365) / sqrt(2 * pi)
    assert result.summary.theoretical_value_today == pytest.approx(expected, rel=1e-8)
    assert result.greeks.gamma > 0 and result.greeks.theta < 0
    assert all(g is None or isfinite(g) for g in result.greeks.model_dump().values())
    json.dumps(result.model_dump(mode="json"), allow_nan=False)


@pytest.mark.parametrize(
    "spot,strike,days,iv,rate,yield_",
    [
        (1e-300, 1e6, 3650, 5, -1, 1),
        (1e6, 1e-300, 1e-300, 1e-300, 1, -1),
        (1e-300, 1e-300, 1e-300, 1e-300, -1, -1),
    ],
)
def test_extreme_finite_inputs_remain_serializable(
    spot, strike, days, iv, rate, yield_
):
    data = request([leg("put", -10000, strike, 1e6, 1000)], days=days)
    data.update(
        spot=spot,
        volatility=iv,
        rate=rate,
        dividend_yield=yield_,
        spot_grid=[0, 1e-300, 1e6],
    )
    result = analyze_options(data)
    assert all(isfinite(v) for v in result.today_pnl + result.expiry_pnl)
    assert all(v is None or isfinite(v) for v in result.greeks.model_dump().values())
    json.dumps(result.model_dump(mode="json"), allow_nan=False)


@pytest.mark.parametrize(
    "value",
    [float("nan"), float("inf"), float("-inf")],
    ids=["nan", "inf", "negative-inf"],
)
@pytest.mark.parametrize(
    "path",
    [
        ("spot",),
        ("volatility",),
        ("rate",),
        ("dividend_yield",),
        ("spot_grid", 1),
        ("strategy", "days_to_expiry"),
        ("strategy", "entry_fee_per_contract"),
        ("strategy", "legs", 0, "strike"),
        ("strategy", "legs", 0, "entry_premium"),
        ("strategy", "legs", 0, "quantity"),
        ("strategy", "legs", 0, "multiplier"),
        ("scenarios", 0, "elapsed_days"),
        ("scenarios", 0, "iv_shift_pp"),
    ],
)
def test_nonfinite_values_rejected_at_every_financial_input(path, value):
    data = request(scenarios=[dict(name="Stress", elapsed_days=10, iv_shift_pp=5)])
    cursor = data
    for part in path[:-1]:
        cursor = cursor[part]
    cursor[path[-1]] = value
    with pytest.raises(ValidationError):
        analyze_options(data)
    with pytest.raises(ValidationError):
        OptionsAnalysisRequest.model_validate(data)


def test_all_public_input_models_enforce_financial_semantics_and_revalidate():
    stock = OptionLeg(kind="underlying", quantity=100, multiplier=1, entry_premium=95)
    option = OptionLeg(kind="call", quantity=-1, strike=100, entry_premium=3)
    strategy = OptionStrategy(legs=[stock, option], days_to_expiry=30)
    scenario = OptionsScenario(name="Expiry", elapsed_days=30, iv_shift_pp=-20)
    model = OptionsAnalysisRequest(
        strategy=strategy, spot=100, spot_grid=[0, 100, 200], scenarios=[scenario]
    )
    result = analyze_options(model)
    assert result.summary.entry_credit == 0
    assert result.summary.net_entry_cost == 9200
    assert result.scenarios[0].remaining_days == result.scenarios[0].volatility == 0
    assert OptionsAnalysis.model_validate_json(result.model_dump_json()) == result
    model.strategy.legs[0].multiplier = 100
    with pytest.raises(ValidationError):
        analyze_options(model)
    with pytest.raises(ValidationError):
        OptionsScenario(name="Nonfinite", elapsed_days=float("nan"))
    with pytest.raises(ValidationError):
        OptionStrategy(legs=[option], entry_fee_per_contract=float("inf"))


def test_scenarios_preserve_entry_cash_flows_and_resolve_days_and_iv():
    data = request(
        [
            leg("call", -2, 105, 7, 100),
            leg("put", 1, 95, 3, 50),
            leg("underlying", 40, None, 90),
        ],
        days=90,
    )
    data.update(spot=107, volatility=0.3, rate=0.04, dividend_yield=0.01)
    data["strategy"]["entry_fee_per_contract"] = 1.5
    data["scenarios"] = [
        dict(name="Later higher IV", elapsed_days=20, iv_shift_pp=5),
        dict(name="Deterministic", elapsed_days=40, iv_shift_pp=-30),
        dict(name="Expiry", elapsed_days=90, iv_shift_pp=10),
    ]
    original = deepcopy(data)
    result = analyze_options(data)
    entry_cost = -1400 + 150 + 3600 + 4.5
    assert result.summary.net_entry_cost == entry_cost
    for scenario, days, iv in zip(result.scenarios, [70, 50, 0], [0.35, 0, 0.4]):
        assert scenario.remaining_days == days
        assert scenario.elapsed_days == 90 - days
        assert scenario.volatility == pytest.approx(iv)
        assert scenario.pnl == pytest.approx(
            [
                reference_value(data, spot=s, days=days, iv=iv) - entry_cost
                for s in result.spot_grid
            ],
            abs=2e-6,
            rel=2e-9,
        )
    assert result.scenarios[-1].pnl == result.expiry_pnl
    assert all(g is None for g in result.scenarios[1].greeks.model_dump().values())
    assert all(g is None for g in result.scenarios[2].greeks.model_dump().values())
    assert data == original
    assert result.request.strategy.legs[0].entry_premium == 7
    assert result.request.scenarios[0].iv_shift_pp == 5
    assert result.request.volatility == 0.3
    # Scenario Greeks belong to the same current spot, not the display-grid center.
    assert result.scenarios[0].greeks.delta == pytest.approx(
        (
            reference_value(data, spot=107.01, days=70, iv=0.35)
            - reference_value(data, spot=106.99, days=70, iv=0.35)
        )
        / 0.02,
        rel=2e-7,
    )


def test_seeded_portfolios_are_deterministic_permutation_invariant_and_additive():
    random = Random(676501)
    for _ in range(12):
        items = [
            leg(
                random.choice(["call", "put"]),
                random.choice([-3, -1, 1, 2]),
                random.randint(70, 130),
                random.randint(0, 12),
                random.choice([1, 17, 100]),
            )
            for _ in range(5)
        ]
        items.append(leg("underlying", random.choice([-31, 31]), None, 95))
        data = request(items, days=120)
        data.update(rate=0.03, dividend_yield=0.01, volatility=0.4)
        data["strategy"]["entry_fee_per_contract"] = 0.7
        data["scenarios"] = [dict(name="Stress", elapsed_days=30, iv_shift_pp=5)]
        original = deepcopy(data)
        result = analyze_options(data)
        assert result.model_dump_json() == analyze_options(data).model_dump_json()
        assert data == original
        cost = fsum(
            i["quantity"] * i["multiplier"] * i["entry_premium"] for i in items
        ) + 0.7 * sum(abs(i["quantity"]) for i in items if i["kind"] != "underlying")
        assert result.summary.net_entry_cost == pytest.approx(cost)
        assert result.summary.theoretical_value_today == pytest.approx(
            reference_value(data), abs=2e-6, rel=2e-9
        )
        for spot, pnl in zip(result.spot_grid, result.expiry_pnl):
            terminal = fsum(
                i["quantity"]
                * i["multiplier"]
                * (
                    spot
                    if i["kind"] == "underlying"
                    else max(
                        spot - i["strike"]
                        if i["kind"] == "call"
                        else i["strike"] - spot,
                        0,
                    )
                )
                for i in items
            )
            assert pnl == pytest.approx(terminal - cost)
        random.shuffle(data["strategy"]["legs"])
        permuted = analyze_options(data)
        assert permuted.summary == result.summary
        assert permuted.greeks == result.greeks
        assert permuted.today_pnl == result.today_pnl
        assert permuted.expiry_pnl == result.expiry_pnl
        assert permuted.scenarios == result.scenarios


def heterogeneous_request():
    data = request(
        [
            leg("call", 2, 103.125, 7.125, 100, implied_volatility=0.17),
            leg("put", -3, 91.375, 4.375, 17, implied_volatility=0.61),
            leg("call", -1, 117.625, 2.125, 50),
            leg("underlying", -11, None, 98.125),
            leg("put", 5, 100.125, 99, 1000, implied_volatility=0, enabled=False),
        ],
        days=180,
    )
    data.update(volatility=0.35, rate=0.04, dividend_yield=0.02)
    data["strategy"]["entry_fee_per_contract"] = 1.75
    return data


def independent_greeks(data, days=None, shift=0):
    days = data["strategy"]["days_to_expiry"] if days is None else days
    spot = data["spot"]

    def value(**kwargs):
        return reference_value(data, days=days, iv_shift_pp=shift, **kwargs)

    h = 0.01
    up, down, base = value(spot=spot + h), value(spot=spot - h), value()
    result = dict(delta=(up - down) / (2 * h), gamma=(up - 2 * base + down) / h**2)
    h = 0.02
    result["theta"] = (
        reference_value(data, days=days - h, iv_shift_pp=shift)
        - reference_value(data, days=days + h, iv_shift_pp=shift)
    ) / (2 * h)
    h = 1e-4
    result["vega"] = (
        reference_value(data, days=days, iv_shift_pp=shift + h * 100)
        - reference_value(data, days=days, iv_shift_pp=shift - h * 100)
    ) / (2 * h * 100)
    up_data, down_data = deepcopy(data), deepcopy(data)
    up_data["rate"] += h
    down_data["rate"] -= h
    result["rho"] = (
        reference_value(up_data, days=days, iv_shift_pp=shift)
        - reference_value(down_data, days=days, iv_shift_pp=shift)
    ) / (2 * h * 100)
    return result


def test_two_point_expiry_curve_contains_exact_strike_and_isolated_root():
    data = request([leg("call", 1, 100, 5, 100)])
    data["spot_grid"] = [50, 150]
    result = analyze_options(data)
    assert result.expiry_pnl == [-500, 4500]
    assert [p.model_dump() for p in result.expiry_curve] == [
        dict(spot=50, pnl=-500),
        dict(spot=100, pnl=-500),
        dict(spot=105, pnl=0),
        dict(spot=150, pnl=4500),
    ]


@pytest.mark.parametrize("domain", [[50, 150], [87, 115], [0, 80], [122, 200]])
def test_arbitrary_expiry_knots_roots_and_interpolation_on_zoomed_domains(domain):
    data = request(
        [
            leg("put", 1, 80.125, 1, 100),
            leg("put", -1, 90.875, 3, 100),
            leg("call", -1, 110.625, 3, 100),
            leg("call", 1, 121.375, 1, 100),
            leg("call", 99, 100, 100, enabled=False),
        ],
    )
    data["spot_grid"] = domain
    data["strategy"]["entry_fee_per_contract"] = 2.5
    result = analyze_options(data)
    knots = [80.125, 86.975, 90.875, 110.625, 114.525, 121.375]
    expected_spots = sorted(
        set(domain + [s for s in knots if domain[0] <= s <= domain[-1]])
    )
    assert [p.spot for p in result.expiry_curve] == expected_spots
    assert result.summary.breakevens == pytest.approx([86.975, 114.525])
    assert result.summary.max_profit == 390
    assert result.summary.max_loss == 685
    for left, right in zip(result.expiry_curve, result.expiry_curve[1:]):
        for fraction in [0, 0.137, 0.5, 0.923, 1]:
            spot = left.spot + fraction * (right.spot - left.spot)
            expected = reference_value(data, spot=spot, days=0) + 390
            interpolated = left.pnl + fraction * (right.pnl - left.pnl)
            assert interpolated == pytest.approx(expected, abs=2e-10)
    assert len(result.expiry_pnl) == len(domain)


def test_heterogeneous_iv_marks_leg_cash_flow_sums_and_independent_greeks():
    data = heterogeneous_request()
    original = deepcopy(data)
    result = analyze_options(data)
    assert [row.leg_index for row in result.legs] == list(range(5))
    assert [row.resolved_implied_volatility for row in result.legs] == [
        0.17,
        0.61,
        0.35,
        None,
        0,
    ]
    for row, item in zip(result.legs, data["strategy"]["legs"]):
        enabled = item.get("enabled", True)
        assert row.enabled is enabled
        gross = (
            item["quantity"] * item["multiplier"] * item["entry_premium"]
            if enabled
            else 0
        )
        fee = (
            abs(item["quantity"]) * 1.75
            if enabled and item["kind"] != "underlying"
            else 0
        )
        assert row.gross_entry_cost == gross
        assert row.entry_fees == fee
        assert row.net_entry_cost == gross + fee
        single = deepcopy(data)
        single["strategy"]["legs"] = [item]
        expected_value = reference_value(single)
        assert row.theoretical_value_today == pytest.approx(expected_value, abs=2e-6)
        assert row.pnl_today == pytest.approx(expected_value - gross - fee, abs=2e-6)
        if enabled:
            for key, value in independent_greeks(single).items():
                assert getattr(row.greeks, key) == pytest.approx(
                    value, rel=5e-6, abs=2e-6
                )
        else:
            assert set(row.greeks.model_dump().values()) == {0}
    for key in [
        "gross_entry_cost",
        "entry_fees",
        "net_entry_cost",
        "theoretical_value_today",
        "pnl_today",
    ]:
        assert fsum(getattr(row, key) for row in result.legs) == pytest.approx(
            getattr(result.summary, key)
        )
    for key, value in independent_greeks(data).items():
        assert getattr(result.greeks, key) == pytest.approx(value, rel=5e-6, abs=2e-6)
        assert fsum(getattr(row.greeks, key) for row in result.legs) == pytest.approx(
            getattr(result.greeks, key)
        )
    assert data == original


@pytest.mark.parametrize("days,shift", [(180, 5), (130, -10), (0, 12)])
def test_parallel_scenario_shifts_preserve_leg_skew_costs_and_declared_base(
    days, shift
):
    data = heterogeneous_request()
    data["scenarios"] = [
        dict(name="Parallel", elapsed_days=180 - days, iv_shift_pp=shift)
    ]
    result = analyze_options(data)
    scenario = result.scenarios[0]
    assert scenario.volatility == pytest.approx(0.35 + shift / 100)
    assert scenario.remaining_days == days
    assert scenario.pnl == pytest.approx(
        [
            reference_value(data, spot=s, days=days, iv_shift_pp=shift)
            - result.summary.net_entry_cost
            for s in result.spot_grid
        ],
        abs=2e-6,
    )
    if days:
        for key, value in independent_greeks(data, days=days, shift=shift).items():
            assert getattr(scenario.greeks, key) == pytest.approx(
                value, rel=5e-6, abs=2e-6
            )
    else:
        assert scenario.pnl == result.expiry_pnl
        assert set(scenario.greeks.model_dump().values()) == {None}
    assert (
        result.request.strategy.legs
        == OptionsAnalysisRequest.model_validate(data).strategy.legs
    )


@pytest.mark.parametrize("axis", ["elapsed_days", "iv_shift_pp"])
def test_surface_cells_against_independent_integrals_with_fixed_cash_flows(axis):
    data = heterogeneous_request()
    data["surface"] = dict(
        axis=axis,
        spots=[0, 83.25, 100, 137.125, 200],
        steps=[0, 17.5, 90, 180] if axis == "elapsed_days" else [-17, -5, 0, 23],
    )
    data["spot_grid"] = data["surface"]["spots"]
    original = deepcopy(data)
    result = analyze_options(data)
    surface = result.surface
    assert surface is not None
    assert surface.axis == axis
    assert surface.spots == data["surface"]["spots"]
    assert surface.steps == data["surface"]["steps"]
    assert len(surface.pnl) == len(surface.steps)
    for step, row in zip(surface.steps, surface.pnl):
        days = 180 - step if axis == "elapsed_days" else 180
        shift = step if axis == "iv_shift_pp" else 0
        assert len(row) == len(surface.spots)
        assert row == pytest.approx(
            [
                reference_value(data, spot=s, days=days, iv_shift_pp=shift)
                - result.summary.net_entry_cost
                for s in surface.spots
            ],
            abs=2e-6,
        )
        if step == 0:
            assert row == result.today_pnl
        if axis == "elapsed_days" and step == 180:
            assert row == result.expiry_pnl
    assert data == original


@pytest.mark.parametrize(
    "days,zero_iv,disabled", [(0, False, False), (180, True, False), (180, True, True)]
)
def test_perleg_null_components_propagate_only_when_active(days, zero_iv, disabled):
    data = request(
        [
            leg("underlying", 25, None, 99),
            leg(
                "call",
                1,
                101,
                5,
                100,
                implied_volatility=0 if zero_iv else 0.2,
                enabled=not disabled,
            ),
        ],
        days=days,
    )
    data["strategy"]["entry_fee_per_contract"] = 2
    result = analyze_options(data)
    assert result.legs[0].greeks.model_dump() == dict(
        delta=25, gamma=0, theta=0, vega=0, rho=0
    )
    assert set(result.legs[1].greeks.model_dump().values()) == (
        {0} if disabled else {None}
    )
    assert (
        result.greeks == result.legs[0].greeks
        if disabled
        else set(result.greeks.model_dump().values()) == {None}
    )
    assert result.summary.entry_fees == (0 if disabled else 2)
    assert fsum(row.pnl_today for row in result.legs) == pytest.approx(
        result.summary.pnl_today
    )

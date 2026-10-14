"""Bounded, provider-free BSM marks and exact piecewise-linear expiry P&L.

P&L is signed strategy value minus fixed premiums and entry fees, without
financing, dividends received on stock, exit fees, slippage or assignment.
Option Greeks are not reported at expiry or zero IV; undefined components
propagate as null rather than treating an unknown exposure as zero.
"""

from math import erfc, exp, fsum, isfinite, log, pi, sqrt
from typing import Any

from .models import (
    OptionLeg,
    OptionsAnalysis,
    OptionsAnalysisRequest,
    OptionsGreeks,
    OptionsScenarioAnalysis,
    OptionsSummary,
    ZeroInterval,
)

_GREEKS = ("delta", "gamma", "theta", "vega", "rho")
_LIMITATIONS = (
    "Manual inputs, not a provider snapshot or historical options execution.",
    "European cash-settled BSM with constant IV and continuous dividend yield; "
    "no American valuation or assignment model.",
    "P&L excludes financing, stock dividend cash flows, exit fees and slippage.",
)


def _cdf(x: float) -> float:
    return 0.5 * erfc(-x / sqrt(2))


def terminal_payoff(leg: OptionLeg, spot: float) -> float:
    """Unsigned per-unit intrinsic value, separate from all model marks."""
    if leg.kind == "underlying":
        return spot
    assert leg.strike is not None
    if leg.kind == "call":
        return max(spot - leg.strike, 0)
    return max(leg.strike - spot, 0)


def _mark_and_greeks(
    leg: OptionLeg, spot: float, days: float, iv: float, rate: float, yield_: float
) -> tuple[float, OptionsGreeks]:
    if leg.kind == "underlying":
        return spot, OptionsGreeks(delta=1, gamma=0, theta=0, vega=0, rho=0)
    assert leg.strike is not None
    unknown = OptionsGreeks(**dict.fromkeys(_GREEKS))
    t = days / 365
    if t == 0:
        return terminal_payoff(leg, spot), unknown
    dq, dr = exp(-yield_ * t), exp(-rate * t)
    discounted_spot, discounted_strike = spot * dq, leg.strike * dr
    if iv == 0 or iv * sqrt(t) == 0:
        intrinsic = discounted_spot - discounted_strike
        return max(intrinsic if leg.kind == "call" else -intrinsic, 0), unknown
    if spot == 0:
        return (0 if leg.kind == "call" else discounted_strike), unknown
    root_t = sqrt(t)
    width = iv * root_t
    d1 = (log(spot) - log(leg.strike) + (rate - yield_) * t) / width + width / 2
    d2 = d1 - width
    density = exp(-d1 * d1 / 2) / sqrt(2 * pi)
    if leg.kind == "call":
        price = discounted_spot * _cdf(d1) - discounted_strike * _cdf(d2)
        delta = dq * _cdf(d1)
        theta_carry = yield_ * discounted_spot * _cdf(
            d1
        ) - rate * discounted_strike * _cdf(d2)
        rho = t * discounted_strike * _cdf(d2) / 100
    else:
        price = discounted_strike * _cdf(-d2) - discounted_spot * _cdf(-d1)
        delta = -dq * _cdf(-d1)
        theta_carry = rate * discounted_strike * _cdf(
            -d2
        ) - yield_ * discounted_spot * _cdf(-d1)
        rho = -t * discounted_strike * _cdf(-d2) / 100
    gamma_denominator = spot * width
    values = dict(
        delta=delta,
        gamma=dq * density / gamma_denominator if gamma_denominator else None,
        theta=(-discounted_spot * density * iv / (2 * root_t) + theta_carry) / 365,
        vega=discounted_spot * density * root_t / 100,
        rho=rho,
    )
    greeks = OptionsGreeks(
        **{k: v if v is None or isfinite(v) else None for k, v in values.items()}
    )
    return max(price, 0), greeks


def _value_and_greeks(
    legs: list[OptionLeg],
    spot: float,
    days: float,
    iv: float,
    rate: float,
    yield_: float,
) -> tuple[float, OptionsGreeks]:
    values: list[float] = []
    exposures: dict[str, list[float | None]] = {k: [] for k in _GREEKS}
    for leg in legs:
        value, greeks = _mark_and_greeks(leg, spot, days, iv, rate, yield_)
        weight = leg.quantity * leg.multiplier
        values.append(weight * value)
        for key in _GREEKS:
            greek = getattr(greeks, key)
            weighted = greek * weight if greek is not None else None
            exposures[key].append(
                weighted if weighted is None or isfinite(weighted) else None
            )
    aggregate: dict[str, float | None] = {}
    for key, components in exposures.items():
        if any(c is None for c in components):
            aggregate[key] = None
        else:
            # Scale first so finite, individually large Greeks cannot overflow fsum.
            finite = [c for c in components if c is not None]
            scale = max((abs(c) for c in finite), default=0)
            total = scale * fsum(c / scale for c in finite) if scale else 0.0
            aggregate[key] = total if isfinite(total) else None
    return fsum(values), OptionsGreeks(**aggregate)


def _expiry_geometry(
    legs: list[OptionLeg], entry_cost: float
) -> tuple[float | None, float | None, list[float], list[ZeroInterval]]:
    knots = sorted({0.0, *(leg.strike for leg in legs if leg.strike is not None)})
    values = [
        fsum(
            [leg.quantity * leg.multiplier * terminal_payoff(leg, s) for leg in legs]
            + [-entry_cost]
        )
        for s in knots
    ]
    intervals: list[ZeroInterval] = []
    roots = {s for s, value in zip(knots, values) if value == 0}
    final_slope = 0
    for i, (start, value) in enumerate(zip(knots, values)):
        end = knots[i + 1] if i + 1 < len(knots) else None
        slope = sum(_slope_after(leg, start) for leg in legs)
        final_slope = slope
        if slope == 0 and value == 0:
            if intervals and intervals[-1].end == start:
                intervals[-1].end = end
            else:
                intervals.append(ZeroInterval(start=start, end=end))
        elif slope:
            root = start - value / slope
            if root > start and (end is None or root < end):
                roots.add(root)
    isolated = sorted(
        s
        for s in roots
        if not any(z.start <= s and (z.end is None or s <= z.end) for z in intervals)
    )
    profit = None if final_slope > 0 else max(0.0, max(values))
    loss = None if final_slope < 0 else max(0.0, -min(values))
    return profit, loss, isolated, intervals


def _slope_after(leg: OptionLeg, spot: float) -> int:
    weight = leg.quantity * leg.multiplier
    if leg.kind == "underlying":
        return weight
    assert leg.strike is not None
    if leg.kind == "call":
        return weight if spot >= leg.strike else 0
    return -weight if spot < leg.strike else 0


def analyze_options(
    request: OptionsAnalysisRequest | dict[str, Any],
) -> OptionsAnalysis:
    """One canonical entrypoint; validate even model instances before computation.

    Use ``result.model_dump(mode="json")`` / ``model_dump_json()`` at a worker
    or HTTP boundary. ``OptionsAnalysisRequest.model_json_schema()`` is the
    serialized input contract; ``OptionsAnalysis.model_json_schema()`` is output.
    No providers, filesystem, network, arbitrary imports or execution callbacks.
    """
    submitted = OptionsAnalysisRequest.model_validate(
        request.model_dump() if isinstance(request, OptionsAnalysisRequest) else request
    )
    legs = [leg for leg in submitted.strategy.legs if leg.enabled]
    gross_cost = fsum(leg.quantity * leg.multiplier * leg.entry_premium for leg in legs)
    fees = fsum(
        abs(leg.quantity) * submitted.strategy.entry_fee_per_contract
        for leg in legs
        if leg.kind != "underlying"
    )
    entry_cost = fsum([gross_cost, fees])
    days = submitted.strategy.days_to_expiry

    def value_at(spot: float, days: float, iv: float) -> tuple[float, OptionsGreeks]:
        return _value_and_greeks(
            legs, spot, days, iv, submitted.rate, submitted.dividend_yield
        )

    today_value, greeks = value_at(submitted.spot, days, submitted.volatility)
    profit, loss, roots, intervals = _expiry_geometry(legs, entry_cost)
    scenarios = []
    for scenario in submitted.scenarios:
        remaining = days - scenario.elapsed_days
        iv = submitted.volatility + scenario.iv_shift_pp / 100
        _, scenario_greeks = value_at(submitted.spot, remaining, iv)
        scenarios.append(
            OptionsScenarioAnalysis(
                name=scenario.name,
                elapsed_days=scenario.elapsed_days,
                remaining_days=remaining,
                volatility=iv,
                pnl=[
                    value_at(s, remaining, iv)[0] - entry_cost
                    for s in submitted.spot_grid
                ],
                greeks=scenario_greeks,
            )
        )
    warnings = list(_LIMITATIONS)
    if any(
        getattr(g, k) is None
        for g in [greeks, *(s.greeks for s in scenarios)]
        for k in _GREEKS
    ):
        warnings.append(
            "Null Greeks are undefined/not reported at expiry, zero IV or a numerical "
            "singularity; a null leg exposure makes that strategy Greek null."
        )
    today_marks = [value_at(s, days, submitted.volatility) for s in submitted.spot_grid]
    return OptionsAnalysis(
        request=submitted,
        summary=OptionsSummary(
            gross_entry_cost=gross_cost,
            entry_fees=fees,
            net_entry_cost=entry_cost,
            entry_debit=max(entry_cost, 0),
            entry_credit=max(-entry_cost, 0),
            theoretical_value_today=today_value,
            pnl_today=today_value - entry_cost,
            max_profit=profit,
            max_loss=loss,
            profit_unbounded=profit is None,
            loss_unbounded=loss is None,
            breakevens=roots,
            zero_intervals=intervals,
        ),
        spot_grid=submitted.spot_grid,
        today_pnl=[value - entry_cost for value, _ in today_marks],
        expiry_pnl=[
            fsum(
                [
                    leg.quantity * leg.multiplier * terminal_payoff(leg, s)
                    for leg in legs
                ]
            )
            - entry_cost
            for s in submitted.spot_grid
        ],
        scenarios=scenarios,
        greeks=greeks,
        greeks_grid=[exposure for _, exposure in today_marks],
        warnings=warnings,
    )

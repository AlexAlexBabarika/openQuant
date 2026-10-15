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
    OptionsExpiryPoint,
    OptionsGreeks,
    OptionsHorizon,
    OptionsLegHorizon,
    OptionsLegAnalysis,
    OptionsScenarioAnalysis,
    OptionsScenarioLegAnalysis,
    OptionsSurfaceAnalysis,
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


def terminal_pnl(legs: list[OptionLeg], spot: float, entry_cost: float) -> float:
    """Combine affine coefficients about a nearby strike to preserve flat payoffs."""
    anchor = min(
        (leg.strike for leg in legs if leg.strike is not None),
        key=lambda strike: abs(spot - strike),
        default=0.0,
    )
    slope = 0
    constants = [-entry_cost]
    for leg in legs:
        weight = leg.quantity * leg.multiplier
        if leg.kind == "underlying":
            slope += weight
            constants.append(weight * anchor)
        else:
            assert leg.strike is not None
            if leg.kind == "call" and spot >= leg.strike:
                slope += weight
                constants.append(weight * (anchor - leg.strike))
            elif leg.kind == "put" and spot < leg.strike:
                slope -= weight
                constants.append(weight * (leg.strike - anchor))
    return fsum([slope * (spot - anchor), *constants])


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
    entry_costs: list[float],
    iv_shift_pp: float = 0,
    leg_days: list[float] | None = None,
) -> tuple[float, OptionsGreeks, float]:
    values: list[float] = []
    exposures: dict[str, list[float | None]] = {k: [] for k in _GREEKS}
    for index, leg in enumerate(legs):
        resolved_iv = iv if leg.implied_volatility is None else leg.implied_volatility
        value, greeks = _mark_and_greeks(
            leg,
            spot,
            days if leg_days is None else leg_days[index],
            resolved_iv + iv_shift_pp / 100,
            rate,
            yield_,
        )
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
    return (
        fsum(values),
        OptionsGreeks(**aggregate),
        fsum(value - cost for value, cost in zip(values, entry_costs)),
    )


def _expiry_geometry(
    legs: list[OptionLeg], entry_cost: float
) -> tuple[float | None, float | None, list[float], list[ZeroInterval]]:
    knots = sorted({0.0, *(leg.strike for leg in legs if leg.strike is not None)})
    values = [terminal_pnl(legs, s, entry_cost) for s in knots]
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
    strategy = submitted.strategy
    days = strategy.first_expiry_days
    active_days = [strategy.leg_days(leg) for leg in legs]
    option_days = [strategy.leg_days(leg) for leg in legs if leg.kind != "underlying"]
    mixed = len(set(option_days)) > 1

    def horizon_legs(elapsed: float) -> list[OptionsLegHorizon]:
        return [
            OptionsLegHorizon(
                leg_index=i,
                remaining_days=None
                if leg.kind == "underlying"
                else max(0, strategy.leg_days(leg) - elapsed),
                state="disabled"
                if not leg.enabled
                else "underlying"
                if leg.kind == "underlying"
                else "expiry_intrinsic"
                if strategy.leg_days(leg) == elapsed
                else "model_mark",
            )
            for i, leg in enumerate(strategy.legs)
        ]

    leg_results = []
    for index, leg in enumerate(submitted.strategy.legs):
        gross = leg.quantity * leg.multiplier * leg.entry_premium if leg.enabled else 0
        fee = (
            abs(leg.quantity) * submitted.strategy.entry_fee_per_contract
            if leg.enabled and leg.kind != "underlying"
            else 0
        )
        cost = fsum([gross, fee])
        value, exposure, pnl = _value_and_greeks(
            [leg] if leg.enabled else [],
            submitted.spot,
            strategy.leg_days(leg),
            submitted.volatility,
            submitted.rate,
            submitted.dividend_yield,
            [cost] if leg.enabled else [],
        )
        leg_results.append(
            OptionsLegAnalysis(
                leg_index=index,
                enabled=leg.enabled,
                resolved_days_to_expiry=None
                if leg.kind == "underlying"
                else strategy.leg_days(leg),
                resolved_implied_volatility=(
                    None
                    if leg.kind == "underlying"
                    else (
                        submitted.volatility
                        if leg.implied_volatility is None
                        else leg.implied_volatility
                    )
                ),
                gross_entry_cost=gross,
                entry_fees=fee,
                net_entry_cost=cost,
                theoretical_value_today=value,
                pnl_today=pnl,
                greeks=exposure,
            )
        )
    gross_cost = fsum(leg.gross_entry_cost for leg in leg_results)
    fees = fsum(leg.entry_fees for leg in leg_results)
    entry_cost = fsum(leg.net_entry_cost for leg in leg_results)
    entry_costs = [leg.net_entry_cost for leg in leg_results if leg.enabled]

    def value_at(
        spot: float, elapsed: float, shift: float = 0
    ) -> tuple[float, OptionsGreeks, float]:
        return _value_and_greeks(
            legs,
            spot,
            days,
            submitted.volatility,
            submitted.rate,
            submitted.dividend_yield,
            entry_costs,
            shift,
            [max(0, d - elapsed) for d in active_days],
        )

    today_value, greeks, today_pnl = value_at(submitted.spot, 0)
    profit, loss, roots, intervals = (
        (None, None, [], []) if mixed else _expiry_geometry(legs, entry_cost)
    )
    vertices = sorted(
        {
            submitted.spot_grid[0],
            submitted.spot_grid[-1],
            *(
                leg.strike
                for leg in legs
                if leg.strike is not None
                and submitted.spot_grid[0] <= leg.strike <= submitted.spot_grid[-1]
            ),
            *(
                s
                for s in roots
                if submitted.spot_grid[0] <= s <= submitted.spot_grid[-1]
            ),
        }
    )

    def expiry_pnl_at(spot: float) -> float:
        return terminal_pnl(legs, spot, entry_cost)

    scenarios = []
    for scenario in submitted.scenarios:
        remaining = days - scenario.elapsed_days
        iv = submitted.volatility + scenario.iv_shift_pp / 100
        _, scenario_greeks, _ = value_at(
            submitted.spot, scenario.elapsed_days, scenario.iv_shift_pp
        )
        scenario_legs = []
        for horizon, leg, result in zip(
            horizon_legs(scenario.elapsed_days), strategy.legs, leg_results
        ):
            value, exposure, pnl = _value_and_greeks(
                [leg] if leg.enabled else [],
                submitted.spot,
                max(0, strategy.leg_days(leg) - scenario.elapsed_days),
                submitted.volatility,
                submitted.rate,
                submitted.dividend_yield,
                [result.net_entry_cost] if leg.enabled else [],
                scenario.iv_shift_pp,
            )
            scenario_legs.append(
                OptionsScenarioLegAnalysis(
                    **horizon.model_dump(),
                    theoretical_value=value,
                    pnl=pnl,
                    greeks=exposure,
                )
            )
        scenarios.append(
            OptionsScenarioAnalysis(
                name=scenario.name,
                elapsed_days=scenario.elapsed_days,
                remaining_days=remaining,
                volatility=iv,
                pnl=[
                    value_at(s, scenario.elapsed_days, scenario.iv_shift_pp)[2]
                    for s in submitted.spot_grid
                ],
                greeks=scenario_greeks,
                legs=scenario_legs,
            )
        )
    warnings = list(_LIMITATIONS)
    if mixed:
        warnings.append(
            "Mixed expiries: horizon P&L settles front legs at first expiry spot and model-marks later legs. Exact terminal curve, maximum profit/loss and expiry breakevens are unavailable; use lifecycle for through-expiry paths."
        )
    if any(
        getattr(g, k) is None
        for g in [greeks, *(s.greeks for s in scenarios)]
        for k in _GREEKS
    ):
        warnings.append(
            "Null Greeks are undefined/not reported at expiry, zero IV or a numerical "
            "singularity; a null leg exposure makes that strategy Greek null."
        )
    today_marks = [value_at(s, 0) for s in submitted.spot_grid]
    surface = None
    if submitted.surface is not None:
        config = submitted.surface
        surface = OptionsSurfaceAnalysis(
            axis=config.axis,
            spots=config.spots,
            steps=config.steps,
            pnl=[
                [
                    value_at(
                        s,
                        step if config.axis == "elapsed_days" else 0,
                        step if config.axis == "iv_shift_pp" else 0,
                    )[2]
                    for s in config.spots
                ]
                for step in config.steps
            ],
        )
    return OptionsAnalysis(
        request=submitted,
        summary=OptionsSummary(
            gross_entry_cost=gross_cost,
            entry_fees=fees,
            net_entry_cost=entry_cost,
            entry_debit=max(entry_cost, 0),
            entry_credit=max(-entry_cost, 0),
            theoretical_value_today=today_value,
            pnl_today=today_pnl,
            max_profit=profit,
            max_loss=loss,
            profit_unbounded=None if mixed else profit is None,
            loss_unbounded=None if mixed else loss is None,
            breakevens=roots,
            zero_intervals=intervals,
        ),
        spot_grid=submitted.spot_grid,
        today_pnl=[pnl for _, _, pnl in today_marks],
        expiry_pnl=[] if mixed else [expiry_pnl_at(s) for s in submitted.spot_grid],
        expiry_curve=[
            OptionsExpiryPoint(spot=s, pnl=expiry_pnl_at(s))
            for s in vertices
            if not mixed
        ],
        horizon=OptionsHorizon(
            kind="mixed_expiry" if mixed else "single_expiry",
            first_expiry_days=days,
            last_expiry_days=max(option_days, default=days),
            elapsed_days=days,
            exact_terminal_available=not mixed,
            legs=horizon_legs(days),
        ),
        horizon_pnl=[
            value_at(s, days)[2] if mixed else expiry_pnl_at(s)
            for s in submitted.spot_grid
        ],
        legs=leg_results,
        surface=surface,
        scenarios=scenarios,
        greeks=greeks,
        greeks_grid=[exposure for _, exposure, _ in today_marks],
        warnings=warnings,
    )

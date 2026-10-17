"""Hypothetical cash-settlement and observation-constrained hedge ledgers."""

from __future__ import annotations

from bisect import bisect_left
from math import exp, fsum, isfinite, sqrt
from random import Random
from typing import Any, Literal

from .analytics import _value_and_greeks, analyze_options, terminal_payoff
from .models import OptionsAnalysisRequest, OptionsGreeks
from .research_models import (
    HedgeAttribution,
    HedgeRequest,
    HedgeResponse,
    HedgeStep,
    LifecycleLegMark,
    LifecycleRequest,
    LifecycleResponse,
    LifecycleStep,
    PathPoint,
    SettlementObservation,
    SuppliedPath,
)

_ZERO = dict(delta=0, gamma=0, theta=0, vega=0, rho=0)
_WARNINGS = [
    "Hypothetical European cash settlement only; not historical execution or American assignment.",
    "Expiry spots between path observations use linear spot interpolation, not an observed price or a GBM bridge.",
    "Settlement cash is retained without interest or reinvestment. No financing, stock dividend cash flows or repeated entry fees; continuous yield only affects live BSM marks.",
]


def _observations(request: LifecycleRequest) -> list[PathPoint]:
    if isinstance(request.path, SuppliedPath):
        return request.path.points
    config = request.path
    rng = Random(config.seed)
    dt = config.horizon_days / config.steps / 365
    spot = request.analysis.spot
    points = [PathPoint(day=0, spot=spot)]
    for step in range(1, config.steps + 1):
        exponent = (
            config.annual_drift - config.annual_volatility**2 / 2
        ) * dt + config.annual_volatility * sqrt(dt) * rng.gauss(0, 1)
        try:
            next_spot = spot * exp(exponent)
        except OverflowError as exc:
            raise ValueError(
                "Synthetic path exceeds finite spot domain; change assumptions"
            ) from exc
        if not isfinite(next_spot) or not 0 < next_spot <= 1_000_000:
            raise ValueError(
                "Synthetic path spot outside (0, 1000000]; no clipping applied"
            )
        spot = next_spot
        points.append(
            PathPoint(day=config.horizon_days * step / config.steps, spot=spot)
        )
    return points


def _evaluate(request: LifecycleRequest) -> tuple[LifecycleResponse, set[float]]:
    analysis = request.analysis
    strategy = analysis.strategy
    observations = _observations(request)
    original = {point.day for point in observations}
    lookup = {point.day: point.spot for point in observations}
    days = [point.day for point in observations]
    settlements: list[SettlementObservation] = []
    for index, leg in enumerate(strategy.legs):
        if not leg.enabled or leg.kind == "underlying":
            continue
        expiry = strategy.leg_days(leg)
        pos = bisect_left(days, expiry)
        if pos < len(days) and days[pos] == expiry:
            left = right = observations[pos]
            spot = left.spot
            label: Literal["supplied", "synthetic", "linear_interpolation"] = (
                request.path.source
            )
        else:
            left, right = observations[pos - 1], observations[pos]
            fraction = (expiry - left.day) / (right.day - left.day)
            spot = left.spot + fraction * (right.spot - left.spot)
            label = "linear_interpolation"
        lookup[expiry] = spot
        intrinsic = terminal_payoff(leg, spot)
        settlements.append(
            SettlementObservation(
                leg_index=index,
                day=expiry,
                spot=spot,
                observation=label,
                left_day=left.day,
                right_day=right.day,
                intrinsic_per_unit=intrinsic,
                signed_cash_flow=leg.quantity * leg.multiplier * intrinsic,
            )
        )
    settlements.sort(key=lambda item: (item.day, item.leg_index))
    compact = OptionsAnalysisRequest.model_validate(
        {
            **analysis.model_dump(),
            "spot_grid": [0, 1_000_000],
            "scenarios": [],
            "surface": None,
        }
    )
    entry = analyze_options(compact).summary.net_entry_cost
    path = [PathPoint(day=day, spot=lookup[day]) for day in sorted(lookup)]
    ledger = []
    for point in path:
        marks = []
        for index, leg in enumerate(strategy.legs):
            remaining = (
                None
                if leg.kind == "underlying"
                else max(0, strategy.leg_days(leg) - point.day)
            )
            if not leg.enabled:
                state = "disabled"
            elif leg.kind == "underlying":
                state = "underlying"
            elif strategy.leg_days(leg) <= point.day:
                state = "settled"
            else:
                state = "model_mark"
            value, greeks = 0.0, OptionsGreeks(**_ZERO)
            if state in ("underlying", "model_mark"):
                value, greeks, _ = _value_and_greeks(
                    [leg],
                    point.spot,
                    remaining or 0,
                    analysis.volatility,
                    analysis.rate,
                    analysis.dividend_yield,
                    [0],
                )
            marks.append(
                LifecycleLegMark(
                    leg_index=index,
                    state=state,
                    remaining_days=remaining,
                    value=value,
                    greeks=greeks,
                )
            )
        flow = fsum(
            item.signed_cash_flow for item in settlements if item.day == point.day
        )
        cumulative = fsum(
            item.signed_cash_flow for item in settlements if item.day <= point.day
        )
        remaining_value = fsum(mark.value for mark in marks)
        ledger.append(
            LifecycleStep(
                day=point.day,
                spot=point.spot,
                settlement_cash_flow=flow,
                cumulative_settlement_cash=cumulative,
                remaining_value=remaining_value,
                total_pnl=fsum([cumulative, remaining_value, -entry]),
                legs=marks,
            )
        )
    warnings = list(_WARNINGS)
    if request.path.source == "synthetic":
        warnings.append(
            "gbm_seeded_v1 uses Python Random(seed) MT19937 gauss draws and exact lognormal increments at equal times; deterministic for this generator/runtime version, synthetic and uncalibrated, not historical data."
        )
    return LifecycleResponse(
        request=request,
        path=path,
        settlements=settlements,
        ledger=ledger,
        net_entry_cost=entry,
        final_pnl=ledger[-1].total_pnl,
        warnings=warnings,
    ), original


def evaluate_lifecycle(request: LifecycleRequest | dict[str, Any]) -> LifecycleResponse:
    submitted = LifecycleRequest.model_validate(
        request.model_dump() if isinstance(request, LifecycleRequest) else request
    )
    return _evaluate(submitted)[0]


def simulate_hedge(request: HedgeRequest | dict[str, Any]) -> HedgeResponse:
    submitted = HedgeRequest.model_validate(
        request.model_dump() if isinstance(request, HedgeRequest) else request
    )
    lifecycle_request = LifecycleRequest(
        analysis=submitted.analysis, path=submitted.path
    )
    lifecycle, observations = _evaluate(lifecycle_request)
    policy, costs = submitted.policy, submitted.costs
    shares, cash, total_costs, trading_cash = 0.0, 0.0, 0.0, 0.0
    last_review: float | None = None
    ledger = []
    for index, step in enumerate(lifecycle.ledger):
        components = [mark.greeks.delta for mark in step.legs]
        delta = (
            None
            if any(value is None for value in components)
            else fsum(value for value in components if value is not None)
        )
        action, trade = "hold", 0.0
        final = index == len(lifecycle.ledger) - 1
        if final:
            trade = -shares
            action = "liquidate" if trade else "hold"
        elif policy.mode != "none" and step.day in observations:
            interval = 1.0 if policy.mode == "daily" else policy.interval_days
            due = (
                last_review is None
                or policy.mode == "delta_threshold"
                or step.day - last_review >= interval
            )
            if due:
                last_review = step.day
                if delta is None:
                    action = "undefined_delta"
                elif abs(delta) > policy.max_abs_shares:
                    action = "share_limit"
                elif (
                    policy.mode != "delta_threshold"
                    or abs(delta + shares) >= policy.delta_threshold
                ):
                    trade = -delta - shares
                    action = "rebalance" if trade else "hold"
        flow = -trade * step.spot
        cost = (
            (
                abs(trade) * (costs.per_share + step.spot * costs.slippage_bps / 10_000)
                + costs.fixed_per_trade
            )
            if trade
            else 0.0
        )
        shares = fsum([shares, trade])
        trading_cash = fsum([trading_cash, flow])
        total_costs = fsum([total_costs, cost])
        cash = fsum([trading_cash, -total_costs])
        value = shares * step.spot
        ledger.append(
            HedgeStep(
                day=step.day,
                spot=step.spot,
                strategy_delta=delta,
                hedge_shares=shares,
                traded_shares=trade,
                trade_cash_flow=flow,
                transaction_cost=cost,
                hedge_cash=cash,
                hedge_value=value,
                unhedged_pnl=step.total_pnl,
                hedged_pnl=fsum([step.total_pnl, cash, value]),
                action=action,
            )
        )
    total = ledger[-1].hedged_pnl
    return HedgeResponse(
        request=submitted,
        lifecycle=lifecycle,
        ledger=ledger,
        unhedged_final_pnl=lifecycle.final_pnl,
        hedged_final_pnl=total,
        attribution=HedgeAttribution(
            strategy_pnl=lifecycle.final_pnl,
            hedge_trading_pnl=trading_cash,
            transaction_costs=total_costs,
            total_pnl=total,
        ),
        warnings=[
            *lifecycle.warnings,
            "Trades occur only after current marks at original path observations; interpolated expiry points are settlement-only, never hedge signals. Sparse paths constrain daily/interval schedules.",
            "Daily/interval boundaries count elapsed days since the last scheduled observation review. Final hedge shares are liquidated without a new rebalance; every nonzero trade pays the declared costs.",
            "Undefined live delta or an excessive target skips the hedge trade; no clipping. Comparison uses the identical underlying path, without financing or dividends.",
        ],
    )

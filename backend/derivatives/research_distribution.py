"""Bounded, explicit-assumption lognormal terminal P&L quadrature."""

from __future__ import annotations

from math import erfc, exp, fsum, isfinite, log, pi, sqrt
from statistics import NormalDist
from typing import Any

from .analytics import analyze_options, terminal_pnl
from .models import OptionsAnalysisRequest
from .research_models import (
    DistributionRequest,
    DistributionResponse,
    PnlQuantile,
    ProbabilityBin,
    TerminalPayoffPoint,
    TerminalPriceBin,
)


def _cdf(z: float) -> float:
    return erfc(-z / sqrt(2)) / 2


def _positive_exp(value: float) -> float:
    try:
        result = exp(value)
    except OverflowError as exc:
        raise ValueError(
            "Terminal distribution overflows; reduce horizon/drift/volatility"
        ) from exc
    if not isfinite(result) or result <= 0:
        raise ValueError(
            "Terminal distribution has unrepresentable price tails; no clipping applied"
        )
    return result


def _tail_statistics(
    rows: list[tuple[float, float]], probabilities: list[float], alpha: float
) -> tuple[list[PnlQuantile], float]:
    ordered = sorted(rows)
    quantiles = []
    for probability in probabilities:
        cumulative = 0.0
        value = ordered[-1][0]
        for pnl, mass in ordered:
            cumulative += mass
            if cumulative >= probability:
                value = pnl
                break
        quantiles.append(PnlQuantile(probability=probability, pnl=value))
    remaining, pieces = alpha, []
    for pnl, mass in ordered:
        taken = min(remaining, mass)
        pieces.append(pnl * taken)
        remaining = max(0, remaining - taken)
        if remaining == 0:
            break
    return quantiles, fsum(pieces) / alpha


def analyze_distribution(
    request: DistributionRequest | dict[str, Any],
) -> DistributionResponse:
    submitted = DistributionRequest.model_validate(
        request.model_dump() if isinstance(request, DistributionRequest) else request
    )
    analysis = submitted.analysis
    drift = (
        analysis.rate - analysis.dividend_yield
        if submitted.measure == "risk_neutral"
        else submitted.annual_drift
    )
    assert drift is not None
    if not -2 <= drift <= 2:
        raise ValueError("Resolved terminal drift must be between -2 and 2")
    horizon = analysis.strategy.first_expiry_days
    time = horizon / 365
    sigma = analysis.volatility * sqrt(time)
    center = log(analysis.spot) + (drift - analysis.volatility**2 / 2) * time
    compact = OptionsAnalysisRequest.model_validate(
        {
            **analysis.model_dump(),
            "spot_grid": [0, 1_000_000],
            "scenarios": [],
            "surface": None,
        }
    )
    canonical = analyze_options(compact)
    entry = canonical.summary.net_entry_cost
    legs = [leg for leg in analysis.strategy.legs if leg.enabled]

    def pnl_at(spot: float) -> float:
        pnl = terminal_pnl(legs, spot, entry)
        if not isfinite(pnl):
            raise ValueError("Terminal payoff exceeds finite output domain")
        return pnl

    alpha = 1 - submitted.confidence
    probabilities = sorted({0.01, 0.05, alpha, 0.5, 0.95, 0.99})
    warnings = [
        "Terminal spot uses declared analysis.volatility independently of each leg's pricing IV; premiums and entry fees are fixed. European cash-settled common expiry only.",
        "Risk-neutral probabilities are model-implied, not real-world forecasts. User drift is an explicit uncalibrated assumption. No historical replay or investment advice.",
        "VaR=max(0,-lower-tail P&L quantile); ES=max(0,-mean worst (1-confidence) P&L), in USD. Fractional mass is allocated at an atom boundary; losses are positive numbers.",
    ]
    if sigma == 0:
        spot = (
            analysis.spot if time == 0 else analysis.spot * _positive_exp(drift * time)
        )
        pnl = pnl_at(spot)
        return DistributionResponse(
            request=submitted,
            resolved_annual_drift=drift,
            horizon_days=horizon,
            terminal_log_sigma=sigma,
            deterministic=True,
            bins=[ProbabilityBin(lower_pnl=pnl, upper_pnl=pnl, probability=1)],
            terminal_price_bins=[
                TerminalPriceBin(
                    lower_spot=spot,
                    upper_spot=spot,
                    representative_spot=spot,
                    probability=1,
                )
            ],
            terminal_payoff_curve=[TerminalPayoffPoint(spot=spot, pnl=pnl)],
            probability_positive_pnl=float(pnl > 0),
            expected_pnl=pnl,
            quantiles=[PnlQuantile(probability=p, pnl=pnl) for p in probabilities],
            confidence=submitted.confidence,
            value_at_risk=max(0, -pnl),
            expected_shortfall=max(0, -pnl),
            integration_method="deterministic",
            integration_points=1,
            truncated_probability=0,
            normalization_mass=1,
            numerical_error_estimate=0,
            warnings=warnings,
        )

    zmax = NormalDist().inv_cdf(1 - submitted.tail_probability / 2)
    retained = 1 - 2 * _cdf(-zmax)
    lower, upper = (
        _positive_exp(center - sigma * zmax),
        _positive_exp(center + sigma * zmax),
    )
    if not lower < upper:
        raise ValueError(
            "Terminal price range is below representable resolution; use zero volatility for an atom"
        )

    def quadrature(count: int) -> list[tuple[float, float]]:
        dz = 2 * zmax / count
        samples = []
        for index in range(count):
            z = -zmax + (index + 0.5) * dz
            mass = exp(-z * z / 2) * dz / sqrt(2 * pi)
            samples.append((pnl_at(_positive_exp(center + sigma * z)), mass))
        norm = fsum(mass for _, mass in samples)
        return [(pnl, mass / norm) for pnl, mass in samples]

    rows = quadrature(submitted.integration_points)
    mean = fsum(pnl * mass for pnl, mass in rows)
    coarse = quadrature(submitted.integration_points // 2)
    error = abs(mean - fsum(pnl * mass for pnl, mass in coarse))
    quantiles, tail_mean = _tail_statistics(rows, probabilities, alpha)
    lower_quantile = next(q.pnl for q in quantiles if q.probability == alpha)
    # A*S+B bounds absolute payoff and therefore omitted absolute first moment.
    slope_bound = fsum(
        abs(leg.quantity * leg.multiplier) for leg in legs if leg.kind != "put"
    )
    constant_bound = fsum(
        [abs(entry)]
        + [
            abs(leg.quantity * leg.multiplier) * (leg.strike or 0)
            for leg in legs
            if leg.kind == "put"
        ]
    )
    mean_spot = _positive_exp(log(analysis.spot) + drift * time)
    omitted_spot_moment = mean_spot * (_cdf(-zmax - sigma) + _cdf(sigma - zmax))
    omitted_absolute_bound = slope_bound * omitted_spot_moment + constant_bound * (
        1 - retained
    )
    if not isfinite(omitted_absolute_bound):
        raise ValueError("Omitted payoff first moment exceeds finite output domain")

    vertices = sorted(
        {
            lower,
            upper,
            *(
                leg.strike
                for leg in legs
                if leg.strike is not None and lower < leg.strike < upper
            ),
            *(root for root in canonical.summary.breakevens if lower < root < upper),
        }
    )
    payoff_curve = [
        TerminalPayoffPoint(spot=spot, pnl=pnl_at(spot)) for spot in vertices
    ]
    low_pnl, high_pnl = (
        min(row.pnl for row in payoff_curve),
        max(row.pnl for row in payoff_curve),
    )
    if low_pnl == high_pnl:
        bins = [ProbabilityBin(lower_pnl=low_pnl, upper_pnl=high_pnl, probability=1)]
    else:
        width = (high_pnl - low_pnl) / submitted.bins
        masses: list[list[float]] = [[] for _ in range(submitted.bins)]
        for pnl, mass in rows:
            bucket = min(submitted.bins - 1, max(0, int((pnl - low_pnl) / width)))
            masses[bucket].append(mass)
        bins = [
            ProbabilityBin(
                lower_pnl=low_pnl + i * width,
                upper_pnl=high_pnl
                if i == submitted.bins - 1
                else low_pnl + (i + 1) * width,
                probability=min(1, fsum(values)),
            )
            for i, values in enumerate(masses)
        ]
    price_bins = []
    for i in range(submitted.bins):
        left_z, right_z = (
            -zmax + 2 * zmax * i / submitted.bins,
            -zmax + 2 * zmax * (i + 1) / submitted.bins,
        )
        mass = (_cdf(right_z) - _cdf(left_z)) / retained
        price_bins.append(
            TerminalPriceBin(
                lower_spot=_positive_exp(center + sigma * left_z),
                upper_spot=_positive_exp(center + sigma * right_z),
                representative_spot=_positive_exp(
                    center + sigma * (left_z + right_z) / 2
                ),
                probability=mass,
            )
        )
    warnings.extend(
        [
            "Normal-domain midpoint quadrature: all P&L statistics and both histograms are conditional on the retained symmetric normal window, not full-distribution estimates. Price-bin probabilities are normalized masses, not densities; widths differ in price units.",
            f"Omitted probability={1 - retained:.12g}; analytic bound on omitted absolute P&L first moment <= {omitted_absolute_bound:.12g} USD. Small omitted mass does NOT imply small omitted expected P&L, especially at high volatility.",
            f"Absolute conditional-versus-full expected P&L difference is bounded by omitted absolute first moment + omitted probability * absolute conditional mean (excluding quadrature error): <= {omitted_absolute_bound + (1 - retained) * abs(mean):.12g} USD.",
            "numerical_error_estimate is absolute expected-P&L difference versus half-resolution quadrature, not a rigorous error bound or guarantee for probabilities, quantiles, VaR or ES. Increase resolution and vary truncation for sensitivity checks; tail-risk can be unreliable when 1-confidence is comparable to omitted mass or quadrature cell masses.",
            "Payoff vertices include displayed domain endpoints, in-domain strikes and isolated breakevens; straight segments are exact terminal P&L. No financing, dividend cash flows or exit costs.",
        ]
    )
    return DistributionResponse(
        request=submitted,
        resolved_annual_drift=drift,
        horizon_days=horizon,
        terminal_log_sigma=sigma,
        deterministic=False,
        bins=bins,
        terminal_price_bins=price_bins,
        terminal_payoff_curve=payoff_curve,
        probability_positive_pnl=min(1, fsum(mass for pnl, mass in rows if pnl > 0)),
        expected_pnl=mean,
        quantiles=quantiles,
        confidence=submitted.confidence,
        value_at_risk=max(0, -lower_quantile),
        expected_shortfall=max(0, -tail_mean),
        integration_method="normal_midpoint_quadrature_v1",
        integration_points=submitted.integration_points,
        truncated_probability=1 - retained,
        normalization_mass=retained,
        numerical_error_estimate=error,
        warnings=warnings,
    )

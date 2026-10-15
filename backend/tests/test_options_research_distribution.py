import json
from math import exp, log, sqrt
from statistics import NormalDist

import pytest
from pydantic import ValidationError

from backend.derivatives.research import analyze_distribution
from backend.derivatives.research_distribution import _positive_exp, _tail_statistics
from backend.derivatives.research_models import DistributionRequest
from backend.tests.test_options_research_finder import analysis

NORMAL = NormalDist()


def distribution_payload(legs=None, **updates):
    data = {
        "analysis": analysis(legs),
        "measure": "risk_neutral",
        "integration_points": 16384,
        "tail_probability": 1e-9,
        **updates,
    }
    data["analysis"]["strategy"]["days_to_expiry"] = 365
    return data


def test_standard_bsm_reference_expected_payoff_and_profit_probability():
    data = distribution_payload()
    result = analyze_distribution(data)
    expected_option_price = 100 * NORMAL.cdf(0.1) - 100 * NORMAL.cdf(-0.1)
    assert result.expected_pnl == pytest.approx(
        100 * expected_option_price - 500, abs=0.001
    )
    z_breakeven = (log(105 / 100) + 0.2**2 / 2) / 0.2
    assert result.probability_positive_pnl == pytest.approx(
        1 - NORMAL.cdf(z_breakeven), abs=0.0004
    )
    assert result.expected_shortfall == pytest.approx(500)  # lower-tail OTM atom
    assert result.value_at_risk == pytest.approx(500)
    assert result.terminal_log_sigma == 0.2
    assert result.integration_points == 16384
    assert result.normalization_mass == pytest.approx(1 - 1e-9)
    assert sum(row.probability for row in result.bins) == pytest.approx(1)
    assert sum(row.probability for row in result.terminal_price_bins) == pytest.approx(
        1
    )
    assert result == analyze_distribution(DistributionRequest.model_validate(data))


def test_independent_underlying_var_and_fractional_tail_expectation():
    data = distribution_payload(
        [{"kind": "underlying", "quantity": 1, "entry_premium": 100, "multiplier": 1}]
    )
    result = analyze_distribution(data)
    z = NORMAL.inv_cdf(0.05)
    expected_quantile = 100 * exp(-0.02 + 0.2 * z) - 100
    expected_es = 100 - 100 * NORMAL.cdf(z - 0.2) / 0.05
    assert result.value_at_risk == pytest.approx(-expected_quantile, abs=0.02)
    assert result.expected_shortfall == pytest.approx(expected_es, abs=0.003)
    assert result.expected_pnl == pytest.approx(0, abs=0.00001)
    assert result.expected_shortfall >= result.value_at_risk


def test_fractional_atom_boundary_is_not_dropped_or_fully_included():
    quantiles, lower_tail_mean = _tail_statistics(
        [(-100, 0.02), (-20, 0.08), (50, 0.9)], [0.05], 0.05
    )
    assert quantiles[0].pnl == -20
    assert lower_tail_mean == pytest.approx((-100 * 0.02 - 20 * 0.03) / 0.05)


def test_terminal_distribution_volatility_is_independent_of_heterogeneous_leg_iv():
    data = distribution_payload(
        [
            {
                "kind": "call",
                "quantity": 1,
                "strike": 100,
                "entry_premium": 5,
                "implied_volatility": 0.05,
            },
            {
                "kind": "put",
                "quantity": -2,
                "strike": 90,
                "entry_premium": 1,
                "implied_volatility": 0.9,
            },
        ]
    )
    a = analyze_distribution(data)
    data["analysis"]["strategy"]["legs"][0]["implied_volatility"] = 5
    data["analysis"]["strategy"]["legs"][1]["implied_volatility"] = 0
    b = analyze_distribution(data)
    assert a.expected_pnl == b.expected_pnl
    assert a.bins == b.bins and a.terminal_price_bins == b.terminal_price_bins
    assert (
        a.quantiles == b.quantiles
        and a.terminal_payoff_curve == b.terminal_payoff_curve
    )
    data["analysis"]["volatility"] = 0.4
    assert analyze_distribution(data).expected_pnl != b.expected_pnl


@pytest.mark.parametrize(
    "days,iv,drift,expected",
    [(0, 5, 1, -500), (365, 0, 0, -500), (365, 0, log(1.1), 500)],
)
def test_deterministic_atoms_expiry_and_exact_cash_pnl(days, iv, drift, expected):
    data = distribution_payload(measure="user_drift", annual_drift=drift)
    data["analysis"]["volatility"] = iv
    data["analysis"]["strategy"]["days_to_expiry"] = days
    result = analyze_distribution(data)
    assert result.deterministic and result.integration_method == "deterministic"
    assert result.expected_pnl == pytest.approx(expected)
    assert result.bins[0].lower_pnl == result.bins[0].upper_pnl == result.expected_pnl
    assert result.bins[0].probability == 1
    assert len(result.terminal_price_bins) == len(result.terminal_payoff_curve) == 1
    assert (
        result.terminal_price_bins[0].lower_spot
        == result.terminal_price_bins[0].upper_spot
    )
    assert result.integration_points == 1 and result.truncated_probability == 0
    assert result.expected_shortfall == pytest.approx(max(0, -expected))


def test_zero_profit_is_not_positive_and_zero_iv_is_not_fallback():
    data = distribution_payload(
        [
            {
                "kind": "call",
                "quantity": 1,
                "strike": 100,
                "entry_premium": 0,
                "implied_volatility": 0.8,
            }
        ]
    )
    data["analysis"]["volatility"] = 0
    result = analyze_distribution(data)
    assert result.expected_pnl == 0
    assert result.probability_positive_pnl == 0
    assert result.value_at_risk == result.expected_shortfall == 0


@pytest.mark.parametrize("volatility", [0, 0.2, 2])
@pytest.mark.parametrize("premium_change", [0, 2**-30, -(2**-30)])
def test_box_has_exact_constant_pnl_without_erasing_tiny_profit_or_loss(
    volatility, premium_change
):
    # C90 - C110 + P110 - P90 pays exactly 20 at every terminal spot.
    data = distribution_payload(
        [
            dict(kind="call", strike=90, quantity=1, entry_premium=20 + premium_change),
            dict(kind="call", strike=110, quantity=-1),
            dict(kind="put", strike=110, quantity=1),
            dict(kind="put", strike=90, quantity=-1),
        ]
    )
    data["analysis"]["volatility"] = volatility
    result = analyze_distribution(data)
    expected = -100 * premium_change
    assert result.expected_pnl == pytest.approx(expected, rel=1e-14, abs=0)
    assert result.probability_positive_pnl == float(expected > 0)
    assert result.value_at_risk == max(0, -expected)
    assert result.expected_shortfall == pytest.approx(
        max(0, -expected), rel=1e-14, abs=0
    )
    assert all(row.pnl == expected for row in result.quantiles)
    assert all(row.pnl == expected for row in result.terminal_payoff_curve)
    assert len(result.bins) == 1
    assert result.bins[0].lower_pnl == result.bins[0].upper_pnl == expected
    assert result.bins[0].probability == 1


def test_exact_payoff_vertices_and_price_bins_have_actual_domain_and_mass():
    data = distribution_payload(
        [
            {"kind": "call", "strike": 95.125, "quantity": 1, "entry_premium": 5},
            {"kind": "call", "strike": 110.875, "quantity": -1, "entry_premium": 2},
        ]
    )
    result = analyze_distribution(data)
    vertices = {row.spot: row.pnl for row in result.terminal_payoff_curve}
    assert vertices[95.125] == -300
    assert vertices[98.125] == 0
    assert vertices[110.875] == 1275
    assert (
        result.terminal_payoff_curve[0].spot == result.terminal_price_bins[0].lower_spot
    )
    assert (
        result.terminal_payoff_curve[-1].spot
        == result.terminal_price_bins[-1].upper_spot
    )
    assert len(result.terminal_price_bins) == 40
    widths = [row.upper_spot - row.lower_spot for row in result.terminal_price_bins]
    assert widths[0] != pytest.approx(widths[-1])
    for a, b in zip(result.terminal_payoff_curve, result.terminal_payoff_curve[1:]):
        spot = (a.spot + b.spot) / 2
        interpolated = (a.pnl + b.pnl) / 2
        exact = 100 * (max(spot - 95.125, 0) - max(spot - 110.875, 0)) - 300
        assert interpolated == pytest.approx(exact)


def test_high_volatility_tail_omission_warns_that_small_mass_is_not_small_moment():
    data = distribution_payload(
        [{"kind": "underlying", "quantity": 1, "entry_premium": 100, "multiplier": 1}],
        tail_probability=1e-6,
    )
    data["analysis"]["volatility"] = 5
    data["analysis"]["strategy"]["days_to_expiry"] = 3650
    result = analyze_distribution(data)
    # Most probability sits near zero, but nearly all E[S]=100 is in the omitted right tail.
    assert result.expected_pnl == pytest.approx(-100)
    assert result.truncated_probability == pytest.approx(1e-6)
    assert result.terminal_log_sigma == pytest.approx(5 * sqrt(10))
    assert any(
        "omitted absolute P&L first moment" in warning for warning in result.warnings
    )
    assert any("100.0001" in warning for warning in result.warnings)
    assert any("NOT imply" in warning for warning in result.warnings)
    json.dumps(result.model_dump(), allow_nan=False)


def test_large_terminal_price_domain_is_not_clipped_to_input_spot_limit():
    data = distribution_payload()
    data["analysis"].update(spot=1_000_000, volatility=2, rate=1, dividend_yield=-1)
    data["analysis"]["strategy"]["days_to_expiry"] = 3650
    result = analyze_distribution(data)
    assert result.terminal_price_bins[-1].upper_spot > 1_000_000
    assert result.resolved_annual_drift == 2
    assert all(
        row.lower_spot <= row.representative_spot <= row.upper_spot
        for row in result.terminal_price_bins
    )
    json.dumps(result.model_dump(), allow_nan=False)


@pytest.mark.parametrize(
    "change",
    [
        {"measure": "user_drift"},
        {"annual_drift": 0},
        {"confidence": 1},
        {"confidence": 0.5},
        {"bins": 101},
        {"integration_points": 16385},
        {"integration_points": 255},
        {"tail_probability": 1e-10},
    ],
)
def test_distribution_strict_invalid_bounds(change):
    data = distribution_payload()
    data.update(change)
    with pytest.raises(ValidationError):
        analyze_distribution(data)


def test_mixed_active_expiries_are_rejected_not_synthetic_terminal_pnl():
    data = distribution_payload(
        [
            {"kind": "call", "strike": 100, "quantity": 1, "days_to_expiry": 10},
            {"kind": "put", "strike": 100, "quantity": -1, "days_to_expiry": 20},
        ]
    )
    with pytest.raises(ValidationError, match="common option expiry"):
        analyze_distribution(data)


def test_revalidation_catches_mutated_model_instances():
    model = DistributionRequest.model_validate(distribution_payload())
    broken = model.model_copy(update={"integration_points": 1_000_000})
    with pytest.raises(ValidationError):
        analyze_distribution(broken)


@pytest.mark.parametrize("log_spot", [-1000, 1000])
def test_unrepresentable_tail_domain_is_rejected_not_clipped(log_spot):
    with pytest.raises(ValueError):
        _positive_exp(log_spot)

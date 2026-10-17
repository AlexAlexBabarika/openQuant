"""Multi-expiry time resolution, no invented settlement and legacy exactness."""

from copy import deepcopy
from math import fsum

import pytest
from pydantic import ValidationError

from backend.derivatives import OptionsAnalysisRequest, analyze_options, runner
from backend.tests.test_options_routes import client  # noqa: F401


def calendar_request():
    return dict(
        strategy=dict(
            template="calendar",
            days_to_expiry=60,
            legs=[
                dict(
                    kind="call",
                    quantity=-1,
                    strike=100,
                    entry_premium=3,
                    days_to_expiry=10,
                ),
                dict(kind="call", quantity=1, strike=100, entry_premium=5),
            ],
        ),
        spot=100,
        volatility=0.2,
        rate=0.03,
        spot_grid=[50, 100, 150],
        scenarios=[dict(name="Front expiry", elapsed_days=10)],
        surface=dict(axis="elapsed_days", spots=[50, 100, 150], steps=[0, 10]),
    )


def test_calendar_current_marks_and_greeks_use_each_leg_horizon():
    data = calendar_request()
    result = analyze_options(data)
    assert [leg.resolved_days_to_expiry for leg in result.legs] == [10, 60]
    separate = []
    for leg in data["strategy"]["legs"]:
        solo = deepcopy(data)
        solo["strategy"]["legs"] = [leg]
        separate.append(analyze_options(solo))
    assert result.summary.theoretical_value_today == pytest.approx(
        fsum(r.summary.theoretical_value_today for r in separate)
    )
    assert result.greeks.delta == pytest.approx(fsum(r.greeks.delta for r in separate))
    assert result.summary.pnl_today == pytest.approx(
        fsum(r.summary.pnl_today for r in separate)
    )


def test_mixed_expiry_withholds_exact_terminal_risk_and_labels_first_horizon():
    result = analyze_options(calendar_request())
    assert result.expiry_curve == result.expiry_pnl == []
    assert result.summary.max_profit is result.summary.max_loss is None
    assert result.summary.profit_unbounded is result.summary.loss_unbounded is None
    assert result.summary.breakevens == result.summary.zero_intervals == []
    assert result.horizon.kind == "mixed_expiry"
    assert not result.horizon.exact_terminal_available
    assert result.horizon.first_expiry_days == result.horizon.elapsed_days == 10
    assert result.horizon.last_expiry_days == 60
    assert [leg.state for leg in result.horizon.legs] == [
        "expiry_intrinsic",
        "model_mark",
    ]
    scenario = result.scenarios[0]
    assert [leg.remaining_days for leg in scenario.legs] == [0, 50]
    assert scenario.legs[0].theoretical_value == 0
    assert scenario.legs[0].greeks.delta is None
    assert scenario.legs[1].theoretical_value > 0
    assert scenario.legs[1].greeks.delta is not None
    assert scenario.greeks.delta is None
    assert result.horizon_pnl == scenario.pnl == result.surface.pnl[-1]
    assert result.surface.pnl[0] == result.today_pnl


@pytest.mark.parametrize("surface", [False, True])
def test_mark_scenarios_cannot_cross_front_expiry(surface):
    data = calendar_request()
    if surface:
        data["surface"]["steps"] = [0, 10.01]
    else:
        data["scenarios"][0]["elapsed_days"] = 10.01
    with pytest.raises(ValidationError, match="first active expiry"):
        analyze_options(data)


def test_date_only_override_and_days_date_agreement_and_legacy_default():
    data = calendar_request()
    data["strategy"].update(valuation_date="2024-02-28", expiry_date="2024-04-28")
    data["strategy"]["legs"][0].update(days_to_expiry=None, expiry_date="2024-03-09")
    result = analyze_options(data)
    assert [leg.resolved_days_to_expiry for leg in result.legs] == [10, 60]
    data["strategy"]["legs"][0]["days_to_expiry"] = 10
    assert analyze_options(data).summary == result.summary
    data["strategy"]["legs"][0]["days_to_expiry"] = 11
    with pytest.raises(ValidationError, match="exactly match"):
        analyze_options(data)
    del data["strategy"]["expiry_date"]
    data["strategy"]["legs"][0]["days_to_expiry"] = 10
    assert analyze_options(data).horizon.first_expiry_days == 10


@pytest.mark.parametrize(
    "override",
    [
        dict(days_to_expiry=-1),
        dict(days_to_expiry=3651),
        dict(expiry_date="2024-03-09"),
        dict(expiry_date="2024-02-30"),
    ],
)
def test_invalid_or_unanchored_leg_horizons_reject(override):
    data = calendar_request()
    data["strategy"]["legs"][0].update(override)
    with pytest.raises(ValidationError):
        OptionsAnalysisRequest.model_validate(data)


def test_disabled_expiries_do_not_limit_scenarios_and_underlying_has_no_expiry():
    data = calendar_request()
    data["strategy"]["legs"][0]["enabled"] = False
    result = analyze_options(data)
    assert result.horizon.first_expiry_days == 60
    assert result.horizon.exact_terminal_available
    assert result.horizon.legs[0].state == "disabled"
    data["strategy"]["legs"][0].update(kind="underlying", strike=None, multiplier=1)
    with pytest.raises(ValidationError, match="no expiry"):
        analyze_options(data)


def test_equal_per_leg_expiries_retain_exact_legacy_vertices():
    data = calendar_request()
    data["strategy"]["legs"][0]["days_to_expiry"] = 60
    result = analyze_options(data)
    assert result.horizon.kind == "single_expiry"
    assert result.expiry_curve
    assert result.horizon_pnl == result.expiry_pnl
    assert result.summary.max_profit == 0
    assert result.summary.max_loss == 200
    assert result.summary.profit_unbounded is False


def test_zero_front_expiry_preserves_later_model_value_and_forbids_time_surface():
    data = calendar_request()
    data["strategy"]["legs"][0]["days_to_expiry"] = 0
    data["scenarios"][0]["elapsed_days"] = 0
    data.pop("surface")
    result = analyze_options(data)
    assert result.horizon_pnl == result.today_pnl
    assert result.greeks.delta is None
    assert result.legs[1].theoretical_value_today > 0


def test_mixed_expiry_trusted_and_sandbox_serialization_match():
    data = calendar_request()
    expected = analyze_options(data).model_dump(mode="json")
    assert runner._validated_analysis(expected).model_dump(mode="json") == expected
    assert runner.run_options_analysis(data).model_dump(mode="json") == expected


def test_diagonal_helpers_preserve_overrides_and_signed_provenance():
    source = """
front = OptionLeg(kind="put", quantity=-2, strike=95, entry_premium=2, days_to_expiry=10.5)
back = OptionLeg(kind="put", quantity=2, strike=100, entry_premium=4, days_to_expiry=60)
strategy = OptionStrategy(template="diagonal", days_to_expiry=60, legs=[front, back])
result = analyze_options(dict(strategy=strategy, spot=100, volatility=0.2, spot_grid=[0, 100, 200]))
"""
    result = runner.run_options_python(source)
    assert result["request"]["strategy"]["template"] == "diagonal"
    assert result["request"]["strategy"]["legs"][0]["quantity"] == -2
    assert result["horizon"]["first_expiry_days"] == 10.5
    assert [leg["remaining_days"] for leg in result["horizon"]["legs"]] == [0, 49.5]


def test_mixed_expiry_http_analyze_and_python(client):  # noqa: F811
    data = calendar_request()
    expected = analyze_options(data).model_dump(mode="json")
    response = client.post("/options/analyze", json=data)
    assert response.status_code == 200, response.text
    assert response.json() == expected
    source = f"request = {data!r}\nresult = analyze_options(request)"
    response = client.post("/options/python", json={"source": source})
    assert response.status_code == 200, response.text
    assert response.json() == expected

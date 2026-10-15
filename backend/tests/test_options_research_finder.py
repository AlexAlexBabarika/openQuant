"""Independent finite-search and cash-flow checks, not investment validation."""

import json

import pytest
from pydantic import ValidationError

from backend.derivatives.research import find_strategies
from backend.derivatives.research_models import FinderRequest


def analysis(legs=None, **updates):
    return {
        "strategy": {
            "days_to_expiry": 30,
            "legs": legs
            or [{"kind": "call", "quantity": 1, "strike": 100, "entry_premium": 5}],
        },
        "spot": 100,
        "volatility": 0.2,
        "rate": 0,
        "dividend_yield": 0,
        "spot_grid": [80, 120],
        **updates,
    }


def finder_payload():
    return {
        "analysis": analysis(),
        "universe": [
            {"kind": "call", "quantity": 1, "strike": 100, "entry_premium": 5},
            {"kind": "call", "quantity": 1, "strike": 110, "entry_premium": 2},
        ],
        "thesis": "neutral",
        "constraints": {"max_entry_debit": 1000, "max_loss": 1000},
        "scenario_spots": [90, 105, 120],
        "limit": 20,
    }


def test_finder_put_vertical_evidence_respects_exact_zero_profit_interval():
    data = finder_payload()
    data["universe"] = [
        dict(kind="put", strike=90, quantity=1, entry_premium=0),
        dict(kind="put", strike=110, quantity=1, entry_premium=20),
    ]
    data["constraints"] = {"max_entry_debit": 2000, "max_loss": 2000}
    data["scenario_spots"] = [0, 80.56882430542512, 110]
    result = find_strategies(data)
    vertical = next(
        c
        for c in result.candidates
        if len(c.request.strategy.legs) == 2
        and any(
            leg.strike == 110 and leg.quantity == 1 for leg in c.request.strategy.legs
        )
    )
    assert [row.pnl for row in vertical.evidence] == [0, 0, -2000]
    assert vertical.summary.max_profit == 0
    assert vertical.summary.max_loss == 2000


def test_unequal_multipliers_cannot_disguise_unbounded_loss_as_a_vertical():
    data = finder_payload()
    data["universe"] = [
        dict(kind="call", strike=100, quantity=1, multiplier=10, entry_premium=5),
        dict(kind="call", strike=110, quantity=1, multiplier=20, entry_premium=2),
    ]
    data["constraints"] = {"max_entry_debit": 0, "max_loss": 90}
    data["scenario_spots"] = [0, 110, 130]
    result = find_strategies(data)
    assert result.searched_count == 6
    assert result.eligible_count == len(result.candidates) == 1
    candidate = result.candidates[0]
    assert {(leg.strike, leg.quantity) for leg in candidate.request.strategy.legs} == {
        (100, -1),
        (110, 1),
    }
    assert candidate.summary.entry_credit == 10
    assert candidate.summary.max_loss == 90
    assert candidate.summary.profit_unbounded is True
    assert [row.pnl for row in candidate.evidence] == [10, -90, 110]


def test_finder_unit_search_known_vertical_and_naked_loss_rejection():
    result = find_strategies(finder_payload())
    assert result.searched_count == 6
    assert (
        result.eligible_count == 4
    )  # two longs, two finite verticals; naked short calls excluded
    assert not result.search_truncated
    assert all(
        candidate.summary.loss_unbounded is False for candidate in result.candidates
    )
    vertical = next(
        c
        for c in result.candidates
        if len(c.request.strategy.legs) == 2
        and c.request.strategy.legs[0].quantity == 1
    )
    assert vertical.summary.net_entry_cost == 300
    assert vertical.summary.max_loss == 300
    assert vertical.summary.max_profit == 700
    assert [row.pnl for row in vertical.evidence] == [-300, 200, 700]
    assert vertical.score == 200
    assert [row.elapsed_days for row in vertical.evidence] == [30] * 3
    assert [c.rank for c in result.candidates] == list(range(1, 5))
    assert result == find_strategies(FinderRequest.model_validate(finder_payload()))


def test_deduplication_and_ordering_do_not_change_ranking_or_ids():
    data = finder_payload()
    expected = find_strategies(data)
    data["universe"] = [*reversed(data["universe"]), *data["universe"]]
    assert find_strategies(data) == expected.model_copy(
        update={"request": FinderRequest.model_validate(data)}
    )


@pytest.mark.parametrize("thesis", ["bullish", "bearish"])
def test_direction_uses_current_delta_not_scenario_score(thesis):
    data = finder_payload()
    data["thesis"] = thesis
    result = find_strategies(data)
    from backend.derivatives import analyze_options

    assert result.candidates
    for candidate in result.candidates:
        delta = analyze_options(candidate.request).greeks.delta
        assert delta is not None
        assert delta > 0 if thesis == "bullish" else delta < 0


def test_neutral_explicitly_means_no_directional_filter_not_delta_neutral():
    from backend.derivatives import analyze_options

    result = find_strategies(finder_payload())
    deltas = [analyze_options(c.request).greeks.delta for c in result.candidates]
    assert any(d is not None and d > 0 for d in deltas)
    assert any(d is not None and d < 0 for d in deltas)
    assert any("Neutral applies no delta filter" in w for w in result.warnings)


def test_budget_limits_leg_constraints_and_empty_result_are_explicit():
    data = finder_payload()
    data["max_evaluations"] = 1
    result = find_strategies(data)
    assert result.searched_count == 1 and result.search_truncated
    data["constraints"].update(max_entry_debit=0, max_loss=0)
    assert find_strategies(data).candidates == []
    data = finder_payload()
    data["constraints"].update(max_legs=1, max_total_contracts=1)
    assert all(
        len(c.request.strategy.legs) == 1 for c in find_strategies(data).candidates
    )


def test_short_put_is_bounded_but_cannot_pass_a_too_small_loss_limit():
    data = finder_payload()
    data["universe"] = [
        {"kind": "put", "strike": 100, "quantity": 1, "entry_premium": 5}
    ]
    data["constraints"].update(max_loss=9500)
    result = find_strategies(data)
    short = next(
        c for c in result.candidates if c.request.strategy.legs[0].quantity == -1
    )
    assert short.summary.max_loss == 9500
    assert short.summary.entry_credit == 500
    data["constraints"]["max_loss"] = 9499
    assert all(
        c.request.strategy.legs[0].quantity == 1
        for c in find_strategies(data).candidates
    )


def test_condor_cashflow_and_maximum_loss_include_fees():
    data = finder_payload()
    data["analysis"]["strategy"]["entry_fee_per_contract"] = 1
    data["universe"] = [
        {"kind": kind, "quantity": 1, "strike": strike, "entry_premium": premium}
        for kind, strike, premium in [
            ("put", 80, 1),
            ("put", 90, 3),
            ("call", 110, 3),
            ("call", 120, 1),
        ]
    ]
    result = find_strategies(data)
    condor = next(
        c
        for c in result.candidates
        if len(c.request.strategy.legs) == 4 and c.summary.net_entry_cost < 0
    )
    assert condor.summary.net_entry_cost == -396
    assert condor.summary.max_profit == 396
    assert condor.summary.max_loss == 604
    assert [row.pnl for row in condor.evidence] == [396, 396, -604]


def test_search_does_not_expand_original_grid_scenarios_or_surface(monkeypatch):
    from backend.derivatives import research_finder as module

    original = module.analyze_options
    seen = []

    def compact(request):
        seen.append(request)
        assert request.spot_grid == [0, 1_000_000]
        assert request.scenarios == [] and request.surface is None
        return original(request)

    monkeypatch.setattr(module, "analyze_options", compact)
    data = finder_payload()
    data["analysis"].update(
        spot_grid=list(range(201)),
        surface={
            "axis": "elapsed_days",
            "spots": list(range(41)),
            "steps": list(range(21)),
        },
        scenarios=[{"name": "later", "elapsed_days": 20}],
    )
    result = find_strategies(data)
    assert len(seen) == result.searched_count
    assert all(c.request.spot_grid == list(range(201)) for c in result.candidates)


def test_mixed_universe_does_not_generate_unknown_loss_candidates():
    data = finder_payload()
    data["universe"][1]["days_to_expiry"] = 60
    result = find_strategies(data)
    assert result.searched_count == 4
    assert all(len(c.request.strategy.legs) == 1 for c in result.candidates)


@pytest.mark.parametrize(
    "field,value",
    [
        ("max_evaluations", 2001),
        ("limit", 21),
        ("scenario_spots", [100, 100]),
        ("universe", []),
    ],
)
def test_finder_bounds(field, value):
    data = finder_payload()
    data[field] = value
    with pytest.raises(ValidationError):
        find_strategies(data)


def test_extreme_finite_inputs_are_not_nonfinite_results():
    data = finder_payload()
    data["analysis"].update(volatility=5, rate=-1, dividend_yield=1)
    data["analysis"]["strategy"]["days_to_expiry"] = 3650
    result = find_strategies(data)
    json.dumps(result.model_dump(), allow_nan=False)

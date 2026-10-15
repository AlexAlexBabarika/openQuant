"""Frozen research envelope bounds; these tests do not imply endpoint availability."""

import pytest
from pydantic import ValidationError

from backend.derivatives.research_models import (
    ChainQuote,
    DistributionRequest,
    FinderRequest,
    LifecycleRequest,
)
from backend.derivatives.models import OptionsContractSource
from backend.tests.test_options_multi_expiry import calendar_request


def test_lifecycle_covers_every_expiry_without_changing_ordinary_mark_bound():
    analysis = calendar_request()
    valid = dict(
        analysis=analysis,
        path=dict(
            source="supplied", points=[dict(day=0, spot=100), dict(day=60, spot=110)]
        ),
    )
    assert LifecycleRequest.model_validate(valid).path.points[-1].day == 60
    valid["path"]["points"][-1]["day"] = 59
    with pytest.raises(ValidationError, match="every active leg expiry"):
        LifecycleRequest.model_validate(valid)


def test_distribution_rejects_mixed_expiry_and_requires_explicit_measure_drift():
    analysis = calendar_request()
    with pytest.raises(ValidationError, match="common option expiry"):
        DistributionRequest(analysis=analysis, measure="risk_neutral")
    analysis["strategy"]["legs"][0]["days_to_expiry"] = 60
    assert (
        DistributionRequest(
            analysis=analysis, measure="user_drift", annual_drift=0
        ).annual_drift
        == 0
    )
    with pytest.raises(ValidationError, match="annual_drift"):
        DistributionRequest(analysis=analysis, measure="user_drift")
    with pytest.raises(ValidationError, match="annual_drift"):
        DistributionRequest(analysis=analysis, measure="risk_neutral", annual_drift=0)


def test_finder_is_bounded_explicit_contracts_and_zero_constraints_are_valid():
    analysis = calendar_request()
    payload = dict(
        analysis=analysis,
        universe=[analysis["strategy"]["legs"][1]],
        thesis="neutral",
        scenario_spots=[100],
        constraints=dict(max_loss=0, max_entry_debit=0),
    )
    assert FinderRequest.model_validate(payload).constraints.max_loss == 0
    payload["max_evaluations"] = 2001
    with pytest.raises(ValidationError):
        FinderRequest.model_validate(payload)
    payload["max_evaluations"] = 2000
    payload["universe"][0]["quantity"] = -1
    with pytest.raises(ValidationError, match="unit-quantity"):
        FinderRequest.model_validate(payload)


def test_normalized_chain_preserves_zero_and_unknown_and_never_accepts_token():
    quote = dict(
        contract_symbol="XYZ261218C00100000",
        underlying="XYZ",
        kind="call",
        strike=100,
        expiration="2026-12-18",
        multiplier=None,
        bid=0,
        ask=None,
        bid_as_of=None,
        ask_as_of=None,
        implied_volatility=0,
        volume=0,
        open_interest=None,
        source=dict(
            provider="tradier",
            environment="sandbox",
            contract_symbol="XYZ261218C00100000",
            underlying="XYZ",
            fetched_at="2026-10-15T00:00:00Z",
        ),
    )
    result = ChainQuote.model_validate(quote)
    assert result.bid == result.volume == result.implied_volatility == 0
    assert result.ask is result.multiplier is result.bid_as_of is None
    assert result.source.observed_exercise_style == "unknown"
    quote["token"] = "not-allowed"
    with pytest.raises(ValidationError):
        ChainQuote.model_validate(quote)


@pytest.mark.parametrize(
    "time",
    [
        "2026-10-15",
        "2026-10-15T12:00",
        "2026-02-30T00:00Z",
        "2026-10-15T24:00Z",
        "2026-10-15T00:00+02",
        "2026-10-15T00:00Z" + "x" * 64,
    ],
)
def test_source_timestamp_requires_bounded_zoned_iso_calendar_timestamp(time):
    with pytest.raises(ValidationError):
        OptionsContractSource(
            provider="tradier",
            environment="sandbox",
            contract_symbol="XYZ-EXAMPLE",
            underlying="XYZ",
            fetched_at=time,
        )

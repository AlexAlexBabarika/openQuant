"""Finite, deterministic unit-contract searches, not strategy recommendations."""

from __future__ import annotations

from hashlib import sha256
from itertools import combinations, islice
import json
from math import fsum
from typing import Any, Iterator

from .analytics import analyze_options, terminal_payoff
from .models import OptionLeg, OptionStrategy, OptionsAnalysisRequest
from .research_models import (
    FinderCandidate,
    FinderEvidence,
    FinderRequest,
    FinderResponse,
)


def _contracts(request: FinderRequest) -> list[OptionLeg]:
    unique: dict[str, OptionLeg] = {}
    for leg in sorted(request.universe, key=lambda x: x.model_dump_json()):
        key = json.dumps(
            [
                leg.kind,
                leg.strike,
                request.analysis.strategy.leg_days(leg),
                leg.multiplier,
                leg.entry_premium,
                leg.implied_volatility,
            ]
        )
        unique.setdefault(key, leg)
    return [unique[key] for key in sorted(unique)]


def _candidates(request: FinderRequest) -> Iterator[list[OptionLeg]]:
    contracts = _contracts(request)

    def signed(legs: tuple[OptionLeg, ...], signs: tuple[int, ...]) -> list[OptionLeg]:
        return [
            OptionLeg.model_validate({**leg.model_dump(), "quantity": sign})
            for leg, sign in zip(legs, signs)
        ]

    for leg in contracts:
        for sign in (1, -1):
            yield signed((leg,), (sign,))
    for a, b in combinations(contracts, 2):
        if request.analysis.strategy.leg_days(a) != request.analysis.strategy.leg_days(
            b
        ):
            continue
        if a.kind == b.kind:
            if a.strike == b.strike:
                continue
            signs = (1, -1)
        else:
            call, put = (a, b) if a.kind == "call" else (b, a)
            assert call.strike is not None and put.strike is not None
            if call.strike < put.strike:
                continue
            signs = (1, 1)
        for direction in (1, -1):
            yield signed((a, b), tuple(s * direction for s in signs))
    for group in combinations(contracts, 4):
        if len({request.analysis.strategy.leg_days(leg) for leg in group}) != 1:
            continue
        puts = sorted(
            (leg for leg in group if leg.kind == "put"), key=lambda x: x.strike or 0
        )
        calls = sorted(
            (leg for leg in group if leg.kind == "call"), key=lambda x: x.strike or 0
        )
        if len(puts) != 2 or len(calls) != 2:
            continue
        p0, p1, c0, c1 = (
            puts[0].strike,
            puts[1].strike,
            calls[0].strike,
            calls[1].strike,
        )
        assert p0 is not None and p1 is not None and c0 is not None and c1 is not None
        if p0 < p1 <= c0 < c1:
            for direction in (1, -1):
                yield signed(
                    tuple(puts + calls), (direction, -direction, -direction, direction)
                )


def find_strategies(request: FinderRequest | dict[str, Any]) -> FinderResponse:
    submitted = FinderRequest.model_validate(
        request.model_dump() if isinstance(request, FinderRequest) else request
    )
    eligible: list[tuple[tuple[float, float, float, str], FinderCandidate]] = []
    searched = 0
    candidates = iter(_candidates(submitted))
    for legs in islice(candidates, submitted.max_evaluations):
        searched += 1
        if len(legs) > min(
            submitted.constraints.max_legs, submitted.constraints.max_total_contracts
        ):
            continue
        strategy = OptionStrategy.model_validate(
            {
                **submitted.analysis.strategy.model_dump(),
                "name": "Finder unit-contract candidate",
                "template": "custom",
                "legs": legs,
            }
        )
        analysis = OptionsAnalysisRequest.model_validate(
            {
                **submitted.analysis.model_dump(),
                "strategy": strategy,
                "scenarios": [],
                "surface": None,
            }
        )
        # Curves are not part of the score. Their requested density must not multiply search work.
        compact = OptionsAnalysisRequest.model_validate(
            {**analysis.model_dump(), "spot_grid": [0, 1_000_000]}
        )
        canonical = analyze_options(compact)
        summary = canonical.summary
        if (
            summary.max_loss is None
            or summary.loss_unbounded is not False
            or summary.max_loss > submitted.constraints.max_loss
            or summary.entry_debit > submitted.constraints.max_entry_debit
        ):
            continue
        delta = canonical.greeks.delta
        if submitted.thesis != "neutral" and (
            delta is None
            or (delta <= 0 if submitted.thesis == "bullish" else delta >= 0)
        ):
            continue
        evidence = [
            FinderEvidence(
                spot=spot,
                elapsed_days=strategy.first_expiry_days,
                pnl=fsum(
                    [
                        leg.quantity * leg.multiplier * terminal_payoff(leg, spot)
                        for leg in legs
                    ]
                    + [-summary.net_entry_cost]
                ),
            )
            for spot in submitted.scenario_spots
        ]
        score = fsum(row.pnl for row in evidence) / len(evidence)
        signature = json.dumps(
            sorted(leg.model_dump_json() for leg in legs), separators=(",", ":")
        )
        candidate = FinderCandidate(
            candidate_id="unit-" + sha256(signature.encode()).hexdigest()[:24],
            rank=1,
            score=score,
            request=analysis,
            summary=summary,
            evidence=evidence,
        )
        eligible.append(
            ((-score, summary.max_loss, summary.entry_debit, signature), candidate)
        )
    truncated = next(candidates, None) is not None
    ranked = [
        candidate.model_copy(update={"rank": rank})
        for rank, (_, candidate) in enumerate(
            sorted(eligible, key=lambda item: item[0])[: submitted.limit], start=1
        )
    ]
    return FinderResponse(
        request=submitted,
        candidates=ranked,
        searched_count=searched,
        eligible_count=len(eligible),
        search_truncated=truncated,
        warnings=[
            "Finite unit-size search: signed singles, same-expiry verticals, straddles/strangles and iron condors/butterflies only; no sizing optimization or exhaustive search claim.",
            "Candidates are evaluated in stable singles, pairs, then four-leg order; the evaluation budget may exclude later families. Duplicate financial contracts are removed.",
            "Score is arithmetic mean terminal P&L at supplied scenario spots, not a probability-weighted expected return or investment advice. Neutral applies no delta filter.",
            "Analysis scenarios and surface are not search inputs; candidate requests clear them. Fixed supplied premiums and entry fees are retained.",
        ],
    )

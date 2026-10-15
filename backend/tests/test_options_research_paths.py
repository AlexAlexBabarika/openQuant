import json
from math import exp

import pytest
from pydantic import ValidationError

from backend.derivatives.research import evaluate_lifecycle, simulate_hedge
from backend.derivatives.research_models import LifecycleRequest
from backend.tests.test_options_research_finder import analysis


def lifecycle_payload():
    data = analysis(
        [
            {
                "kind": "call",
                "strike": 100,
                "quantity": 1,
                "entry_premium": 5,
                "days_to_expiry": 1,
            },
            {
                "kind": "call",
                "strike": 100,
                "quantity": -1,
                "entry_premium": 6,
                "days_to_expiry": 2,
            },
            {
                "kind": "put",
                "strike": 120,
                "quantity": -2,
                "entry_premium": 10,
                "days_to_expiry": 1,
                "enabled": False,
            },
        ]
    )
    data["strategy"]["entry_fee_per_contract"] = 2
    return {
        "analysis": data,
        "path": {
            "source": "supplied",
            "points": [
                {"day": 0, "spot": 100},
                {"day": 2, "spot": 120},
                {"day": 3, "spot": 80},
            ],
        },
    }


def test_settlement_once_on_each_expiry_keeps_cash_and_signed_costs():
    result = evaluate_lifecycle(lifecycle_payload())
    assert [p.day for p in result.path] == [0, 1, 2, 3]
    assert [s.signed_cash_flow for s in result.settlements] == [1000, -2000]
    first = result.settlements[0]
    assert (first.spot, first.left_day, first.right_day, first.observation) == (
        110,
        0,
        2,
        "linear_interpolation",
    )
    assert result.settlements[1].observation == "supplied"
    assert result.net_entry_cost == -96
    assert (
        result.final_pnl == -904
    )  # retained -1000 settlement cash minus fixed -96 entry cost
    assert result.ledger[-1].total_pnl == result.ledger[-2].total_pnl
    assert [row.cumulative_settlement_cash for row in result.ledger] == [
        0,
        1000,
        -1000,
        -1000,
    ]
    assert [row.settlement_cash_flow for row in result.ledger] == [0, 1000, -2000, 0]
    for step in result.ledger:
        assert step.total_pnl == pytest.approx(
            step.cumulative_settlement_cash
            + sum(leg.value for leg in step.legs)
            - result.net_entry_cost
        )
        assert step.legs[2].state == "disabled" and step.legs[2].value == 0
    assert result.ledger[1].legs[0].state == "settled"
    assert result.ledger[1].legs[1].state == "model_mark"
    assert set(result.ledger[1].legs[0].greeks.model_dump().values()) == {0}
    assert any("interpolation" in warning for warning in result.warnings)


def test_day_zero_expiry_settles_before_later_marks_and_never_reprices():
    data = lifecycle_payload()
    data["analysis"]["strategy"]["legs"][0].update(strike=90, days_to_expiry=0)
    result = evaluate_lifecycle(data)
    assert result.ledger[0].settlement_cash_flow == 1000
    assert result.ledger[0].legs[0].state == "settled"
    assert result.ledger[-1].cumulative_settlement_cash == -1000
    assert result.settlements[0].observation == "supplied"


def test_one_point_zero_day_path_is_supported():
    data = {
        "analysis": analysis(),
        "path": {"source": "supplied", "points": [{"day": 0, "spot": 100}]},
    }
    data["analysis"]["strategy"].update(days_to_expiry=0)
    assert evaluate_lifecycle(data).final_pnl == -500
    assert simulate_hedge(data).ledger[0].traded_shares == 0


def stock_path():
    return {
        "analysis": analysis(
            [
                {
                    "kind": "underlying",
                    "quantity": 10,
                    "entry_premium": 100,
                    "multiplier": 1,
                }
            ]
        ),
        "path": {
            "source": "supplied",
            "points": [
                {"day": 0, "spot": 100},
                {"day": 1, "spot": 105},
                {"day": 2, "spot": 90},
            ],
        },
    }


def test_hedge_shares_signed_cash_costs_unwind_and_attribution_reconcile():
    data = stock_path()
    data["costs"] = {"per_share": 1, "fixed_per_trade": 2, "slippage_bps": 100}
    result = simulate_hedge(data)
    assert [row.traded_shares for row in result.ledger] == [-10, 0, 10]
    assert [row.trade_cash_flow for row in result.ledger] == [1000, 0, -900]
    assert [row.transaction_cost for row in result.ledger] == [22, 0, 21]
    assert result.unhedged_final_pnl == -100
    assert result.hedged_final_pnl == -43
    assert result.ledger[-1].hedge_shares == 0
    assert result.ledger[-1].hedge_cash == 57
    assert result.ledger[-1].action == "liquidate"
    a = result.attribution
    assert (a.strategy_pnl, a.hedge_trading_pnl, a.transaction_costs) == (-100, 100, 43)
    assert a.total_pnl == a.strategy_pnl + a.hedge_trading_pnl - a.transaction_costs
    assert a.financing == a.dividends == 0


def test_short_underlying_hedge_no_double_counting_and_no_hedge_comparison():
    data = stock_path()
    data["analysis"]["strategy"]["legs"][0]["quantity"] = -10
    hedged = simulate_hedge(data)
    assert hedged.ledger[0].hedge_shares == 10 and hedged.hedged_final_pnl == 0
    data["policy"] = {"mode": "none"}
    unhedged = simulate_hedge(data)
    assert unhedged.unhedged_final_pnl == hedged.unhedged_final_pnl == 100
    assert unhedged.hedged_final_pnl == 100
    assert unhedged.lifecycle.path == hedged.lifecycle.path
    assert all(row.traded_shares == 0 for row in unhedged.ledger)


@pytest.mark.parametrize("mode", ["daily", "interval", "delta_threshold"])
def test_no_lookahead_interpolated_expiries_never_trigger_trades(mode):
    data = lifecycle_payload()
    data["policy"] = {"mode": mode, "interval_days": 0.01, "delta_threshold": 0.001}
    result = simulate_hedge(data)
    assert result.ledger[1].day == 1
    assert result.ledger[1].traded_shares == 0 and result.ledger[1].action == "hold"
    assert result.ledger[0].traded_shares == pytest.approx(
        -result.ledger[0].strategy_delta
    )
    changed = lifecycle_payload()
    changed["policy"] = data["policy"]
    changed["path"]["points"][-1]["spot"] = 500
    assert simulate_hedge(changed).ledger[0] == result.ledger[0]


def test_undefined_delta_and_share_cap_skip_not_clip():
    data = lifecycle_payload()
    data["analysis"]["volatility"] = 0
    result = simulate_hedge(data)
    assert result.ledger[0].strategy_delta is None
    assert result.ledger[0].action == "undefined_delta"
    assert result.ledger[0].traded_shares == 0
    data = stock_path()
    data["policy"] = {"max_abs_shares": 5}
    result = simulate_hedge(data)
    assert result.ledger[0].action == "share_limit"
    assert all(row.traded_shares == 0 for row in result.ledger)


def test_threshold_compares_residual_delta_and_interval_waits_for_observation():
    data = stock_path()
    data["policy"] = {"mode": "delta_threshold", "delta_threshold": 11}
    assert all(row.traded_shares == 0 for row in simulate_hedge(data).ledger)
    data["policy"] = {"mode": "interval", "interval_days": 2}
    result = simulate_hedge(data)
    assert result.ledger[1].action == "hold"


def test_synthetic_seed_is_reproducible_and_zero_vol_path_uses_explicit_drift():
    data = lifecycle_payload()
    data["path"] = {
        "source": "synthetic",
        "seed": 9,
        "horizon_days": 3,
        "steps": 3,
        "annual_volatility": 0.2,
    }
    assert evaluate_lifecycle(data) == evaluate_lifecycle(
        LifecycleRequest.model_validate(data)
    )
    assert simulate_hedge(data).lifecycle.path == evaluate_lifecycle(data).path
    data["path"].update(annual_volatility=0, annual_drift=0.1)
    assert evaluate_lifecycle(data).path[-1].spot == pytest.approx(
        100 * exp(0.1 * 3 / 365)
    )
    data["analysis"]["spot"] = 1_000_000
    data["path"].update(horizon_days=3650, annual_drift=1)
    with pytest.raises(ValueError, match="no clipping"):
        evaluate_lifecycle(data)


@pytest.mark.parametrize(
    "points",
    [
        [],
        [{"day": 1, "spot": 100}],
        [{"day": 0, "spot": 101}, {"day": 2, "spot": 100}],
        [{"day": 0, "spot": 100}, {"day": 1, "spot": 100}],
        [{"day": 0, "spot": 100}, {"day": 0, "spot": 120}],
    ],
)
def test_path_context_and_coverage_are_required(points):
    data = lifecycle_payload()
    data["path"]["points"] = points
    with pytest.raises(ValidationError):
        evaluate_lifecycle(data)


def test_all_expiries_inserted_within_bounded_ledger_and_finite_output():
    data = lifecycle_payload()
    data["analysis"]["strategy"]["legs"] = [
        {
            "kind": "call",
            "strike": 100 + i,
            "quantity": (-1) ** i,
            "days_to_expiry": 0.5 + i * 20,
        }
        for i in range(16)
    ]
    data["path"]["points"] = [{"day": i, "spot": 100 + i / 10} for i in range(366)]
    result = evaluate_lifecycle(data)
    assert len(result.path) == len(result.ledger) == 382
    assert len(result.settlements) == 16
    json.dumps(result.model_dump(), allow_nan=False)

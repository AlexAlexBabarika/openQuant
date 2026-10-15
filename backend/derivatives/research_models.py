"""Frozen bounded options research wire v1. Implementations live in owned modules.

Pure entrypoints: find_strategies(FinderRequest)->FinderResponse,
evaluate_lifecycle(LifecycleRequest)->LifecycleResponse,
simulate_hedge(HedgeRequest)->HedgeResponse,
analyze_distribution(DistributionRequest)->DistributionResponse.
Each also accepts a dict and revalidates models before computation. No I/O in
these functions; authenticated provider I/O belongs to the chain adapter.
"""

from datetime import date
from typing import Annotated, Literal, Self

from pydantic import AfterValidator, Field, model_validator

from .models import (
    AnnualRate,
    CalendarDate,
    Days,
    OptionLeg,
    OptionsAnalysisRequest,
    OptionsContractSource,
    OptionsGreeks,
    OptionsModel,
    OptionsSummary,
    OptionsTimestamp,
    PositivePrice,
    Price,
    Volatility,
)

MAX_PATH_POINTS = 366
MAX_LEDGER_POINTS = 382  # supplied/generated points plus at most 16 expiries
MAX_FINDER_EVALUATIONS = 2000
MAX_CHAIN_QUOTES = 2000
Money = Annotated[float, Field(ge=0, le=1_000_000_000_000)]
Probability = Annotated[float, Field(ge=0, le=1)]


def _calendar(value: str) -> str:
    date.fromisoformat(value)
    return value


Timestamp = OptionsTimestamp
ChainDate = Annotated[CalendarDate, AfterValidator(_calendar)]
Symbol = Annotated[str, Field(pattern=r"^[A-Za-z0-9.^_/-]{1,32}$")]
Environment = Literal["production", "sandbox"]
Warnings = Annotated[list[Annotated[str, Field(max_length=1000)]], Field(max_length=32)]


class ResearchProvenance(OptionsModel):
    version: Literal["1"] = "1"
    model: Literal["black_scholes_merton"] = "black_scholes_merton"
    currency: Literal["USD"] = "USD"
    day_basis: Literal["ACT/365"] = "ACT/365"
    exercise_style: Literal["european"] = "european"
    settlement: Literal["cash"] = "cash"
    input_source: Literal["manual_or_synthetic"] = "manual_or_synthetic"


class FinderConstraints(OptionsModel):
    max_entry_debit: Money
    max_loss: Money
    max_total_contracts: int = Field(default=10, ge=1, le=100)
    max_legs: int = Field(default=4, ge=1, le=4)


class FinderRequest(OptionsModel):
    analysis: OptionsAnalysisRequest
    universe: list[OptionLeg] = Field(min_length=1, max_length=24)
    thesis: Literal["bullish", "bearish", "neutral"]
    constraints: FinderConstraints
    scenario_spots: list[Price] = Field(min_length=1, max_length=9)
    scoring: Literal["mean_scenario_pnl_v1"] = "mean_scenario_pnl_v1"
    limit: int = Field(default=10, ge=1, le=20)
    max_evaluations: int = Field(default=2000, ge=1, le=MAX_FINDER_EVALUATIONS)

    @model_validator(mode="after")
    def manual_contracts(self) -> Self:
        if any(
            leg.kind == "underlying" or leg.quantity != 1 or not leg.enabled
            for leg in self.universe
        ):
            raise ValueError(
                "finder universe requires enabled unit-quantity option contracts"
            )
        for leg in self.universe:
            self.analysis.strategy.leg_days(leg)
        if any(a >= b for a, b in zip(self.scenario_spots, self.scenario_spots[1:])):
            raise ValueError("scenario_spots must be strictly increasing")
        return self


class FinderEvidence(OptionsModel):
    spot: Price
    elapsed_days: Days
    pnl: float


class FinderCandidate(OptionsModel):
    candidate_id: str = Field(min_length=1, max_length=120)
    rank: int = Field(ge=1, le=20)
    score: float
    request: OptionsAnalysisRequest
    summary: OptionsSummary
    evidence: list[FinderEvidence] = Field(min_length=1, max_length=9)


class FinderResponse(OptionsModel):
    request: FinderRequest
    provenance: ResearchProvenance = Field(default_factory=ResearchProvenance)
    candidates: list[FinderCandidate] = Field(max_length=20)
    searched_count: int = Field(ge=0, le=MAX_FINDER_EVALUATIONS)
    eligible_count: int = Field(ge=0, le=MAX_FINDER_EVALUATIONS)
    search_truncated: bool
    scoring: Literal["mean_scenario_pnl_v1"] = "mean_scenario_pnl_v1"
    warnings: Warnings = Field(default_factory=list)


class PathPoint(OptionsModel):
    day: Days
    spot: Price


class SuppliedPath(OptionsModel):
    source: Literal["supplied"] = "supplied"
    points: list[PathPoint] = Field(min_length=1, max_length=MAX_PATH_POINTS)

    @model_validator(mode="after")
    def ordered(self) -> Self:
        if self.points[0].day != 0 or any(
            a.day >= b.day for a, b in zip(self.points, self.points[1:])
        ):
            raise ValueError("path must start at day zero and strictly increase")
        return self


class SyntheticPath(OptionsModel):
    source: Literal["synthetic"] = "synthetic"
    seed: int = Field(default=1, ge=0, le=4_294_967_295)
    horizon_days: float = Field(gt=0, le=3650)
    steps: int = Field(default=30, ge=1, le=365)
    annual_drift: AnnualRate = 0
    annual_volatility: Volatility = 0.2
    generator: Literal["gbm_seeded_v1"] = "gbm_seeded_v1"


ResearchPath = Annotated[SuppliedPath | SyntheticPath, Field(discriminator="source")]


class LifecycleRequest(OptionsModel):
    analysis: OptionsAnalysisRequest
    path: ResearchPath

    @model_validator(mode="after")
    def path_context(self) -> Self:
        last_expiry = max(
            (
                self.analysis.strategy.leg_days(leg)
                for leg in self.analysis.strategy.legs
                if leg.enabled and leg.kind != "underlying"
            ),
            default=0,
        )
        end = (
            self.path.points[-1].day
            if isinstance(self.path, SuppliedPath)
            else self.path.horizon_days
        )
        if end < last_expiry:
            raise ValueError("path must cover every active leg expiry")
        if (
            isinstance(self.path, SuppliedPath)
            and self.path.points[0].spot != self.analysis.spot
        ):
            raise ValueError("path day-zero spot must equal analysis.spot")
        return self


class SettlementObservation(OptionsModel):
    leg_index: int = Field(ge=0, le=15)
    day: Days
    spot: Price
    observation: Literal["supplied", "synthetic", "linear_interpolation"]
    left_day: Days
    right_day: Days
    intrinsic_per_unit: Price
    signed_cash_flow: float


class LifecycleLegMark(OptionsModel):
    leg_index: int = Field(ge=0, le=15)
    state: Literal["disabled", "underlying", "model_mark", "settled"]
    remaining_days: Days | None
    value: float
    greeks: OptionsGreeks


class LifecycleStep(OptionsModel):
    day: Days
    spot: Price
    settlement_cash_flow: float
    cumulative_settlement_cash: float
    remaining_value: float
    total_pnl: float
    legs: list[LifecycleLegMark] = Field(min_length=1, max_length=16)


class LifecycleResponse(OptionsModel):
    request: LifecycleRequest
    provenance: ResearchProvenance = Field(default_factory=ResearchProvenance)
    path: list[PathPoint] = Field(min_length=1, max_length=MAX_LEDGER_POINTS)
    settlements: list[SettlementObservation] = Field(max_length=16)
    ledger: list[LifecycleStep] = Field(min_length=1, max_length=MAX_LEDGER_POINTS)
    net_entry_cost: float
    final_pnl: float
    warnings: Warnings = Field(default_factory=list)


class HedgePolicy(OptionsModel):
    mode: Literal["none", "daily", "interval", "delta_threshold"] = "daily"
    interval_days: float = Field(default=1, gt=0, le=3650)
    delta_threshold: float = Field(default=10, gt=0, le=1_000_000)
    max_abs_shares: float = Field(default=1_000_000, gt=0, le=10_000_000)


class HedgeCosts(OptionsModel):
    per_share: float = Field(default=0, ge=0, le=1000)
    fixed_per_trade: float = Field(default=0, ge=0, le=10_000)
    slippage_bps: float = Field(default=0, ge=0, le=1000)


class HedgeRequest(LifecycleRequest):
    policy: HedgePolicy = Field(default_factory=HedgePolicy)
    costs: HedgeCosts = Field(default_factory=HedgeCosts)


class HedgeStep(OptionsModel):
    day: Days
    spot: Price
    strategy_delta: float | None
    hedge_shares: float
    traded_shares: float
    trade_cash_flow: float
    transaction_cost: Money
    hedge_cash: float
    hedge_value: float
    unhedged_pnl: float
    hedged_pnl: float
    action: Literal["hold", "rebalance", "liquidate", "undefined_delta", "share_limit"]


class HedgeAttribution(OptionsModel):
    strategy_pnl: float
    hedge_trading_pnl: float
    transaction_costs: Money
    total_pnl: float
    financing: Literal[0] = 0
    dividends: Literal[0] = 0


class HedgeResponse(OptionsModel):
    request: HedgeRequest
    provenance: ResearchProvenance = Field(default_factory=ResearchProvenance)
    lifecycle: LifecycleResponse
    ledger: list[HedgeStep] = Field(min_length=1, max_length=MAX_LEDGER_POINTS)
    unhedged_final_pnl: float
    hedged_final_pnl: float
    attribution: HedgeAttribution
    warnings: Warnings = Field(default_factory=list)


class DistributionRequest(OptionsModel):
    analysis: OptionsAnalysisRequest
    measure: Literal["risk_neutral", "user_drift"]
    annual_drift: AnnualRate | None = None
    confidence: float = Field(default=0.95, gt=0.5, lt=1)
    bins: int = Field(default=40, ge=10, le=100)
    integration_points: int = Field(default=4096, ge=256, le=16384)
    tail_probability: float = Field(default=1e-6, ge=1e-9, le=0.01)

    @model_validator(mode="after")
    def assumptions(self) -> Self:
        if (self.measure == "user_drift") != (self.annual_drift is not None):
            raise ValueError("annual_drift is required only for user_drift")
        days = {
            self.analysis.strategy.leg_days(leg)
            for leg in self.analysis.strategy.legs
            if leg.enabled and leg.kind != "underlying"
        }
        if len(days) > 1:
            raise ValueError("distribution initially requires a common option expiry")
        return self


class ProbabilityBin(OptionsModel):
    lower_pnl: float
    upper_pnl: float
    probability: Probability


class PnlQuantile(OptionsModel):
    probability: Probability
    pnl: float


class TerminalPriceBin(OptionsModel):
    lower_spot: float = Field(gt=0)
    upper_spot: float = Field(gt=0)
    representative_spot: float = Field(gt=0)
    probability: Probability


class TerminalPayoffPoint(OptionsModel):
    spot: float = Field(ge=0)
    pnl: float


class DistributionResponse(OptionsModel):
    request: DistributionRequest
    provenance: ResearchProvenance = Field(default_factory=ResearchProvenance)
    resolved_annual_drift: float = Field(ge=-2, le=2)
    horizon_days: Days
    terminal_log_sigma: float = Field(ge=0, le=16)
    deterministic: bool
    bins: list[ProbabilityBin] = Field(min_length=1, max_length=100)
    terminal_price_bins: list[TerminalPriceBin] = Field(min_length=1, max_length=100)
    terminal_payoff_curve: list[TerminalPayoffPoint] = Field(
        min_length=1, max_length=34
    )
    probability_positive_pnl: Probability
    expected_pnl: float
    quantiles: list[PnlQuantile] = Field(min_length=1, max_length=9)
    confidence: float = Field(gt=0.5, lt=1)
    value_at_risk: Money
    expected_shortfall: Money
    integration_method: Literal["deterministic", "normal_midpoint_quadrature_v1"]
    integration_points: int = Field(ge=1, le=16384)
    truncated_probability: Probability
    normalization_mass: float = Field(gt=0, le=1.0000001)
    numerical_error_estimate: float | None = Field(ge=0)
    warnings: Warnings = Field(default_factory=list)


class ChainStatus(OptionsModel):
    provider: Literal["tradier"] = "tradier"
    environment: Environment
    configured: bool
    available: bool
    message: str = Field(max_length=240)


class ChainStatusResponse(OptionsModel):
    environments: list[ChainStatus] = Field(min_length=2, max_length=2)


class ChainExpirationsResponse(OptionsModel):
    provider: Literal["tradier"] = "tradier"
    environment: Environment
    symbol: Symbol
    fetched_at: Timestamp
    expirations: list[ChainDate] = Field(max_length=128)
    truncated: bool = False
    warnings: Warnings = Field(default_factory=list)


class ChainQuote(OptionsModel):
    contract_symbol: str = Field(min_length=1, max_length=80)
    underlying: Symbol
    kind: Literal["call", "put"]
    strike: PositivePrice
    expiration: ChainDate
    multiplier: int | None = Field(ge=1, le=1000)
    bid: Price | None
    ask: Price | None
    bid_as_of: Timestamp | None
    ask_as_of: Timestamp | None
    implied_volatility: Volatility | None
    volume: int | None = Field(ge=0, le=10_000_000_000)
    open_interest: int | None = Field(ge=0, le=10_000_000_000)
    source: OptionsContractSource


class ChainResponse(OptionsModel):
    provider: Literal["tradier"] = "tradier"
    environment: Environment
    symbol: Symbol
    expiration: ChainDate
    fetched_at: Timestamp
    quotes: list[ChainQuote] = Field(max_length=MAX_CHAIN_QUOTES)
    truncated: bool
    warnings: Warnings = Field(default_factory=list)

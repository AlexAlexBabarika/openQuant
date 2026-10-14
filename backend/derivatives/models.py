"""Canonical manual options research contract (USD, European, cash settled).

Annual volatility, rate and continuous dividend yield are fractions. Time uses
calendar days / 365; scenario IV shifts use percentage points, not fractions.
Premiums are per underlying unit; option quantity is signed contracts, underlying
quantity is signed shares. Stock hedges use entry_premium as their entry price
and multiplier=1. Template names are descriptive labels, never execution rules.
"""

from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

Price = Annotated[float, Field(ge=0, le=1_000_000)]
PositivePrice = Annotated[float, Field(gt=0, le=1_000_000)]
Days = Annotated[float, Field(ge=0, le=3650)]
Volatility = Annotated[float, Field(ge=0, le=5)]
AnnualRate = Annotated[float, Field(ge=-1, le=1)]
TemplateName = Literal[
    "custom",
    "long_call",
    "long_put",
    "call_vertical",
    "put_vertical",
    "straddle",
    "strangle",
    "iron_condor",
    "iron_butterfly",
    "covered_call",
    "protective_put",
]


class OptionsModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid", strict=True, allow_inf_nan=False, validate_default=True
    )


class OptionLeg(OptionsModel):
    """An explicit signed option or stock leg; disabled legs do not affect results."""

    kind: Literal["call", "put", "underlying"]
    quantity: int = Field(
        ge=-1_000_000,
        le=1_000_000,
        description="Nonzero signed integer: options <=10000 contracts, underlying <=1000000 shares.",
    )
    strike: PositivePrice | None = None
    entry_premium: Price = Field(
        default=0,
        description="USD per underlying unit; stock entry price for underlying.",
    )
    multiplier: int = Field(
        default=100,
        ge=1,
        le=1000,
        description="Units per option contract; stock requires explicit 1.",
    )
    enabled: bool = True

    @model_validator(mode="after")
    def leg_semantics(self) -> Self:
        if self.quantity == 0:
            raise ValueError("quantity must be a nonzero signed integer")
        if self.kind == "underlying":
            if self.strike is not None or self.multiplier != 1:
                raise ValueError("underlying uses strike=null and multiplier=1")
        elif self.strike is None or abs(self.quantity) > 10_000:
            raise ValueError("options require a positive strike and <=10000 contracts")
        return self


class OptionStrategy(OptionsModel):
    """All enabled options share one European cash-settled expiry and USD currency."""

    name: str = Field(default="Custom options", min_length=1, max_length=120)
    template: TemplateName = Field(
        default="custom",
        description=(
            "Descriptive label only; explicit legs define the payoff. Covered call: "
            "long shares plus short calls (shares = contracts * multiplier). "
            "Protective put: long shares plus long puts with matching coverage. "
            "Verticals use same-kind opposite quantities at different strikes; "
            "straddle/strangle use call+put at equal/different strikes; condor and "
            "butterfly use outer long wings and inner shorts (butterfly equal inner strikes)."
        ),
    )
    days_to_expiry: Days = Field(
        default=30, description="Common remaining calendar days, ACT/365."
    )
    currency: Literal["USD"] = "USD"
    exercise_style: Literal["european"] = "european"
    settlement: Literal["cash"] = "cash"
    entry_fee_per_contract: float = Field(
        default=0,
        ge=0,
        le=10_000,
        description="USD per enabled option contract, charged once on abs(quantity); no stock fee.",
    )
    legs: list[OptionLeg] = Field(min_length=1, max_length=16)

    @model_validator(mode="after")
    def active_legs(self) -> Self:
        if not self.name.strip():
            raise ValueError("name must not be blank")
        if not any(leg.enabled for leg in self.legs):
            raise ValueError("at least one leg must be enabled")
        return self


class OptionsScenario(OptionsModel):
    name: str = Field(min_length=1, max_length=80)
    elapsed_days: Days = Field(
        default=0, description="Calendar days elapsed; may reach but not cross expiry."
    )
    iv_shift_pp: float = Field(
        default=0,
        ge=-100,
        le=100,
        description="Additive IV percentage points: +5 changes 0.20 to 0.25.",
    )


class OptionsAnalysisRequest(OptionsModel):
    """Manual, bounded research inputs; no provider lookup or historical execution."""

    strategy: OptionStrategy
    spot: PositivePrice
    volatility: Volatility = Field(
        default=0.2, description="Annual IV fraction, 0.20 = 20%."
    )
    rate: AnnualRate = Field(
        default=0.03, description="Annual continuously compounded rate fraction."
    )
    dividend_yield: AnnualRate = Field(
        default=0, description="Annual continuous dividend yield fraction."
    )
    spot_grid: list[Price] = Field(
        min_length=2,
        max_length=201,
        description="Strictly increasing USD spots; all P&L arrays align to this grid.",
    )
    scenarios: list[OptionsScenario] = Field(default_factory=list, max_length=3)

    @model_validator(mode="after")
    def analysis_limits(self) -> Self:
        if any(a >= b for a, b in zip(self.spot_grid, self.spot_grid[1:])):
            raise ValueError("spot_grid must be strictly increasing")
        if len({s.name for s in self.scenarios}) != len(self.scenarios):
            raise ValueError("scenario names must be unique")
        for scenario in self.scenarios:
            if not scenario.name.strip():
                raise ValueError("scenario name must not be blank")
            if scenario.elapsed_days > self.strategy.days_to_expiry:
                raise ValueError("scenario time cannot cross expiry")
            if not 0 <= self.volatility + scenario.iv_shift_pp / 100 <= 5:
                raise ValueError("shifted volatility must be between 0 and 5")
        return self


class OptionsGreeks(OptionsModel):
    """Signed strategy exposures at request.spot, weighted by quantity * multiplier.

    Null propagates any undefined/unreported active option component at expiry,
    zero IV or numerical singularities. Stock-only exposures remain defined.
    """

    delta: float | None
    gamma: float | None
    theta: float | None
    vega: float | None
    rho: float | None


class OptionsGreekUnits(OptionsModel):
    delta: Literal["USD per USD spot (equivalent shares)"] = (
        "USD per USD spot (equivalent shares)"
    )
    gamma: Literal["delta per USD spot"] = "delta per USD spot"
    theta: Literal["USD per calendar day elapsed"] = "USD per calendar day elapsed"
    vega: Literal["USD per 1 volatility percentage point"] = (
        "USD per 1 volatility percentage point"
    )
    rho: Literal["USD per 1 rate percentage point"] = "USD per 1 rate percentage point"


class OptionsProvenance(OptionsModel):
    name: Literal["black_scholes_merton"] = "black_scholes_merton"
    version: Literal["1"] = "1"
    input_source: Literal["manual"] = "manual"
    exercise_style: Literal["european"] = "european"
    settlement: Literal["cash"] = "cash"
    day_basis: Literal["ACT/365"] = "ACT/365"


class ZeroInterval(OptionsModel):
    start: Price
    end: float | None = Field(description="Inclusive end; null means +infinity.")


class OptionsSummary(OptionsModel):
    gross_entry_cost: float
    entry_fees: float
    net_entry_cost: float
    entry_debit: float
    entry_credit: float
    theoretical_value_today: float
    pnl_today: float
    max_profit: float | None = Field(
        description="Nonnegative achievable expiry gain; null only when unbounded."
    )
    max_loss: float | None = Field(
        description="Nonnegative achievable expiry loss; null only when unbounded."
    )
    profit_unbounded: bool
    loss_unbounded: bool
    breakevens: list[float] = Field(
        description="All isolated expiry roots on S>=0, excluding zero intervals."
    )
    zero_intervals: list[ZeroInterval]


class OptionsScenarioAnalysis(OptionsModel):
    name: str
    elapsed_days: float
    remaining_days: float
    volatility: float
    pnl: list[float]
    greeks: OptionsGreeks


class OptionsAnalysis(OptionsModel):
    request: OptionsAnalysisRequest
    model: OptionsProvenance = Field(default_factory=OptionsProvenance)
    summary: OptionsSummary
    spot_grid: list[float]
    today_pnl: list[float]
    expiry_pnl: list[float]
    scenarios: list[OptionsScenarioAnalysis]
    greeks: OptionsGreeks
    greek_units: OptionsGreekUnits = Field(default_factory=OptionsGreekUnits)
    greeks_grid: list[OptionsGreeks] = Field(
        description="Today-model exposures aligned with spot_grid; null means unavailable."
    )
    warnings: list[str]

"""The version-one public trial contract. Returns/drawdowns are fractions."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

StrategyId = Literal[
    "backtest-billionaire", "overcaffeinated-trader", "boring-benchmark"
]
FiniteFloat = Annotated[float, Field(allow_inf_nan=False)]
CostBps = Annotated[float, Field(strict=True, ge=0, le=50, allow_inf_nan=False)]


class TrialModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class TrialConfig(TrialModel):
    strategy_id: StrategyId
    commission_bps: CostBps = 1.0
    slippage_bps: CostBps = 5.0

    @field_validator("commission_bps", "slippage_bps")
    @classmethod
    def normalize_zero(cls, value: float) -> float:
        return 0.0 if value == 0 else value


class TrialStrategy(TrialModel):
    id: StrategyId
    name: str
    description: str
    lesson: str


class TrialCatalog(TrialModel):
    schema_version: Literal[1] = 1
    strategies: list[TrialStrategy]


class EquityPoint(TrialModel):
    t: int
    value: FiniteFloat


class RunSummary(TrialModel):
    total_return: FiniteFloat
    max_drawdown: FiniteFloat
    trade_count: int
    total_cost: FiniteFloat
    equity: list[EquityPoint]


class TrialDataset(TrialModel):
    id: str
    version: str
    label: str
    synthetic: Literal[True] = True
    start: str
    end: str
    split_date: str
    training_bars: int
    holdout_bars: int


class Holdout(TrialModel):
    strategy: RunSummary
    benchmark: RunSummary


class SensitivityPoint(TrialModel):
    parameter_value: FiniteFloat
    total_return: FiniteFloat
    max_drawdown: FiniteFloat


class SelectedParameter(TrialModel):
    name: str
    value: FiniteFloat


class Finding(TrialModel):
    id: str
    severity: Literal["info", "warning"]
    title: str
    detail: str


class TrialReport(TrialModel):
    schema_version: Literal[1] = 1
    report_id: str
    strategy: TrialStrategy
    dataset: TrialDataset
    config: TrialConfig
    baseline: RunSummary
    realistic: RunSummary
    benchmark: RunSummary
    holdout: Holdout
    sensitivity: list[SensitivityPoint]
    selected_parameter: SelectedParameter | None
    findings: list[Finding]
    assumptions: list[str]
    limitations: list[str]

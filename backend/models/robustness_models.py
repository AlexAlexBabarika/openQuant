"""Workspace robustness contracts; user source is never returned in a report."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field, StrictFloat, StrictInt, StrictStr

from backend.models.market_data_models import MarketDataProviderEnum
from backend.trial.models import CostBps, Finding, Holdout, RunSummary, TrialModel

ParameterValue = (
    StrictInt | Annotated[StrictFloat, Field(allow_inf_nan=False)] | StrictStr
)


class RobustnessRequest(TrialModel):
    code: str = Field(min_length=1, max_length=200_000)
    name: str = Field(default="Workspace strategy", min_length=1, max_length=200)
    symbol: str = Field(min_length=1, max_length=100, pattern=r"\S")
    provider: MarketDataProviderEnum
    period: str = "1y"
    interval: str = "1d"
    starting_cash: float = Field(default=100_000, gt=0, le=1e12, allow_inf_nan=False)
    seed: int = Field(default=0, ge=0, le=2**32 - 1)
    params: dict[str, ParameterValue] = Field(default_factory=dict, max_length=16)
    commission_bps: CostBps = 1.0
    slippage_bps: CostBps = 5.0
    holdout_fraction: float = Field(default=0.3, ge=0.1, le=0.5, allow_inf_nan=False)
    sensitivity_parameter: str | None = Field(default=None, max_length=100)


class WorkspaceStrategy(TrialModel):
    id: Literal["workspace"] = "workspace"
    name: str
    description: str
    lesson: str


class WorkspaceDataset(TrialModel):
    id: str
    version: str
    label: str
    synthetic: Literal[False] = False
    start: str
    end: str
    split_date: str
    training_bars: int
    holdout_bars: int


class WorkspaceConfig(TrialModel):
    strategy_id: Literal["workspace"] = "workspace"
    commission_bps: float
    slippage_bps: float
    starting_cash: float
    seed: int
    params: dict[str, ParameterValue]
    holdout_fraction: float
    sensitivity_parameter: str | None


class WorkspaceParameter(TrialModel):
    name: str
    value: ParameterValue


class WorkspaceSensitivity(TrialModel):
    parameter_value: ParameterValue
    total_return: float = Field(allow_inf_nan=False)
    max_drawdown: float = Field(allow_inf_nan=False)


class WorkspaceReport(TrialModel):
    schema_version: Literal[1] = 1
    source: Literal["workspace"] = "workspace"
    report_id: str
    code_hash: str
    engine_version: str
    strategy: WorkspaceStrategy
    dataset: WorkspaceDataset
    config: WorkspaceConfig
    baseline: RunSummary
    realistic: RunSummary
    benchmark: RunSummary
    holdout: Holdout
    sensitivity: list[WorkspaceSensitivity]
    selected_parameter: WorkspaceParameter | None
    findings: list[Finding]
    assumptions: list[str]
    limitations: list[str]

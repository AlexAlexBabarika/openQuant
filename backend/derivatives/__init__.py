"""Manual European options analytics, not an execution or provider interface.

Trusted Python: ``analyze_options(request_dict_or_model).model_dump(mode="json")``.
Workers should inject only this callable, never expose arbitrary imports. The
entrypoint accepts the same bounded schema as API/GUI consumers. Entry premiums
and fees remain fixed; results exclude financing, assignment and execution.
"""

from .analytics import analyze_options
from .models import (
    OptionLeg,
    OptionStrategy,
    OptionsAnalysis,
    OptionsAnalysisRequest,
    OptionsContractSource,
    OptionsExpiryPoint,
    OptionsLegAnalysis,
    OptionsHorizon,
    OptionsLegHorizon,
    OptionsScenario,
    OptionsSurfaceAnalysis,
    OptionsSurfaceRequest,
)

__all__ = [
    "OptionLeg",
    "OptionStrategy",
    "OptionsAnalysis",
    "OptionsAnalysisRequest",
    "OptionsContractSource",
    "OptionsHorizon",
    "OptionsLegHorizon",
    "OptionsExpiryPoint",
    "OptionsLegAnalysis",
    "OptionsScenario",
    "OptionsSurfaceAnalysis",
    "OptionsSurfaceRequest",
    "analyze_options",
]

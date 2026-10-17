"""Trusted pure research API. Not injected into untrusted strategy Python."""

from .research_distribution import analyze_distribution
from .research_finder import find_strategies
from .research_paths import evaluate_lifecycle, simulate_hedge

__all__ = [
    "find_strategies",
    "evaluate_lifecycle",
    "simulate_hedge",
    "analyze_distribution",
]

"""Bounded options research in the existing best-effort spawned sandbox."""

from __future__ import annotations

import io
import json
import os
import threading
from contextlib import redirect_stderr, redirect_stdout
from typing import Any

from pydantic import ValidationError

from backend.derivatives import (
    OptionLeg,
    OptionStrategy,
    OptionsAnalysis,
    OptionsAnalysisRequest,
    analyze_options,
)
from backend.scripts.ast_guard import ScriptValidationError, validate
from backend.scripts.runner import (
    DEFAULT_MEMORY_MB,
    _apply_resource_limits,
    _block_network,
    spawn_and_collect,
)
from backend.scripts.sandbox_globals import _SAFE_BUILTINS

MAX_SOURCE_LENGTH = 20_000
MAX_STDOUT_BYTES = 16_384
MAX_OUTPUT_BYTES = 262_144
DEFAULT_TIMEOUT_S = 5.0
_WORKERS = threading.BoundedSemaphore(2)


class OptionsRunError(ValueError):
    pass


class OptionsTimeoutError(TimeoutError):
    pass


class OptionsBusyError(RuntimeError):
    pass


class _BoundedText(io.StringIO):
    def __init__(self) -> None:
        super().__init__()
        self.size = 0

    def write(self, text: str) -> int:
        self.size += len(text.encode("utf-8"))
        if self.size > MAX_STDOUT_BYTES:
            raise OptionsRunError("Python output exceeds 16384 bytes")
        return super().write(text)


def _option_leg(**kwargs: Any) -> dict:
    return OptionLeg.model_validate(kwargs).model_dump(mode="json")


def _option_strategy(**kwargs: Any) -> dict:
    return OptionStrategy.model_validate(kwargs).model_dump(mode="json")


def _analyze_options(payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise OptionsRunError("analyze_options expects a request dictionary")
    return analyze_options(payload).model_dump(mode="json")


def _bounded_json(value: Any) -> None:
    try:
        size = 0
        for chunk in json.JSONEncoder(allow_nan=False, ensure_ascii=False).iterencode(
            value
        ):
            size += len(chunk.encode("utf-8"))
            if size > MAX_OUTPUT_BYTES:
                raise OptionsRunError("Options output exceeds 262144 bytes")
    except OptionsRunError:
        raise
    except (TypeError, ValueError, RecursionError) as exc:
        raise OptionsRunError("Result must be finite JSON options analysis") from exc


def _validated_analysis(value: Any) -> OptionsAnalysis:
    _bounded_json(value)
    analysis = OptionsAnalysis.model_validate(value)
    points = analysis.request.spot_grid
    if (
        analysis.spot_grid != points
        or len(analysis.today_pnl) != len(points)
        or len(analysis.expiry_pnl) != len(points)
        or len(analysis.greeks_grid) != len(points)
        or len(analysis.scenarios) != len(analysis.request.scenarios)
        or any(len(s.pnl) != len(points) for s in analysis.scenarios)
    ):
        raise OptionsRunError("Result curves must match the analysis request")
    vertices = sorted(
        {
            points[0],
            points[-1],
            *(
                leg.strike
                for leg in analysis.request.strategy.legs
                if leg.enabled
                and leg.strike is not None
                and points[0] <= leg.strike <= points[-1]
            ),
            *(s for s in analysis.summary.breakevens if points[0] <= s <= points[-1]),
        }
    )
    if [point.spot for point in analysis.expiry_curve] != vertices:
        raise OptionsRunError("Result expiry vertices must match the analysis domain")
    if len(analysis.legs) != len(analysis.request.strategy.legs) or any(
        result.leg_index != index
        or result.enabled != leg.enabled
        or result.resolved_implied_volatility
        != (
            None
            if leg.kind == "underlying"
            else (
                analysis.request.volatility
                if leg.implied_volatility is None
                else leg.implied_volatility
            )
        )
        for index, (result, leg) in enumerate(
            zip(analysis.legs, analysis.request.strategy.legs)
        )
    ):
        raise OptionsRunError("Result legs must match the analysis request")
    config, surface = analysis.request.surface, analysis.surface
    if config is None:
        if surface is not None:
            raise OptionsRunError("Unexpected result surface")
    elif (
        surface is None
        or surface.axis != config.axis
        or surface.spots != config.spots
        or surface.steps != config.steps
        or len(surface.pnl) != len(config.steps)
        or any(len(row) != len(config.spots) for row in surface.pnl)
    ):
        raise OptionsRunError("Result surface dimensions must match the request")
    return analysis


def _child_main(conn, request: dict | None, source: str | None) -> None:
    _apply_resource_limits(DEFAULT_MEMORY_MB)
    _block_network()
    try:
        os.close(0)
    except OSError:
        pass

    output = _BoundedText()
    payload: dict = {"status": "ok"}
    try:
        if source is None:
            assert request is not None
            result = _analyze_options(request)
        else:
            namespace: dict[str, Any] = {
                "__builtins__": dict(_SAFE_BUILTINS),
                "OptionLeg": _option_leg,
                "OptionStrategy": _option_strategy,
                "analyze_options": _analyze_options,
            }
            with redirect_stdout(output), redirect_stderr(output):
                exec(compile(source, "<options>", "exec"), namespace)
            if "result" not in namespace:
                raise OptionsRunError("Draft must assign result = analyze_options(...)")
            result = namespace["result"]
        analysis = _validated_analysis(result)
        canonical = analyze_options(analysis.request).model_dump(mode="json")
        if result != canonical:
            raise OptionsRunError(
                "result must be an unmodified analyze_options response"
            )
        if output.size > MAX_STDOUT_BYTES:
            raise OptionsRunError("Python output exceeds 16384 bytes")
        if source is not None and output.getvalue():
            canonical["stdout"] = output.getvalue()
        payload["analysis"] = canonical
        _bounded_json(payload)
    except ValidationError as exc:
        errors = "; ".join(
            f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors()
        )
        payload = {
            "status": "error",
            "error": f"Invalid options inputs/result: {errors}"[:2000],
        }
    except BaseException as exc:
        payload = {"status": "error", "error": f"{type(exc).__name__}: {exc}"[:2000]}
    try:
        conn.send(payload)
    finally:
        conn.close()


def _run(request: dict | None, source: str | None, timeout_s: float) -> dict:
    if not _WORKERS.acquire(blocking=False):
        raise OptionsBusyError("Options workers are busy; retry shortly")
    try:
        payload, timed_out, exitcode = spawn_and_collect(
            _child_main, (request, source), timeout_s
        )
    finally:
        _WORKERS.release()
    if timed_out:
        raise OptionsTimeoutError("Options analysis timed out")
    if payload is None:
        raise OptionsRunError(
            f"Options worker exited without a result (exit code {exitcode})"
        )
    _bounded_json(payload)
    if payload.get("status") != "ok":
        raise OptionsRunError(
            str(payload.get("error", "Options analysis failed"))[:2000]
        )
    result = dict(payload["analysis"])
    stdout = result.pop("stdout", "")
    analysis = _validated_analysis(result).model_dump(mode="json")
    if not isinstance(stdout, str) or len(stdout.encode("utf-8")) > MAX_STDOUT_BYTES:
        raise OptionsRunError("Invalid Python output")
    if source is not None and stdout:
        analysis["stdout"] = stdout
    return analysis


def run_options_analysis(
    request: dict | OptionsAnalysisRequest, *, timeout_s: float = DEFAULT_TIMEOUT_S
) -> OptionsAnalysis:
    validated = OptionsAnalysisRequest.model_validate(request)
    result = _run(validated.model_dump(mode="json"), None, timeout_s)
    return OptionsAnalysis.model_validate(result)


def run_options_python(source: str, *, timeout_s: float = DEFAULT_TIMEOUT_S) -> dict:
    if (
        not isinstance(source, str)
        or not source.strip()
        or len(source) > MAX_SOURCE_LENGTH
    ):
        raise OptionsRunError("source must contain 1..20000 characters of Python")
    try:
        validate(source)
    except (ScriptValidationError, RecursionError) as exc:
        raise OptionsRunError(f"Invalid options Python: {exc}"[:2000]) from exc
    return _run(None, source, timeout_s)

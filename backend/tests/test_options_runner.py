"""Options Python uses the existing sandbox, not server-process evaluation."""

from __future__ import annotations

import json
import threading

import pytest

from backend.derivatives import OptionsAnalysis, analyze_options
from backend.derivatives import runner

EXPORT_SOURCE = """strategy = OptionStrategy(
    name="Call vertical", template="call_vertical", days_to_expiry=30,
    entry_fee_per_contract=1,
    legs=[
        OptionLeg(kind="call", quantity=1, strike=100, entry_premium=5),
        OptionLeg(kind="call", quantity=-1, strike=110, entry_premium=2),
    ],
)
result = analyze_options({
    "strategy": strategy, "spot": 100, "volatility": 0.20,
    "rate": 0.03, "dividend_yield": 0,
    "spot_grid": [80, 90, 100, 110, 120],
    "scenarios": [{"name": "Ten days +5 pp", "elapsed_days": 10, "iv_shift_pp": 5}],
})
"""


def request_payload() -> dict:
    return {
        "strategy": {
            "legs": [{"kind": "call", "quantity": 1, "strike": 100, "entry_premium": 5}]
        },
        "spot": 100,
        "spot_grid": [80, 100, 120],
    }


def test_analysis_spawn_matches_canonical() -> None:
    request = request_payload()
    result = runner.run_options_analysis(request)
    assert result == analyze_options(request)
    json.dumps(result.model_dump(mode="json"), allow_nan=False)


def test_editor_export_runs_without_imports_and_preserves_full_contract() -> None:
    result = runner.run_options_python(EXPORT_SOURCE + 'print("manual research")\n')
    assert result.pop("stdout") == "manual research\n"
    analysis = OptionsAnalysis.model_validate(result)
    assert analysis.request.strategy.template == "call_vertical"
    assert analysis.request.strategy.entry_fee_per_contract == 1
    assert analysis.summary.entry_fees == 2
    assert analysis.scenarios[0].volatility == 0.25
    assert result == analyze_options(analysis.request).model_dump(mode="json")


def test_no_stdout_and_safe_math_import() -> None:
    result = runner.run_options_python("import math\n" + EXPORT_SOURCE)
    assert "stdout" not in result
    assert set(result) == set(OptionsAnalysis.model_fields)


@pytest.mark.parametrize(
    "source",
    [
        "import os\nos.system('true')",
        "import socket",
        "from backend.derivatives import analyze_options",
        "open('private-file')",
        "__import__('os')",
        "OptionLeg.__globals__",
        "().__class__.__bases__",
        "result = eval('1')",
        "result =",
        "",
        "  \n",
        "x" * (runner.MAX_SOURCE_LENGTH + 1),
    ],
)
def test_invalid_source_rejected_before_spawn(source: str, monkeypatch) -> None:
    def unexpected(*args, **kwargs):
        pytest.fail("invalid source must not start a worker")

    monkeypatch.setattr(runner, "spawn_and_collect", unexpected)
    with pytest.raises(runner.OptionsRunError):
        runner.run_options_python(source)


@pytest.mark.parametrize(
    ("source", "message"),
    [
        ("x = 1", "must assign result"),
        ("result = {}", "Invalid options inputs/result"),
        ("result = float('nan')", "finite JSON"),
        (EXPORT_SOURCE + "result['today_pnl'][0] = float('inf')", "finite JSON"),
        (EXPORT_SOURCE + "result['today_pnl'].pop()", "curves must match"),
        (EXPORT_SOURCE + "result['summary']['pnl_today'] = 123", "unmodified"),
        (EXPORT_SOURCE + "result['warnings'] = []", "unmodified"),
        ("raise RuntimeError('draft failed')", "draft failed"),
        ("print('x' * 17000)", "output exceeds"),
        ("print('😀' * 5000)", "output exceeds"),
        (EXPORT_SOURCE + "result['warnings'] = ['x' * 262145]", "output exceeds"),
        ("OptionLeg(kind='call', quantity=True, strike=100)", "Invalid options inputs"),
        ("OptionStrategy(legs=[])", "Invalid options inputs"),
        (
            "result = analyze_options({'strategy': {}, 'spot': float('nan')})",
            "Invalid options inputs",
        ),
        ("result = analyze_options(42)", "request dictionary"),
    ],
)
def test_bad_python_inputs_or_results_fail_cleanly(source: str, message: str) -> None:
    with pytest.raises(runner.OptionsRunError, match=message):
        runner.run_options_python(source)


def test_python_infinite_loop_timeout() -> None:
    with pytest.raises(runner.OptionsTimeoutError, match="timed out"):
        runner.run_options_python("while True:\n    pass", timeout_s=1)


def test_fixed_spawn_entrypoint_and_parent_does_not_execute_source(monkeypatch) -> None:
    result = analyze_options(request_payload()).model_dump(mode="json")
    calls = []

    def collect(target, args, timeout):
        calls.append((target, args, timeout))
        return {"status": "ok", "analysis": result}, False, 0

    monkeypatch.setattr(runner, "spawn_and_collect", collect)
    runner.run_options_python("raise RuntimeError('only child may execute this')")
    assert calls == [
        (
            runner._child_main,
            (None, "raise RuntimeError('only child may execute this')"),
            5.0,
        )
    ]


def test_worker_calls_shared_resource_and_network_controls(monkeypatch) -> None:
    calls = []
    monkeypatch.setattr(
        runner, "_apply_resource_limits", lambda mb: calls.append(("limits", mb))
    )
    monkeypatch.setattr(runner, "_block_network", lambda: calls.append(("network",)))
    monkeypatch.setattr(runner.os, "close", lambda fd: calls.append(("close", fd)))

    class Connection:
        def send(self, payload):
            calls.append(("payload", payload["status"]))

        def close(self):
            calls.append(("connection_closed",))

    runner._child_main(Connection(), request_payload(), None)
    assert calls == [
        ("limits", runner.DEFAULT_MEMORY_MB),
        ("network",),
        ("close", 0),
        ("payload", "ok"),
        ("connection_closed",),
    ]


@pytest.mark.parametrize(
    "timed_out,exitcode,error",
    [(True, None, runner.OptionsTimeoutError), (False, 9, runner.OptionsRunError)],
)
def test_worker_timeout_or_exit_and_slot_release(
    monkeypatch, timed_out, exitcode, error
) -> None:
    monkeypatch.setattr(
        runner, "spawn_and_collect", lambda *args: (None, timed_out, exitcode)
    )
    with pytest.raises(error):
        runner.run_options_python("x = 1")
    assert runner._WORKERS.acquire(blocking=False)
    runner._WORKERS.release()


def test_busy_workers_never_spawn(monkeypatch) -> None:
    monkeypatch.setattr(runner, "_WORKERS", threading.BoundedSemaphore(0))
    with pytest.raises(runner.OptionsBusyError):
        runner.run_options_python("x = 1")


def test_parent_checks_nonfinite_worker_output(monkeypatch) -> None:
    result = analyze_options(request_payload()).model_dump(mode="json")
    result["greeks"]["delta"] = float("nan")
    monkeypatch.setattr(
        runner,
        "spawn_and_collect",
        lambda *args: ({"status": "ok", "analysis": result}, False, 0),
    )
    with pytest.raises(runner.OptionsRunError, match="finite JSON"):
        runner.run_options_python("x = 1")


def test_caught_output_overflow_still_fails() -> None:
    source = (
        "try:\n    print('x' * 17000)\nexcept ValueError:\n    pass\n" + EXPORT_SOURCE
    )
    with pytest.raises(runner.OptionsRunError, match="output exceeds"):
        runner.run_options_python(source)

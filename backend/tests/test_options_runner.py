"""Options Python uses the existing sandbox, not server-process evaluation."""

from __future__ import annotations

import json
import threading

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

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


def expanded_payload(axis="elapsed_days") -> dict:
    payload = request_payload()
    payload["strategy"].update(
        underlying="XYZ",
        valuation_date="2026-10-14",
        expiry_date="2026-11-13",
        days_to_expiry=30,
        entry_fee_per_contract=1.25,
        legs=[
            dict(
                kind="call",
                quantity=1,
                strike=100,
                entry_premium=5,
                implied_volatility=0.35,
                bid=4.9,
                ask=5.1,
                quote_as_of="2026-10-14T10:00:00Z",
            ),
            dict(kind="put", quantity=-1, strike=95, entry_premium=2),
            dict(kind="underlying", quantity=10, multiplier=1, entry_premium=98),
            dict(
                kind="call", quantity=2, strike=110, implied_volatility=0, enabled=False
            ),
        ],
    )
    payload["spot_grid"] = [50, 150]
    payload["scenarios"] = [dict(name="Shift", elapsed_days=10, iv_shift_pp=5)]
    payload["surface"] = dict(
        axis=axis,
        spots=[0, 80, 100, 120],
        steps=[0, 10, 30] if axis == "elapsed_days" else [-10, 0, 10],
    )
    return payload


def maximum_payload(axis="elapsed_days") -> dict:
    payload = expanded_payload(axis)
    payload["strategy"]["name"] = "\x01" * 120
    payload["strategy"]["underlying"] = "😀" * 80
    payload["strategy"]["entry_fee_per_contract"] = 9999.123456789012
    payload["strategy"]["legs"] = [
        dict(
            kind="call" if i % 2 else "put",
            quantity=9999 if i % 2 else -9999,
            strike=90.12345678901234 + i,
            entry_premium=999999.123456789,
            multiplier=999,
            implied_volatility=0.212345678901234 + i / 100,
            bid=999998.123456789,
            ask=999999.123456789,
            quote_as_of="2026-10-14T10:00:00.123456+00:00",
        )
        for i in range(16)
    ]
    payload["spot_grid"] = [i + 0.12345678901234 for i in range(201)]
    payload["scenarios"] = [
        dict(name=str(i) + "\x01" * 79, elapsed_days=i, iv_shift_pp=i) for i in range(3)
    ]
    payload["surface"] = dict(
        axis=axis,
        spots=[i * 5 + 0.12345678901234 for i in range(41)],
        steps=[i * 1.5 for i in range(21)]
        if axis == "elapsed_days"
        else list(range(-10, 11)),
    )
    return payload


@pytest.mark.parametrize("axis", ["elapsed_days", "iv_shift_pp"])
def test_expanded_real_spawn_and_python_export_equivalence(axis) -> None:
    request = expanded_payload(axis)
    canonical = analyze_options(request)
    assert runner.run_options_analysis(request) == canonical
    source = f"result = analyze_options({request!r})"
    assert runner.run_options_python(source) == canonical.model_dump(mode="json")
    assert canonical.surface is not None
    assert canonical.request.strategy.legs[0].quote_as_of == "2026-10-14T10:00:00Z"
    assert canonical.legs[-1].greeks.delta == 0


@pytest.mark.parametrize("axis", ["elapsed_days", "iv_shift_pp"])
def test_maximum_response_and_maximum_escaped_stdout_fit_fixed_output_cap(axis) -> None:
    request = maximum_payload(axis)
    canonical = analyze_options(request).model_dump(mode="json")
    assert runner.run_options_analysis(request).model_dump(mode="json") == canonical
    source = f"result = analyze_options({request!r})\nprint('\\x01' * 16383)"
    assert len(source) <= runner.MAX_SOURCE_LENGTH
    result = runner.run_options_python(source)
    assert result.pop("stdout") == "\x01" * 16383 + "\n"
    assert result == canonical
    envelope = {"status": "ok", "analysis": {**result, "stdout": "\x01" * 16383 + "\n"}}
    encoded = json.dumps(envelope, ensure_ascii=False, allow_nan=False).encode("utf-8")
    assert len(encoded) < runner.MAX_OUTPUT_BYTES
    runner._bounded_json(envelope)
    assert len(result["surface"]["pnl"]) == 21
    assert all(len(row) == 41 for row in result["surface"]["pnl"])
    assert len(result["greeks_grid"]) == 201
    assert len(result["legs"]) == 16
    assert runner.DEFAULT_TIMEOUT_S == 5
    assert runner.MAX_OUTPUT_BYTES == 262144


@pytest.mark.parametrize("endpoint", ["analyze", "python"])
@pytest.mark.parametrize("axis", ["elapsed_days", "iv_shift_pp"])
def test_both_http_endpoints_preserve_full_expanded_canonical_response(
    monkeypatch, endpoint, axis
) -> None:
    from backend.routes import options_routes

    monkeypatch.setattr(options_routes, "allow", lambda key: True)
    app = FastAPI()
    app.include_router(options_routes.router)
    client = TestClient(app)
    request = maximum_payload(axis)
    body = (
        request
        if endpoint == "analyze"
        else {"source": f"result = analyze_options({request!r})"}
    )
    response = client.post(f"/options/{endpoint}", json=body)
    assert response.status_code == 200, response.text
    assert response.json() == analyze_options(request).model_dump(mode="json")
    assert {"legs", "expiry_curve", "surface"} <= response.json().keys()


@pytest.mark.parametrize(
    "edit,message",
    [
        ("result['expiry_curve'].pop(1)", "expiry vertices"),
        ("result['expiry_curve'].reverse()", "expiry vertices"),
        ("result['expiry_curve'][0]['pnl'] += 1", "unmodified"),
        ("result['legs'].pop()", "legs must match"),
        ("result['legs'][0]['leg_index'] = 1", "legs must match"),
        ("result['legs'][0]['enabled'] = False", "legs must match"),
        ("result['legs'][0]['resolved_implied_volatility'] = .2", "legs must match"),
        ("result['legs'][0]['pnl_today'] += 1", "unmodified"),
        ("result['surface']['pnl'].pop()", "surface dimensions"),
        ("result['surface']['pnl'][0].pop()", "surface dimensions"),
        ("result['surface']['spots'][0] = 1", "surface dimensions"),
        ("result['surface']['steps'][0] = 1", "surface dimensions"),
        ("result['surface']['axis'] = 'iv_shift_pp'", "surface dimensions"),
        ("result['surface'] = None", "surface dimensions"),
        ("result['surface']['pnl'][0][0] += 1", "unmodified"),
        ("result['surface']['pnl'][0][0] = float('nan')", "finite JSON"),
        ("result['expiry_curve'][0]['pnl'] = float('inf')", "finite JSON"),
        ("result['legs'][0]['greeks']['vega'] = float('nan')", "finite JSON"),
    ],
)
def test_new_python_outputs_must_be_finite_complete_and_unmodified(
    edit, message
) -> None:
    source = f"result = analyze_options({expanded_payload()!r})\n{edit}"
    with pytest.raises(runner.OptionsRunError, match=message):
        runner.run_options_python(source)


@pytest.mark.parametrize("field", ["expiry_curve", "legs", "surface"])
def test_parent_revalidates_new_nonfinite_worker_output(monkeypatch, field) -> None:
    result = analyze_options(expanded_payload()).model_dump(mode="json")
    if field == "expiry_curve":
        result[field][0]["pnl"] = float("nan")
    elif field == "legs":
        result[field][0]["pnl_today"] = float("nan")
    else:
        result[field]["pnl"][0][0] = float("nan")
    monkeypatch.setattr(
        runner,
        "spawn_and_collect",
        lambda *args: ({"status": "ok", "analysis": result}, False, 0),
    )
    with pytest.raises(runner.OptionsRunError, match="finite JSON"):
        runner.run_options_python("x = 1")


def test_unrequested_surface_is_rejected() -> None:
    result = analyze_options(expanded_payload()).model_dump(mode="json")
    result["request"]["surface"] = None
    with pytest.raises(runner.OptionsRunError, match="Unexpected result surface"):
        runner._validated_analysis(result)

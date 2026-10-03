# backend/backtesting/optimize/runner.py
"""Parallel sweep execution.

A ``ProcessPoolExecutor`` sized to the CPU count evaluates trials. The strategy
code and the frame are bound once per worker via the pool ``initializer`` —
not re-pickled per trial — and each worker applies the sandbox's network block
and resource limits, so untrusted strategy code runs under the same constraints
as a single run. Identical parameter combinations are deduplicated through the
trial cache, satisfying the "repeat the sweep -> byte-identical" criterion
together with engine determinism.

Workers run validated strategy code directly (validation happens once, up front)
rather than nesting another spawn-sandbox per trial; the pool worker *is* the
isolation boundary. Each trial gets a fresh strategy namespace so module state
cannot depend on which trials previously ran on that worker.
"""

from __future__ import annotations

import dataclasses
import os
import uuid
from concurrent.futures import ProcessPoolExecutor, as_completed
from concurrent.futures.process import BrokenProcessPool
from typing import Callable

import polars as pl

from backend.backtesting.engine import equity_curve_hash, run_backtest
from backend.backtesting.optimize.cache import TrialCache, code_hash, trial_key
from backend.backtesting.optimize.search import grid, random_search
from backend.backtesting.optimize.space import Param
from backend.backtesting.optimize.types import (
    SweepConfig,
    SweepResult,
    Trial,
    metric_value,
)
from backend.backtesting.sandbox import (
    DEFAULT_MEMORY_MB,
    _FunctionStrategy,
    _strategy_globals,
    parse_strategy_schema,
)
from backend.scripts.ast_guard import validate
from backend.scripts.runner import _apply_resource_limits, _block_network

ProgressFn = Callable[[int, int, Trial], None]
CancelFn = Callable[[], bool]


class SweepError(RuntimeError):
    """A sweep could not be completed (e.g. a worker process died)."""


# Per-worker bound state, set by the initializer.
_W: dict = {}


def _worker_init(
    code: str, frame: pl.DataFrame, starting_cash: float, seed: int
) -> None:
    _block_network()
    _apply_resource_limits(DEFAULT_MEMORY_MB)
    _W["compiled"] = compile(code, "<strategy>", "exec")
    _W["frame"] = frame
    _W["cash"] = starting_cash
    _W["seed"] = seed


def _run_trial(item: tuple[int, dict]) -> tuple[int, dict, dict, str]:
    trial_id, params = item
    g = _strategy_globals()
    exec(_W["compiled"], g)
    result = run_backtest(
        frame=_W["frame"],
        strategy=_FunctionStrategy(g["on_bar"]),
        starting_cash=_W["cash"],
        seed=_W["seed"],
        params=params,
    )
    metrics = dataclasses.asdict(result.metrics)
    return trial_id, params, metrics, equity_curve_hash(result.equity_curve)


def _build_space(schema: dict[str, Param], vary: list[str]) -> dict[str, Param]:
    missing = [k for k in vary if k not in schema]
    if missing:
        raise ValueError(f"varied params not declared by the strategy: {missing}")
    return {k: schema[k] for k in vary}


def _combos(config: SweepConfig, space: dict[str, Param]) -> list[dict]:
    if config.search == "grid":
        gen = grid(space)
    elif config.search == "random":
        gen = random_search(space, n=config.n_random, seed=config.seed)
    else:
        raise ValueError(f"unknown search {config.search!r}")
    return [{**config.fixed, **c} for c in gen]


def run_sweep(
    *,
    code: str,
    frame: pl.DataFrame,
    config: SweepConfig,
    progress: ProgressFn | None = None,
    should_cancel: CancelFn | None = None,
    max_workers: int | None = None,
) -> SweepResult:
    """Evaluate every combination the search produces and return all trials."""
    validate(code)
    schema = parse_strategy_schema(code)
    space = _build_space(schema, config.vary)
    combos = _combos(config, space)
    defaults = {name: p.values()[0] for name, p in schema.items()}
    combos = [{**defaults, **params} for params in combos]

    ch = code_hash(code)
    cache = TrialCache()
    keys = [
        trial_key(
            code_hash=ch, params=p, data_version=config.data_version, seed=config.seed
        )
        for p in combos
    ]

    # Group combo indices that share a key. Identical params (common in random
    # search) compute once; the duplicate indices are filled from that result and
    # flagged ``cached`` — this is the dedup the acceptance criterion exercises.
    groups: dict[str, list[int]] = {}
    for i, key in enumerate(keys):
        groups.setdefault(key, []).append(i)
    representatives = [(idxs[0], combos[idxs[0]]) for idxs in groups.values()]

    total = len(combos)
    done = 0
    trials: list[Trial | None] = [None] * total
    workers = max_workers or (os.cpu_count() or 1)

    def _emit(i: int, metrics: dict, ehash: str, cached: bool) -> None:
        nonlocal done
        t = Trial(i, combos[i], metrics, ehash, cached=cached)
        trials[i] = t
        done += 1
        if progress is not None:
            progress(done, total, t)

    def _fill_group(key: str, metrics: dict, ehash: str) -> None:
        # The representative (rank 0) is freshly computed; the rest are cache hits.
        for rank, idx in enumerate(groups[key]):
            _emit(idx, metrics, ehash, cached=(rank != 0))

    if representatives:
        # submit + as_completed (not map) so one trial raising — a strategy
        # runtime error on a particular param combo — is isolated to that trial
        # instead of aborting the whole sweep and discarding every other result.
        # A failed trial carries empty metrics, which ``metric_value`` scores as
        # -inf, so it sinks to the bottom and is never chosen as best.
        with ProcessPoolExecutor(
            max_workers=workers,
            initializer=_worker_init,
            initargs=(code, frame, config.starting_cash, config.seed),
        ) as ex:
            futures = {ex.submit(_run_trial, rep): rep[0] for rep in representatives}
            try:
                for fut in as_completed(futures):
                    key = keys[futures[fut]]
                    try:
                        _rep_index, _params, metrics, ehash = fut.result()
                    except BrokenProcessPool:
                        raise  # worker died — not recoverable per-trial; see below
                    except Exception:
                        _fill_group(key, {}, "")  # isolate this trial's failure
                    else:
                        cache.put(key, {"metrics": metrics, "equity_hash": ehash})
                        _fill_group(key, metrics, ehash)
                    if should_cancel is not None and should_cancel():
                        break
            except BrokenProcessPool as e:
                raise SweepError(
                    "a sweep worker process died (likely the memory/CPU limit)"
                ) from e

    final = [t for t in trials if t is not None]
    best_id = None
    if final:
        best = max(final, key=lambda t: metric_value(t.metrics, config.metric))
        best_id = best.trial_id

    return SweepResult(
        sweep_id=uuid.uuid4().hex, config=config, trials=final, best_trial_id=best_id
    )

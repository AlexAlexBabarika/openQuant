# backend/routes/portfolio_routes.py
"""Portfolio (multi-asset) backtest endpoint — store-backed.

Runs one strategy script against a universe of symbols inside the spawn sandbox
(``run_portfolio_strategy``) and returns the full canonical portfolio blob plus
run status and captured stdout/stderr. Market data is read from the on-disk
datastore (raw bars + read-time corporate-action adjustment), NOT fetched live:
a missing symbol is a 4xx asking the user to ingest first. The universe is either
an explicit symbol list or a survivorship-correct index handle resolved from
historical membership. Every result records the store's ``data_version``.
"""

from __future__ import annotations

import dataclasses
import logging
from datetime import datetime, timezone

import polars as pl
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from backend.backtesting.multi.constraints import Constraints
from backend.backtesting.multi.sandbox import (
    parse_portfolio_strategy_schema,
    run_portfolio_strategy,
)
from backend.backtesting.multi.universe import Universe
from backend.backtesting.run_config import RunInputs
from backend.backtesting.run_snapshot import assemble_snapshot
from backend.backtesting.run_store import RunStore
from backend.datastore.errors import DataNotFound
from backend.datastore.layout import StoreLayout
from backend.datastore.store import HistoricalStore
from backend.models.market_data_models import MarketDataProviderEnum
from backend.scripts.ast_guard import ScriptValidationError

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/portfolio-backtests", tags=["portfolio-backtests"])

_RUN_TIMEOUT_S = 30.0
_MAX_SYMBOLS = 50

# Module-level store handles (overridable in tests).
_STORE_LAYOUT = StoreLayout.default()
_STORE_PROVIDER = "yfinance"


def _store() -> HistoricalStore:
    return HistoricalStore(_STORE_LAYOUT, provider_name=_STORE_PROVIDER)


_RUN_STORE = RunStore.default()


def _persist_portfolio(
    blob, *, code, params, data_version, seed, starting_cash, universe, constraints
) -> str:
    inputs = RunInputs(
        code=code,
        params=params,
        data_version=data_version,
        seed=seed,
        starting_cash=starting_cash,
        universe=universe,
        constraints=constraints,
    )
    return _RUN_STORE.write(assemble_snapshot(blob, inputs))


class ConstraintsModel(BaseModel):
    max_position_weight: float | None = None
    max_position_value: float | None = None
    max_sector_weight: float | None = None
    sectors: dict[str, str] = Field(default_factory=dict)
    long_only: bool = False
    no_short: list[str] = Field(default_factory=list)
    no_trade: list[str] = Field(default_factory=list)
    max_gross: float | None = None
    max_net: float | None = None
    min_trade_value: float = 0.0

    def to_constraints(self) -> Constraints:
        return Constraints(
            max_position_weight=self.max_position_weight,
            max_position_value=self.max_position_value,
            max_sector_weight=self.max_sector_weight,
            sectors=self.sectors or None,
            long_only=self.long_only,
            no_short=frozenset(self.no_short),
            no_trade=frozenset(self.no_trade),
            max_gross=self.max_gross,
            max_net=self.max_net,
            min_trade_value=self.min_trade_value,
        )


class PortfolioRunRequest(BaseModel):
    code: str = Field(..., min_length=1, max_length=200_000)
    symbols: list[str] | None = Field(default=None, max_length=_MAX_SYMBOLS)
    index: str | None = None
    start: str | None = None  # ISO date, inclusive
    end: str | None = None  # ISO date, exclusive
    provider: MarketDataProviderEnum
    starting_cash: float = Field(100_000.0, gt=0, allow_inf_nan=False)
    seed: int = 0
    params: dict = Field(default_factory=dict)
    constraints: ConstraintsModel | None = None


def _parse_day(value: str | None, field: str) -> datetime | None:
    if value is None:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError as e:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"bad {field} date: {value}"
        ) from e


def _clip(
    frame: pl.DataFrame, start: datetime | None, end: datetime | None
) -> pl.DataFrame:
    expr = pl.lit(True)
    if start is not None:
        expr = expr & (pl.col("timestamp") >= start)
    if end is not None:
        expr = expr & (pl.col("timestamp") < end)
    return frame.filter(expr)


@router.post("/run")
async def run(body: PortfolioRunRequest) -> dict:
    try:
        schema = parse_portfolio_strategy_schema(body.code)
    except ScriptValidationError as e:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"strategy rejected: {e}"
        ) from e
    defaults = {name: p.values()[0] for name, p in schema.items()}
    params = {**defaults, **body.params}

    if body.provider is not MarketDataProviderEnum.yfinance:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Portfolio backtests use the yfinance historical store; choose yfinance and ingest data first.",
        )

    if bool(body.index) == bool(body.symbols):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "provide exactly one of 'index' or 'symbols'"
        )

    store = _store()
    start = _parse_day(body.start, "start")
    end = _parse_day(body.end, "end")
    universe = None

    try:
        if body.index:
            if start is None or end is None:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST, "'index' requires 'start' and 'end'"
                )
            universe = store.resolve_universe(body.index, start, end)
            symbols = sorted(universe.symbols)
        else:
            symbols = sorted({s.strip() for s in (body.symbols or []) if s.strip()})
            if not symbols:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "no symbols given")
            universe = Universe.static(symbols)

        frames = store.read_frames(symbols)
    except DataNotFound as e:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"{e} (run ingest first)"
        ) from e

    if start is not None or end is not None:
        frames = {s: _clip(f, start, end) for s, f in frames.items()}

    data_version = store.head_version()
    result = await run_in_threadpool(
        run_portfolio_strategy,
        body.code,
        frames,
        starting_cash=body.starting_cash,
        timeout_s=_RUN_TIMEOUT_S,
        seed=body.seed,
        params=params,
        constraints=body.constraints.to_constraints() if body.constraints else None,
        universe=universe,
        data_version=data_version,
    )
    blob = dataclasses.asdict(result)
    if result.status == "ok":
        run_id = _persist_portfolio(
            blob,
            code=body.code,
            params=params,
            data_version=data_version,
            seed=body.seed,
            starting_cash=body.starting_cash,
            universe=universe,
            constraints=body.constraints.to_constraints() if body.constraints else None,
        )
        blob["run_id"] = run_id
        # Expose the content-addressed id as meta.run_id too, so it matches the
        # stored snapshot (and what GET /backtests/runs/{id} returns) rather than
        # the engine's throwaway uuid.
        blob["meta"]["run_id"] = run_id
    return blob

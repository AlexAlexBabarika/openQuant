"""Trusted long-only strategies; no submitted source code is evaluated."""

from __future__ import annotations

from backend.backtesting.context import Context
from backend.backtesting.strategy import Strategy
from backend.trial.scenario import MAX_OPEN_GAP

LOOKBACK_GRID = (3, 6, 12, 24)
CADENCE_GRID = (1, 2, 3)
DEFAULT_HOLDING_BARS = 2
ALLOCATION = 0.95
MAX_COST_BPS = 50


def enter_long(ctx: Context) -> None:
    # Reserve for the scenario's bounded next-open gap and maximum allowed fees.
    reserve = (1 + MAX_OPEN_GAP) * (1 + MAX_COST_BPS / 10_000) ** 2
    quantity = ALLOCATION * ctx.cash / (ctx.bars[-1].close * reserve)
    if quantity > 0:
        ctx.buy(quantity)


class FragileMomentum(Strategy):
    def __init__(self, lookback: int) -> None:
        self.lookback = lookback

    def on_bar(self, ctx: Context) -> None:
        if len(ctx.bars) <= self.lookback:
            return
        rising = ctx.bars[-1].close > ctx.bars[-1 - self.lookback].close
        if rising and ctx.position.quantity == 0:
            enter_long(ctx)
        elif not rising and ctx.position.quantity > 0:
            ctx.sell(ctx.position.quantity)


class FrequentTrader(Strategy):
    def __init__(self, holding_bars: int = DEFAULT_HOLDING_BARS) -> None:
        self.holding_bars = holding_bars
        self.entry_index = -1

    def on_bar(self, ctx: Context) -> None:
        if ctx.position.quantity == 0:
            enter_long(ctx)
            self.entry_index = ctx.bars.index + 1
        elif ctx.bars.index + 1 - self.entry_index >= self.holding_bars:
            ctx.sell(ctx.position.quantity)


class BuyAndHold(Strategy):
    def on_bar(self, ctx: Context) -> None:
        if ctx.bars.index == 0:
            enter_long(ctx)

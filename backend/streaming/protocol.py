"""
Wire protocol for the multiplexed live-streaming WebSocket (`/ws/live`).

Two layers:
  - StreamEvent: internal provider → hub event (server-side only).
  - ClientMessage / ServerMessage: discriminated unions exchanged with browsers.

Auth: clients pass the access token as a `?token=` query param on the WS
upgrade. The handshake validates it; subsequent messages carry no token.
"""

from datetime import datetime
from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field

from backend.market.models import OHLCVCandle
from backend.models.market_data_models import MarketDataProviderEnum


# ---------------------------------------------------------------------------
# Internal: provider → hub
# ---------------------------------------------------------------------------


class StreamEvent(BaseModel):
    """Single event emitted by a provider's `stream_ohlcv` async iterator."""

    kind: Literal["candle_update", "candle_close", "tick"]
    symbol: str
    interval: str = ""  # empty for ticks
    candle: OHLCVCandle | None = None
    price: float | None = None  # for ticks
    is_final: bool = False


# ---------------------------------------------------------------------------
# Client → server
# ---------------------------------------------------------------------------


class SubscribeMessage(BaseModel):
    type: Literal["subscribe"] = "subscribe"
    provider: MarketDataProviderEnum
    symbol: str
    interval: str
    since: datetime | None = None
    """Optional last-known candle timestamp; the hub backfills via REST so
    the snapshot bridges any gap between the client's history and the live
    feed (set on initial subscribe and updated on reconnect)."""


class UnsubscribeMessage(BaseModel):
    type: Literal["unsubscribe"] = "unsubscribe"
    provider: MarketDataProviderEnum
    symbol: str
    interval: str


class SubscribeQuoteMessage(BaseModel):
    """Lightweight last-price stream for sidebar tickers."""

    type: Literal["subscribe_quote"] = "subscribe_quote"
    provider: MarketDataProviderEnum
    symbol: str


class UnsubscribeQuoteMessage(BaseModel):
    type: Literal["unsubscribe_quote"] = "unsubscribe_quote"
    provider: MarketDataProviderEnum
    symbol: str


class PingMessage(BaseModel):
    type: Literal["ping"] = "ping"


ClientMessage = Annotated[
    Union[
        SubscribeMessage,
        UnsubscribeMessage,
        SubscribeQuoteMessage,
        UnsubscribeQuoteMessage,
        PingMessage,
    ],
    Field(discriminator="type"),
]


# ---------------------------------------------------------------------------
# Server → client
# ---------------------------------------------------------------------------


SubscriptionState = Literal["connected", "reconnecting", "closed"]


class SnapshotMessage(BaseModel):
    """Sent immediately after a successful subscribe — last N cached candles."""

    type: Literal["snapshot"] = "snapshot"
    provider: MarketDataProviderEnum
    symbol: str
    interval: str
    candles: list[OHLCVCandle]


class CandleMessage(BaseModel):
    type: Literal["candle"] = "candle"
    provider: MarketDataProviderEnum
    symbol: str
    interval: str
    candle: OHLCVCandle
    is_final: bool = False


class QuoteMessage(BaseModel):
    type: Literal["quote"] = "quote"
    provider: MarketDataProviderEnum
    symbol: str
    price: float
    ts: datetime


class StatusMessage(BaseModel):
    type: Literal["status"] = "status"
    provider: MarketDataProviderEnum
    symbol: str
    interval: str = ""
    state: SubscriptionState


class ErrorMessage(BaseModel):
    type: Literal["error"] = "error"
    code: str
    message: str
    provider: MarketDataProviderEnum | None = None
    symbol: str | None = None
    interval: str | None = None


class PongMessage(BaseModel):
    type: Literal["pong"] = "pong"


ServerMessage = Annotated[
    Union[
        SnapshotMessage,
        CandleMessage,
        QuoteMessage,
        StatusMessage,
        ErrorMessage,
        PongMessage,
    ],
    Field(discriminator="type"),
]

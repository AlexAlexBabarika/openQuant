"""Binance market data provider using python-binance."""

import logging
from datetime import datetime, timedelta, timezone

from binance.client import Client

from backend.core.api_key_store import fetch_api_key
from backend.market.data_sources.marketdataprovider import MarketDataProvider
from backend.market.data_sources.raw_quality import normalize_provider_rows
from backend.market.models import OHLCVCandle
from backend.market.time_utils import period_to_startdate
from backend.models.market_data_models import AssetType, SymbolRecord

logger = logging.getLogger(__name__)


def _normalize_binance_symbol(symbol: str) -> str:
    """Binance spot symbols are uppercase alphanumerics (e.g. BTCUSDT), no ``/`` or ``-``."""
    return symbol.strip().upper().replace("/", "").replace("-", "")


INTERVAL_MAP: dict[str, str] = {
    "1m": Client.KLINE_INTERVAL_1MINUTE,
    "5m": Client.KLINE_INTERVAL_5MINUTE,
    "15m": Client.KLINE_INTERVAL_15MINUTE,
    "30m": Client.KLINE_INTERVAL_30MINUTE,
    "1h": Client.KLINE_INTERVAL_1HOUR,
    "4h": Client.KLINE_INTERVAL_4HOUR,
    "1d": Client.KLINE_INTERVAL_1DAY,
    "1w": Client.KLINE_INTERVAL_1WEEK,
    "1mo": Client.KLINE_INTERVAL_1MONTH,
}


def _kline_row(kline: list) -> dict:
    """Project a raw Binance kline without truncating its millisecond timestamp.

    Kline format: [open_time, open, high, low, close, volume, close_time, ...]
    """
    if not isinstance(kline, list):
        raise ValueError("Binance kline must be an array.")
    timestamp = None
    if kline and type(kline[0]) is int:
        try:
            timestamp = datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(
                milliseconds=kline[0]
            )
        except OverflowError:
            pass
    return {
        "timestamp": timestamp,
        **{
            column: kline[i] if i < len(kline) else None
            for i, column in enumerate(("open", "high", "low", "close", "volume"), 1)
        },
    }


class BinanceProvider(MarketDataProvider):
    """Fetches OHLCV klines from Binance.

    Accepts an optional user_id. When provided, the user's stored API
    key/secret pair is used (format: ``key:secret``). When omitted,
    unauthenticated public access is used (lower rate limits).
    """

    def __init__(self, user_id: str | None = None) -> None:
        self._user_id = user_id

    @property
    def name(self) -> str:
        return "binance"

    @property
    def requires_api_key(self) -> bool:
        return False

    def _make_client(self) -> Client:
        if self._user_id:
            try:
                raw = fetch_api_key(self._user_id, "binance")
                if ":" in raw:
                    api_key, api_secret = raw.split(":", 1)
                else:
                    api_key, api_secret = raw.strip(), ""
                api_key = api_key.strip()
                api_secret = api_secret.strip()
                if api_key and api_secret:
                    return Client(api_key, api_secret)
            except ValueError:
                # No row, decrypt/empty, or enum mismatch (see fetch_api_key).
                logger.debug(
                    "No Binance API key for user %s, using public access",
                    self._user_id,
                )
        return Client()

    def get_ohlcv(
        self, symbol: str, period: str = "1mo", interval: str = "1d"
    ) -> list[OHLCVCandle]:
        sym_norm = _normalize_binance_symbol(symbol)
        bi_interval = INTERVAL_MAP.get(interval)
        if bi_interval is None:
            raise ValueError(
                f"Unsupported interval '{interval}'. "
                f"Supported: {', '.join(sorted(INTERVAL_MAP))}"
            )
        start_date = period_to_startdate(period)
        client = self._make_client()
        symbol_for_api = sym_norm
        klines = client.get_historical_klines(
            symbol_for_api,
            bi_interval,
            start_date,
        )
        if klines is None or klines == []:
            return []
        if not isinstance(klines, list):
            raise ValueError("Binance klines response must be an array.")
        return normalize_provider_rows(
            [_kline_row(k) for k in klines],
            symbol,
            provider=self.name,
            interval=interval,
        )

    def supports_streaming(self) -> bool:
        return True

    def stream_ohlcv(self, symbol: str, interval: str):
        # Imported lazily to avoid pulling the streaming module on REST-only paths.
        from backend.streaming.binance_stream import stream_binance_klines

        return stream_binance_klines(symbol, interval)

    def supports_streaming_quotes(self) -> bool:
        return True

    def stream_quotes(self, symbol: str):
        from backend.streaming.binance_stream import stream_binance_quotes

        return stream_binance_quotes(symbol)

    def list_symbols(self) -> list[SymbolRecord]:
        client = self._make_client()
        info = client.get_exchange_info()
        out: list[SymbolRecord] = []
        for s in info.get("symbols", []):
            if s.get("status") != "TRADING":
                continue
            sym = str(s.get("symbol", "")).strip().upper()
            if not sym:
                continue
            base = s.get("baseAsset") or ""
            quote = s.get("quoteAsset") or ""
            name = f"{base}/{quote}" if base and quote else sym
            out.append(
                SymbolRecord(
                    symbol=sym,
                    name=name,
                    asset_type=AssetType.crypto,
                    exchange="BINANCE",
                )
            )
        return out


_provider = BinanceProvider()


def load_binance(
    symbol: str, period: str = "1mo", interval: str = "1d"
) -> list[OHLCVCandle]:
    """Convenience function for unauthenticated Binance access."""
    return _provider.get_ohlcv(symbol, period, interval)

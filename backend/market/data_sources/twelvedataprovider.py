"""Twelve Data API provider."""

import logging

import requests

from backend.market.data_sources.marketdataprovider import MarketDataProvider
from backend.market.models import OHLCVCandle
from backend.market.data_sources.raw_quality import normalize_provider_rows
from backend.market.shared_config import resolve_twelvedata_interval
from backend.market.time_utils import period_to_startdate
from backend.core.api_key_store import fetch_api_key
from backend.models.market_data_models import AssetType, SymbolRecord

logger = logging.getLogger(__name__)

_BASE_URL = "https://api.twelvedata.com/time_series"

# (endpoint path, asset_type) — these endpoints return the full catalog in a
# single response; Twelve Data does not paginate them.
_REFERENCE_ENDPOINTS: list[tuple[str, AssetType]] = [
    ("stocks", AssetType.stock),
    ("forex_pairs", AssetType.forex),
    ("cryptocurrencies", AssetType.crypto),
    ("etfs", AssetType.etf),
]


class TwelveDataProvider(MarketDataProvider):
    def __init__(self, user_id: str | None = None, api_key: str | None = None) -> None:
        """Provide either ``user_id`` (key pulled from PostgreSQL) or a direct ``api_key``."""
        if not user_id and not api_key:
            raise ValueError("TwelveDataProvider requires user_id or api_key")
        self._user_id = user_id
        self._direct_api_key = api_key.strip() if api_key else None

    @property
    def name(self) -> str:
        return "twelvedata"

    @property
    def requires_api_key(self) -> bool:
        return True

    def _api_key(self) -> str:
        if self._direct_api_key:
            return self._direct_api_key
        if self._user_id is None:
            # Shouldn't happen — the ctor enforces at least one — but guard for
            # `python -O` where asserts are stripped.
            raise RuntimeError("TwelveDataProvider has no credentials")
        return fetch_api_key(self._user_id, "twelvedata").strip()

    def get_ohlcv(
        self, symbol: str, period: str = "1mo", interval: str = "1day"
    ) -> list[OHLCVCandle]:
        api_key = self._api_key()
        start_date = period_to_startdate(period)
        td_interval = resolve_twelvedata_interval(interval)
        resp = requests.get(
            _BASE_URL,
            params={
                "symbol": symbol.strip(),
                "interval": td_interval,
                "start_date": start_date,
                "apikey": api_key,
                "timezone": "UTC",
                "order": "asc",
            },
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        if not isinstance(data, dict):
            raise ValueError("Twelve Data response must be an object.")
        if data.get("status") == "error":
            raise RuntimeError(
                f"Twelve Data API error: {data.get('message', 'unknown')}"
            )
        values = data.get("values")
        if values is None or values == []:
            return []
        return normalize_provider_rows(
            values, symbol, provider=self.name, interval=interval
        )

    def list_symbols(self) -> list[SymbolRecord]:
        api_key = self._api_key()
        out: dict[str, SymbolRecord] = {}
        for path, asset_type in _REFERENCE_ENDPOINTS:
            url = f"https://api.twelvedata.com/{path}"
            try:
                resp = requests.get(url, params={"apikey": api_key}, timeout=60)
                resp.raise_for_status()
                payload = resp.json()
            except requests.RequestException as e:
                logger.warning("Twelve Data %s fetch failed: %s", path, e)
                continue
            if isinstance(payload, dict) and payload.get("status") == "error":
                logger.warning("Twelve Data %s error: %s", path, payload.get("message"))
                continue
            rows = payload.get("data") if isinstance(payload, dict) else None
            if not isinstance(rows, list):
                continue
            for row in rows:
                sym = str(row.get("symbol", "")).strip().upper()
                if not sym or sym in out:
                    continue
                name = str(row.get("name") or sym).strip() or sym
                exchange = row.get("exchange") or row.get("mic_code")
                out[sym] = SymbolRecord(
                    symbol=sym,
                    name=name,
                    asset_type=asset_type,
                    exchange=str(exchange).strip() if exchange else None,
                )
        return list(out.values())

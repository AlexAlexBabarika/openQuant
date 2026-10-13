"""
yfinance data loader. Fetches OHLCV and normalizes to unified schema.
"""

from datetime import timezone
from typing import Any

import yfinance as yf

from backend.market.models import CorporateAction, OHLCVCandle
from backend.market.data_sources.raw_quality import normalize_provider_rows
from backend.market.data_sources.marketdataprovider import MarketDataProvider


class YFinanceLoader(MarketDataProvider):
    @property
    def name(self) -> str:
        return "yfinance"

    @property
    def requires_api_key(self) -> bool:
        return False

    def get_ohlcv(
        self, symbol: str, period: str = "1mo", interval: str = "1d"
    ) -> list[OHLCVCandle]:
        """
        Load OHLCV for symbol from Yahoo Finance.
        Returns list of OHLCVCandle in unified schema (UTC ISO8601).
        """
        ticker = yf.Ticker(symbol)
        df = ticker.history(period=period, interval=interval)
        if df is None or df.empty:
            return []
        df = df.reset_index()
        df.columns = [c.strip() for c in df.columns]
        rows: list[dict[str, Any]] = df.to_dict(orient="records")
        return normalize_provider_rows(
            rows, symbol, provider=self.name, interval=interval
        )

    def get_corporate_actions(self, symbol: str) -> list[CorporateAction]:
        ticker = yf.Ticker(symbol)
        out: list[CorporateAction] = []
        splits = ticker.splits
        if splits is not None:
            for ex, ratio in splits.items():
                out.append(
                    CorporateAction(
                        symbol=symbol,
                        ex_date=ex.to_pydatetime().astimezone(timezone.utc),
                        kind="split",
                        value=float(ratio),
                    )
                )
        divs = ticker.dividends
        if divs is not None:
            for ex, amt in divs.items():
                out.append(
                    CorporateAction(
                        symbol=symbol,
                        ex_date=ex.to_pydatetime().astimezone(timezone.utc),
                        kind="dividend",
                        value=float(amt),
                    )
                )
        return out

    def get_raw_ohlcv(
        self, symbol: str, period: str = "max", interval: str = "1d"
    ) -> list[OHLCVCandle]:
        """Unadjusted OHLCV (auto_adjust=False) for the datastore ingest.

        The default ``get_ohlcv`` returns yfinance's auto-adjusted series, which
        the store must NOT use — the store owns adjustment. This fetches raw.
        """
        ticker = yf.Ticker(symbol)
        df = ticker.history(period=period, interval=interval, auto_adjust=False)
        if df is None or df.empty:
            return []
        df = df.reset_index()
        df.columns = [c.strip() for c in df.columns]
        rows = df.to_dict(orient="records")
        return normalize_provider_rows(
            rows, symbol, provider=self.name, interval=interval
        )


_loader = YFinanceLoader()


def load_yfinance(
    symbol: str, period: str = "1mo", interval: str = "1d"
) -> list[OHLCVCandle]:
    return _loader.get_ohlcv(symbol, period, interval)

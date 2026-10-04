"""
In-memory cache for loaded OHLCV data.

Keys are ``provider:symbol`` so different providers never overwrite the same
symbol. Each entry is stamped with the ``(period, interval)`` it was fetched
under; strict callers (e.g. the user-script runner) can pass these to
``get_cached`` and receive ``None`` on mismatch, forcing a fresh fetch.
Loose callers (legacy indicator routes) omit the filters
and read whatever is cached.
"""

from typing import Any
from threading import RLock

from backend.market.models import OHLCVCandle


# Value: (period, interval, candles). period/interval may be None for legacy
# call sites (CSV uploads, the deprecated yfinance cold-fetch path).
_CacheEntry = tuple[str | None, str | None, list[OHLCVCandle]]

_data_cache: dict[str, _CacheEntry] = {}
_cache_lock = RLock()
# Symbols that were loaded via CSV (same logical key as csv:symbol)
_csv_keys: set[str] = set()


def make_cache_key(provider: str, symbol: str) -> str:
    """Build cache key: ``provider:symbol`` (normalized)."""
    p = provider.strip().lower()
    s = symbol.strip()
    return f"{p}:{s}"


def get_cached_entry(provider: str, symbol: str) -> _CacheEntry | None:
    """Read candles and metadata from one publication; identity is its token."""
    with _cache_lock:
        return _data_cache.get(make_cache_key(provider, symbol))


def get_cached(
    provider: str,
    symbol: str,
    *,
    period: str | None = None,
    interval: str | None = None,
) -> list[OHLCVCandle] | None:
    """Return cached candles for provider+symbol, or None on miss/mismatch.

    If ``period`` or ``interval`` is given, the cached entry must have been
    stored under that exact value or the lookup is treated as a miss.
    """
    entry = get_cached_entry(provider, symbol)
    if entry is None:
        return None
    cached_period, cached_interval, candles = entry
    if period is not None and cached_period != period:
        return None
    if interval is not None and cached_interval != interval:
        return None
    return candles


def set_cached(
    provider: str,
    symbol: str,
    candles: list[OHLCVCandle],
    *,
    period: str | None = None,
    interval: str | None = None,
) -> None:
    """Store candles under provider:symbol, stamping (period, interval)."""
    key = make_cache_key(provider, symbol)
    with _cache_lock:
        _data_cache.pop(key, None)
        _data_cache[key] = (period, interval, candles)
        _invalidate_profiles(provider, symbol)


def get_cached_meta(provider: str, symbol: str) -> tuple[str | None, str | None] | None:
    """Return ``(period, interval)`` of the cached entry, or None if absent."""
    entry = get_cached_entry(provider, symbol)
    return None if entry is None else (entry[0], entry[1])


def set_cached_csv(symbol: str, candles: list[OHLCVCandle]) -> None:
    """Cache CSV upload under provider ``csv``."""
    key = make_cache_key("csv", symbol)
    _csv_keys.add(key)
    set_cached("csv", symbol, candles)


def is_csv_cached(symbol: str) -> bool:
    return make_cache_key("csv", symbol) in _csv_keys


def list_cached_keys() -> list[str]:
    """Return cache keys (``provider:symbol``), oldest write first."""
    return list(_data_cache.keys())


# ---------------------------------------------------------------------------
# Volume-profile cache
# Keyed by (provider, symbol, start_ts, end_ts, row_size, va_pct, interval).
# Values are derived responses from volume_profile_routes.py.
# ---------------------------------------------------------------------------

_profile_cache: dict[tuple, Any] = {}


def _invalidate_profiles(provider: str, symbol: str) -> None:
    source = (provider.strip().lower(), symbol.strip())
    for key in list(_profile_cache):
        if key[:2] == source:
            del _profile_cache[key]


def make_profile_key(
    provider: str,
    symbol: str,
    start_ts: int,
    end_ts: int | None,
    row_size: float,
    va_pct: float,
    interval: str,
) -> tuple:
    return (
        provider.strip().lower(),
        symbol.strip(),
        int(start_ts),
        int(end_ts) if end_ts is not None else None,
        round(float(row_size), 8),
        round(float(va_pct), 6),
        interval.strip().lower(),
    )


def get_cached_profile(key: tuple, *, source_entry: _CacheEntry | None) -> Any | None:
    with _cache_lock:
        if _data_cache.get(make_cache_key(*key[:2])) is not source_entry:
            return None
        return _profile_cache.get(key)


def set_cached_profile(
    key: tuple, value: Any, *, source_entry: _CacheEntry | None
) -> None:
    """Only publish derived data while its source publication is current."""
    with _cache_lock:
        if _data_cache.get(make_cache_key(*key[:2])) is source_entry:
            _profile_cache[key] = value


def clear_profile_cache() -> None:
    with _cache_lock:
        _profile_cache.clear()

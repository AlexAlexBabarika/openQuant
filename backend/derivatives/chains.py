"""Read-only Tradier market data; never execution or a pricing implementation."""

from __future__ import annotations

import json
import math
import re
from datetime import datetime, timedelta, timezone
from typing import Any

import aiohttp
from pydantic import TypeAdapter, ValidationError

from .models import OptionsContractSource
from .research_models import (
    MAX_CHAIN_QUOTES,
    ChainDate,
    ChainExpirationsResponse,
    ChainQuote,
    ChainResponse,
    Environment,
    Symbol,
)

HOSTS = {
    "production": "https://api.tradier.com/v1",
    "sandbox": "https://sandbox.tradier.com/v1",
}
MAX_RESPONSE_BYTES = 4 * 1024 * 1024
MAX_PROVIDER_RECORDS = 10_000
HTTP_TIMEOUT = aiohttp.ClientTimeout(total=10, connect=3, sock_read=5)
_SYMBOL = TypeAdapter(Symbol)
_DATE = TypeAdapter(ChainDate)
_CONTRACT = re.compile(r"^[A-Za-z0-9.^_ /-]{1,80}$")
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
# Earlier quote times are implausible: e.g. epoch seconds read as milliseconds land in 1970.
_EARLIEST_QUOTE_MS = 946_684_800_000  # 2000-01-01T00:00:00Z
_MODEL_WARNING = (
    "Tradier's documented chain fields do not establish exercise style or settlement; "
    "both are unknown. American exercise/physical delivery are not modeled by "
    "European cash-settled research. No execution equivalence is implied."
)


class ChainError(Exception):
    """Only fixed, credential-free messages may cross the HTTP boundary."""

    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


def provider_key(environment: Environment) -> str:
    return "tradier" if environment == "production" else "tradier_sandbox"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _warnings(environment: Environment) -> list[str]:
    return [
        _MODEL_WARNING,
        "Side quote times are provider observations, not fetch times; freshness and "
        "market-data entitlements are not verified. Missing values remain unavailable.",
        "IV uses ORATS greeks.mid_iv as an annual fraction when supplied; its update "
        "time is independent of side quote times. No IV freshness is asserted.",
    ] + (
        [
            "Sandbox market data is delayed (normally 15 minutes); Greeks may be unavailable."
        ]
        if environment == "sandbox"
        else []
    )


def _records(payload: Any, parent: str, child: str) -> list:
    if not isinstance(payload, dict) or "errors" in payload or parent not in payload:
        raise ChainError("Tradier returned an invalid market-data response. Try again.")
    container = payload[parent]
    if container is None:
        return []
    if not isinstance(container, dict) or child not in container:
        raise ChainError("Tradier returned an invalid market-data response. Try again.")
    records = container[child]
    if records is None:
        return []
    if not isinstance(records, list):
        records = [records]
    if len(records) > MAX_PROVIDER_RECORDS:
        raise ChainError(
            "Tradier response exceeds the record limit. Try another expiration."
        )
    return records


def _number(value: Any, maximum: float) -> float | None:
    if type(value) not in (int, float):
        return None
    try:
        number = float(value)
    except OverflowError:
        return None
    return number if math.isfinite(number) and 0 <= number <= maximum else None


def _integer(value: Any, minimum: int, maximum: int) -> int | None:
    number = _number(value, maximum)
    return (
        int(number)
        if number is not None and number.is_integer() and number >= minimum
        else None
    )


def _quote_time(value: Any, fetched_at: str) -> str | None:
    # Tradier documents bid_date/ask_date as epoch milliseconds, not seconds.
    milliseconds = _integer(value, _EARLIEST_QUOTE_MS, 253_402_300_799_999)
    if milliseconds is None:
        return None
    try:
        observed = _EPOCH + timedelta(milliseconds=milliseconds)
        if observed > datetime.fromisoformat(fetched_at):
            return None
        return observed.isoformat()
    except (OverflowError, ValueError):
        return None


def normalize_expirations(
    payload: Any, symbol: str, environment: Environment, fetched_at: str
) -> ChainExpirationsResponse:
    symbol = _SYMBOL.validate_python(symbol).upper()
    rows = _records(payload, "expirations", "date")
    expirations: set[str] = set()
    invalid = False
    for value in rows:
        try:
            expirations.add(_DATE.validate_python(value))
        except ValidationError:
            invalid = True
    warnings = _warnings(environment)
    if invalid:
        warnings.append("Invalid provider expiration dates were omitted.")
    truncated = len(expirations) > 128
    if truncated:
        warnings.append("Expiration list was truncated to the earliest 128 dates.")
    return ChainExpirationsResponse(
        environment=environment,
        symbol=symbol,
        fetched_at=fetched_at,
        expirations=sorted(expirations)[:128],
        truncated=truncated,
        warnings=warnings,
    )


def normalize_chain(
    payload: Any,
    symbol: str,
    expiration: str,
    environment: Environment,
    fetched_at: str,
) -> ChainResponse:
    symbol = _SYMBOL.validate_python(symbol).upper()
    expiration = _DATE.validate_python(expiration)
    rows = _records(payload, "options", "option")
    quotes: dict[str, ChainQuote] = {}
    duplicates: set[str] = set()
    invalid = adjusted = False
    for row in rows:
        if not isinstance(row, dict):
            invalid = True
            continue
        contract = row.get("symbol")
        underlying = row.get("underlying")
        kind = row.get("option_type")
        strike = _number(row.get("strike"), 1_000_000)
        if (
            not isinstance(contract, str)
            or not _CONTRACT.fullmatch(contract)
            or not contract.strip()
            or not isinstance(underlying, str)
            or underlying.upper() != symbol
            or kind not in ("call", "put")
            or strike is None
            or strike == 0
            or row.get("expiration_date") != expiration
            or row.get("type", "option") != "option"
        ):
            invalid = True
            continue
        root = row.get("root_symbol")
        # OCC appends a digit to adjusted roots (AAPL1); their deliverable is not 100 shares.
        if (
            isinstance(root, str)
            and root.upper().startswith(symbol)
            and root[len(symbol) :].isdigit()
        ):
            adjusted = True
            continue
        if contract in quotes or contract in duplicates:
            quotes.pop(contract, None)
            duplicates.add(contract)
            continue
        bid = _number(row.get("bid"), 1_000_000)
        ask = _number(row.get("ask"), 1_000_000)
        bid_as_of = (
            _quote_time(row.get("bid_date"), fetched_at) if bid is not None else None
        )
        ask_as_of = (
            _quote_time(row.get("ask_date"), fetched_at) if ask is not None else None
        )
        greeks = row.get("greeks")
        iv = _number(greeks.get("mid_iv"), 5) if isinstance(greeks, dict) else None
        quotes[contract] = ChainQuote(
            contract_symbol=contract,
            underlying=symbol,
            kind=kind,
            strike=strike,
            expiration=expiration,
            multiplier=_integer(row.get("contract_size"), 1, 1000),
            bid=bid,
            ask=ask,
            bid_as_of=bid_as_of,
            ask_as_of=ask_as_of,
            implied_volatility=iv,
            volume=_integer(row.get("volume"), 0, 10_000_000_000),
            open_interest=_integer(row.get("open_interest"), 0, 10_000_000_000),
            source=OptionsContractSource(
                provider="tradier",
                environment=environment,
                contract_symbol=contract,
                underlying=symbol,
                fetched_at=fetched_at,
                bid_as_of=bid_as_of,
                ask_as_of=ask_as_of,
            ),
        )
    warnings = _warnings(environment)
    if invalid:
        warnings.append("Invalid or mismatched provider contract records were omitted.")
    if duplicates:
        warnings.append("Duplicate provider contract identities were omitted entirely.")
    if adjusted:
        warnings.append(
            "Adjusted contracts (option roots such as AAPL1) were omitted: their deliverables are not standard 100-share contracts and cannot be modeled here."
        )
    if any(
        value is None
        for quote in quotes.values()
        for value in (quote.bid, quote.ask, quote.bid_as_of, quote.ask_as_of)
    ):
        warnings.append(
            "Some quotes have missing sides or unknown/invalid side times; not verified for midpoint application."
        )
    if any(
        quote.bid is not None and quote.ask is not None and quote.bid > quote.ask
        for quote in quotes.values()
    ):
        warnings.append(
            "Crossed bid/ask quotes are preserved but unusable for midpoint application."
        )
    ordered = sorted(
        quotes.values(), key=lambda q: (q.strike, q.kind, q.contract_symbol)
    )
    truncated = len(ordered) > MAX_CHAIN_QUOTES
    if truncated:
        warnings.append(
            "Chain was truncated to 2000 contracts sorted by strike, kind and symbol."
        )
    return ChainResponse(
        environment=environment,
        symbol=symbol,
        expiration=expiration,
        fetched_at=fetched_at,
        quotes=ordered[:MAX_CHAIN_QUOTES],
        truncated=truncated,
        warnings=warnings,
    )


def _invalid_constant(_value: str) -> None:
    raise ValueError("nonfinite JSON constant")


async def _get_json(
    token: str, environment: Environment, endpoint: str, params: dict[str, str]
) -> Any:
    if environment not in HOSTS or endpoint not in ("chains", "expirations"):
        raise ChainError("Invalid Tradier market-data request.", 422)
    if (
        not token
        or len(token) > 512
        or not token.isascii()
        or any(c.isspace() or ord(c) < 33 or ord(c) == 127 for c in token)
    ):
        raise ChainError(
            "Tradier key is unavailable. Re-save it in API Keys settings.", 409
        )
    url = HOSTS[environment] + "/markets/options/" + endpoint
    try:
        async with aiohttp.ClientSession(
            timeout=HTTP_TIMEOUT,
            connector=aiohttp.TCPConnector(limit=1),
            trust_env=False,
            cookie_jar=aiohttp.DummyCookieJar(),
        ) as session:
            async with session.get(
                url,
                params=params,
                headers={
                    "Authorization": "Bearer " + token,
                    "Accept": "application/json",
                },
                allow_redirects=False,
            ) as response:
                if response.status in (401, 403):
                    raise ChainError(
                        "Tradier denied market-data access. Check the selected environment key and entitlement in API Keys settings.",
                        424,
                    )
                if response.status == 429:
                    raise ChainError(
                        "Tradier market-data rate limit reached. Try again in a minute.",
                        429,
                    )
                if response.status != 200:
                    raise ChainError(
                        "Tradier market-data request failed. Try again shortly."
                    )
                if (
                    response.content_length is not None
                    and response.content_length > MAX_RESPONSE_BYTES
                ):
                    raise ChainError(
                        "Tradier response exceeds the byte limit. Try another expiration."
                    )
                body = bytearray()
                async for chunk in response.content.iter_chunked(16_384):
                    if len(body) + len(chunk) > MAX_RESPONSE_BYTES:
                        raise ChainError(
                            "Tradier response exceeds the byte limit. Try another expiration."
                        )
                    body.extend(chunk)
                return json.loads(body, parse_constant=_invalid_constant)
    except TimeoutError:
        raise ChainError(
            "Tradier market-data request timed out. Try again shortly.", 504
        ) from None
    except (aiohttp.ClientError, ValueError, RecursionError):
        raise ChainError(
            "Tradier returned an unavailable or invalid market-data response. Try again shortly."
        ) from None


async def fetch_expirations(
    token: str, symbol: str, environment: Environment
) -> ChainExpirationsResponse:
    symbol = _SYMBOL.validate_python(symbol).upper()
    payload = await _get_json(
        token, environment, "expirations", {"symbol": symbol, "includeAllRoots": "true"}
    )
    return normalize_expirations(payload, symbol, environment, utc_now())


async def fetch_chain(
    token: str, symbol: str, expiration: str, environment: Environment
) -> ChainResponse:
    symbol = _SYMBOL.validate_python(symbol).upper()
    expiration = _DATE.validate_python(expiration)
    payload = await _get_json(
        token,
        environment,
        "chains",
        {"symbol": symbol, "expiration": expiration, "greeks": "true"},
    )
    return normalize_chain(payload, symbol, expiration, environment, utc_now())

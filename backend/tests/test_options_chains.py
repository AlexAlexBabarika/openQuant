"""Invented Tradier payloads and fail-closed transport; no real quotes or keys."""

from __future__ import annotations

import asyncio
import json
import socket
from datetime import date, timedelta

import aiohttp
import pytest

from backend.derivatives import chains
from backend.derivatives.research_models import ChainResponse

FETCHED = "2026-10-15T17:00:00+00:00"
EXPIRATION = "2027-01-15"
FIXTURE_TOKEN = "invented-chain-fixture-token"


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def denied(*args, **kwargs):
        pytest.fail("Chain fixture attempted network access")

    monkeypatch.setattr(socket.socket, "connect", denied)
    monkeypatch.setattr(socket.socket, "connect_ex", denied)
    monkeypatch.setattr(socket, "create_connection", denied)
    monkeypatch.setattr(socket, "getaddrinfo", denied)


def option(**overrides) -> dict:
    return {
        "symbol": "AAPL270115C00100000",
        "underlying": "AAPL",
        "type": "option",
        "option_type": "call",
        "strike": 100,
        "expiration_date": EXPIRATION,
        "bid": 0,
        "ask": 2.5,
        "bid_date": 1_792_080_000_123,
        "ask_date": 1_792_080_001_456,
        "contract_size": 100,
        "volume": 0,
        "open_interest": 0,
        "greeks": {"mid_iv": 0, "smv_vol": 0.9},
        **overrides,
    }


def normalized(rows, environment="production"):
    return chains.normalize_chain(
        {"options": {"option": rows}}, "aapl", EXPIRATION, environment, FETCHED
    )


@pytest.mark.parametrize("singleton", [True, False])
def test_singleton_and_list_preserve_zero_units_provenance(singleton):
    row = option()
    result = normalized(row if singleton else [row])
    quote = result.quotes[0]
    assert (
        quote.bid
        == quote.volume
        == quote.open_interest
        == quote.implied_volatility
        == 0
    )
    assert quote.ask == 2.5 and quote.multiplier == 100
    assert quote.bid_as_of == "2026-10-15T16:00:00.123000+00:00"
    assert quote.ask_as_of == "2026-10-15T16:00:01.456000+00:00"
    assert quote.source.bid_as_of == quote.bid_as_of
    assert quote.source.ask_as_of == quote.ask_as_of
    assert quote.source.fetched_at == FETCHED
    assert quote.source.observed_exercise_style == "unknown"
    assert quote.source.observed_settlement == "unknown"
    assert quote.underlying == result.symbol == "AAPL"
    assert not result.truncated
    assert ChainResponse.model_validate_json(result.model_dump_json()) == result


@pytest.mark.parametrize("symbol", ["SPX", "AAPL", "BRK/A"])
def test_no_exercise_or_settlement_ticker_inference(symbol):
    result = chains.normalize_chain(
        {"options": {"option": option(underlying=symbol)}},
        symbol,
        EXPIRATION,
        "production",
        FETCHED,
    )
    source = result.quotes[0].source
    assert source.observed_exercise_style == source.observed_settlement == "unknown"
    assert "American" in " ".join(result.warnings)


@pytest.mark.parametrize(
    "field", ["bid", "ask", "contract_size", "volume", "open_interest"]
)
@pytest.mark.parametrize(
    "value", [None, True, "0", -1, float("nan"), float("inf"), 10**1000]
)
def test_unknown_or_invalid_optional_values_remain_null(field, value):
    quote = normalized(option(**{field: value})).quotes[0]
    target = "multiplier" if field == "contract_size" else field
    assert getattr(quote, target) is None
    json.dumps(quote.model_dump(), allow_nan=False)


@pytest.mark.parametrize(
    "field", ["bid", "ask", "contract_size", "volume", "open_interest", "greeks"]
)
def test_absent_optional_fields_are_not_zero(field):
    row = option()
    del row[field]
    quote = normalized(row).quotes[0]
    assert (
        getattr(
            quote,
            {"contract_size": "multiplier", "greeks": "implied_volatility"}.get(
                field, field
            ),
        )
        is None
    )


@pytest.mark.parametrize(
    "value", [None, True, "0.2", -0.1, 5.1, float("nan"), float("inf")]
)
def test_invalid_iv_is_null_not_smv_fallback(value):
    quote = normalized(option(greeks={"mid_iv": value, "smv_vol": 0.2})).quotes[0]
    assert quote.implied_volatility is None


@pytest.mark.parametrize(
    "value", [None, 0, -1, True, "1792084800123", float("nan"), 1_900_000_000_000, 1.5]
)
def test_missing_invalid_or_future_side_times_never_use_fetch_time(value):
    quote = normalized(option(bid_date=value, ask_date=value)).quotes[0]
    assert quote.bid_as_of is quote.ask_as_of is None
    assert quote.source.bid_as_of is quote.source.ask_as_of is None
    assert quote.source.fetched_at == FETCHED


def test_epoch_units_are_not_guessed_or_repaired():
    quote = normalized(option(bid_date=1_792_084_800)).quotes[0]
    assert quote.bid_as_of.startswith("1970-")
    assert quote.bid_as_of != quote.ask_as_of


def test_missing_quote_side_cannot_retain_an_apparently_usable_time():
    quote = normalized(option(bid=None)).quotes[0]
    assert quote.bid is quote.bid_as_of is None
    assert quote.ask_as_of is not None


def test_crossed_and_one_sided_quotes_are_not_fixed():
    result = normalized([option(bid=4, ask=2), option(symbol="OTHER", bid=None, ask=1)])
    assert result.quotes[0].bid == 4 and result.quotes[0].ask == 2
    assert result.quotes[1].bid is None
    assert "Crossed" in " ".join(result.warnings)
    assert "missing sides" in " ".join(result.warnings)


@pytest.mark.parametrize(
    "changes",
    [
        {"symbol": ""},
        {"symbol": "x" * 81},
        {"symbol": "\n"},
        {"underlying": "OTHER"},
        {"expiration_date": "2027-01-16"},
        {"option_type": "stock"},
        {"strike": 0},
        {"strike": float("nan")},
        {"strike": "100"},
        {"type": "stock"},
    ],
)
def test_invalid_required_fields_are_omitted_with_bounded_warning(changes):
    result = normalized([option(**changes), None])
    assert result.quotes == []
    assert "Invalid or mismatched" in " ".join(result.warnings)


def test_duplicate_identities_omitted_and_output_order_independent():
    rows = [
        option(symbol="Z", strike=101),
        option(symbol="A"),
        option(symbol="A", bid=5),
        option(symbol="B", option_type="put"),
    ]
    result = normalized(rows)
    assert [q.contract_symbol for q in result.quotes] == ["B", "Z"]
    assert normalized(list(reversed(rows))) == result
    assert "Duplicate" in " ".join(result.warnings)


@pytest.mark.parametrize("container", [None, {"option": None}, {"option": []}])
def test_valid_empty_chain(container):
    assert (
        chains.normalize_chain(
            {"options": container}, "AAPL", EXPIRATION, "sandbox", FETCHED
        ).quotes
        == []
    )


@pytest.mark.parametrize(
    "payload",
    [{}, [], {"options": []}, {"options": {}}, {"errors": {"secret": FIXTURE_TOKEN}}],
)
def test_bad_envelopes_raise_safe_error(payload):
    with pytest.raises(chains.ChainError) as exc:
        chains.normalize_chain(payload, "AAPL", EXPIRATION, "sandbox", FETCHED)
    assert FIXTURE_TOKEN not in str(exc.value)


def test_quote_cap_is_sorted_deterministic_and_disclosed():
    rows = [option(symbol=f"Q{i:04}", strike=i + 1) for i in range(2001)]
    result = normalized(list(reversed(rows)))
    assert len(result.quotes) == 2000 and result.truncated
    assert result.quotes[-1].strike == 2000
    assert result == normalized(rows)
    assert "truncated" in " ".join(result.warnings)


def test_provider_record_cap_fails_before_normalizing(monkeypatch):
    monkeypatch.setattr(chains, "MAX_PROVIDER_RECORDS", 1)
    with pytest.raises(chains.ChainError, match="record limit"):
        normalized([option(), option()])


@pytest.mark.parametrize(
    "rows", [EXPIRATION, [EXPIRATION, "2027-02-19", EXPIRATION, "2027-02-30", None]]
)
def test_expiration_scalar_list_dedup_and_calendar_validation(rows):
    result = chains.normalize_expirations(
        {"expirations": {"date": rows}}, "aapl", "sandbox", FETCHED
    )
    assert result.expirations[0] == EXPIRATION
    assert len(result.expirations) == (1 if isinstance(rows, str) else 2)
    assert "delayed" in " ".join(result.warnings)


def test_expirations_cap_and_no_date_fabrication():
    rows = [(date(2027, 1, 1) + timedelta(days=i)).isoformat() for i in range(130)]
    result = chains.normalize_expirations(
        {"expirations": {"date": list(reversed(rows))}}, "AAPL", "production", FETCHED
    )
    assert result.expirations == rows[:128] and result.truncated
    empty = chains.normalize_expirations(
        {"expirations": None}, "AAPL", "production", FETCHED
    )
    assert empty.expirations == [] and not empty.truncated


class Transport:
    def __init__(self, body=b"{}", status=200, length=None, failure=None):
        self.body, self.status, self.content_length, self.failure = (
            body,
            status,
            length,
            failure,
        )
        self.content = self
        self.requests = []
        self.read_chunks = 0
        self.closed = 0

    def session(self, **kwargs):
        self.config = kwargs
        return self

    def get(self, url, **kwargs):
        self.requests.append((url, kwargs))
        if self.failure:
            raise self.failure
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        self.closed += 1

    async def iter_chunked(self, size):
        for i in range(0, len(self.body), size):
            self.read_chunks += 1
            yield self.body[i : i + size]


@pytest.fixture
def transport(monkeypatch):
    response = Transport()
    monkeypatch.setattr(chains.aiohttp, "ClientSession", response.session)
    monkeypatch.setattr(
        chains.aiohttp, "TCPConnector", lambda **kwargs: ("connector", kwargs)
    )
    monkeypatch.setattr(chains, "utc_now", lambda: FETCHED)
    return response


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "environment,host",
    [("production", "api.tradier.com"), ("sandbox", "sandbox.tradier.com")],
)
async def test_adapter_uses_only_documented_get_endpoints(transport, environment, host):
    transport.body = json.dumps({"options": {"option": option()}}).encode()
    result = await chains.fetch_chain(FIXTURE_TOKEN, "aapl", EXPIRATION, environment)
    url, kwargs = transport.requests[0]
    assert url == f"https://{host}/v1/markets/options/chains"
    assert kwargs == {
        "params": {"symbol": "AAPL", "expiration": EXPIRATION, "greeks": "true"},
        "headers": {
            "Authorization": f"Bearer {FIXTURE_TOKEN}",
            "Accept": "application/json",
        },
        "allow_redirects": False,
    }
    assert transport.config["trust_env"] is False
    assert transport.config["timeout"].total == 10
    assert transport.config["timeout"].connect == 3
    assert transport.config["timeout"].sock_read == 5
    assert transport.closed == 2
    assert FIXTURE_TOKEN not in result.model_dump_json()
    assert result.environment == environment
    transport.body = json.dumps({"expirations": {"date": EXPIRATION}}).encode()
    assert (
        await chains.fetch_expirations(FIXTURE_TOKEN, "aapl", environment)
    ).expirations == [EXPIRATION]
    assert transport.requests[-1][0].endswith("/markets/options/expirations")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "status,expected",
    [(401, 424), (403, 424), (429, 429), (500, 502), (302, 502), (400, 502)],
)
async def test_http_errors_never_parse_or_return_body_or_headers(
    transport, status, expected, caplog
):
    transport.status = status
    transport.body = FIXTURE_TOKEN.encode()
    with pytest.raises(chains.ChainError) as exc:
        await chains.fetch_expirations(FIXTURE_TOKEN, "AAPL", "sandbox")
    assert exc.value.status_code == expected
    assert transport.read_chunks == 0
    assert FIXTURE_TOKEN not in str(exc.value) + caplog.text


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "failure,expected",
    [(aiohttp.ClientError(FIXTURE_TOKEN), 502), (TimeoutError(FIXTURE_TOKEN), 504)],
)
async def test_transport_exception_details_not_leaked(
    transport, failure, expected, caplog
):
    transport.failure = failure
    with pytest.raises(chains.ChainError) as exc:
        await chains.fetch_chain(FIXTURE_TOKEN, "AAPL", EXPIRATION, "production")
    assert exc.value.status_code == expected
    assert FIXTURE_TOKEN not in str(exc.value) + caplog.text


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "body",
    [
        b'{"bid": NaN}',
        b'{"bid": Infinity}',
        b"not-json",
        b"[" * 2000 + b"0" + b"]" * 2000,
    ],
)
async def test_malformed_deep_nonfinite_json_fails_safely(transport, body):
    transport.body = body
    with pytest.raises(chains.ChainError, match="invalid market-data"):
        await chains.fetch_expirations(FIXTURE_TOKEN, "AAPL", "sandbox")


@pytest.mark.asyncio
@pytest.mark.parametrize("declared", [True, False])
async def test_byte_cap_on_header_and_decoded_stream(transport, monkeypatch, declared):
    monkeypatch.setattr(chains, "MAX_RESPONSE_BYTES", 10)
    transport.body = b" " * 11
    transport.content_length = 11 if declared else None
    with pytest.raises(chains.ChainError, match="byte limit"):
        await chains.fetch_expirations(FIXTURE_TOKEN, "AAPL", "sandbox")
    assert transport.read_chunks == (0 if declared else 1)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "token", ["", "x" * 513, "has\r\nline", "white space", "nonascii\u200b"]
)
async def test_invalid_key_never_reaches_http(transport, token):
    with pytest.raises(chains.ChainError) as exc:
        await chains.fetch_expirations(token, "AAPL", "production")
    assert exc.value.status_code == 409
    assert not transport.requests


@pytest.mark.asyncio
async def test_cancellation_closes_provider_context(transport):
    entered = asyncio.Event()
    cancelled = asyncio.Event()

    async def waiting(size):
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()
        yield b""

    transport.iter_chunked = waiting
    task = asyncio.create_task(
        chains.fetch_expirations(FIXTURE_TOKEN, "AAPL", "production")
    )
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert cancelled.is_set() and transport.closed == 2

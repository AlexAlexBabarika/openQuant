# Provider validation: offline boundaries and live evidence gate

## What is covered

`backend/tests/test_provider_raw_quality.py` and
`backend/tests/test_provider_quality_routes.py` exercise the real yfinance,
Binance and Twelve Data adapters, shared normalization, canonical quality gate,
and in-process preview/execution paths. These are **offline synthetic adapter
tests**, not live/native-provider, browser, hosted-security, performance, leak,
calendar, freshness, adjustment or redistribution acceptance.

Fixture provenance: `_provider_raw_fixtures.py` constructs three invented bars
starting at 2024-01-01 UTC, prices around 100, and fractional volume 10.25. There
are no captured market responses, real account identifiers, provider keys or
certifying datasets. The raw-report example-limit test uses eight invented
invalid rows. Transport doubles supply only these upstream shapes:

| Adapter boundary | Invented upstream shape | Actual code exercised |
| --- | --- | --- |
| yfinance `Ticker.history` | pandas frame with Date index, Open/High/Low/Close/Volume plus Dividends/Stock Splits | index reset, alias projection, raw guard, shared normalizer; both ordinary and `auto_adjust=False` ingest paths |
| Binance SDK `Client.get_historical_klines` | twelve-element arrays: integer millisecond open time, decimal-string OHLCV, unused trailing fields | symbol/interval mapping, public-client construction path, exact epoch conversion, raw guard, shared normalizer |
| Twelve Data HTTP response | status/meta/values envelope, datetime and decimal-string OHLCV | actual request construction (UTC/ascending), HTTP/API error handling, raw guard, shared normalizer |

No provider calls occur. The Twelve Data key accessor is replaced by an empty
transport placeholder, never a demo or real key; credential-store access is
forbidden. DNS, socket connect/connect_ex/create_connection, requests session
transport and libcurl `Curl.perform` fail closed with a fixed test failure.
The guard test checks representative socket, requests and libcurl denial paths.
The HTTP/SDK doubles are installed only on the owned test's monkeypatch scope.

## Raw-loader contract

`data_sources/raw_quality.py` projects known aliases into a **diagnostic-only**
microsecond UTC frame and invokes the unchanged `inspect_frame` policy before
`normalize_rows`. Null, missing, unparseable, boolean or nonfinite numeric
inputs do not become usable zeros. Nonpositive prices, negative volume,
inconsistent OHLC, invalid dates, duplicates and reversed ordering block the
adapter before candles can be returned/cached. No sorting, deduplication,
bar insertion, price repair or partial-success filtering occurs.
Ambiguous multiple aliases for one OHLCV field are rejected rather than letting
the last alias overwrite a corrupt original value. For yfinance this boundary
is the SDK's history frame, **after any SDK-internal processing**, not raw Yahoo
HTTP data; no fixture proves what that SDK already adjusted or dropped.

- ISO dates/times and datetime objects are accepted. Explicit offsets convert
  to UTC; naive dates/times are interpreted as UTC, matching the existing
  adapter convention. Twelve Data explicitly requests UTC, but the fixture
  cannot establish that a live provider honors it for every asset/interval.
- Binance open time must be an integer in its expected **millisecond** unit.
  Conversion uses epoch plus integer timedelta, not floating-point division.
  Fractional/string epochs and out-of-range dates are rejected; no unit
  detection or seconds-to-milliseconds repair is attempted.
- Research frames support microseconds. Nonzero submicrosecond digits in ISO
  timestamps/pandas Timestamp objects are rejected rather than truncated.
  Milliseconds and microseconds survive the adapter-to-research-frame path.
  The existing candle REST serializer emits whole seconds: these tests explicitly
  show that separate loss and do **not** certify subsecond chart/stream fidelity.
- Finite decimal-string numbers become Float64; binary floating-point rounding
  remains an assumption, not exact-decimal evidence. Thousands/locale strings
  are not provider decimal strings and are rejected by this boundary.
- Additional SDK fields (e.g. Dividends/Stock Splits or Binance close-time/trade
  fields) are dropped by OHLCV projection. That is not corporate-action or
  trade-data validation. Required OHLCV fields, including volume, are not
  invented when absent. Instruments whose provider omits volume need a separately
  reviewed policy before they can be used, not a silent zero fallback.
- The ordinary yfinance history call does not pin `auto_adjust`; only its
  separate raw-ingest path explicitly uses `auto_adjust=False`. Neither path
  establishes the canonical `adjustment` provenance, which remains unknown.
- Valid empty responses still return `[]`; the existing route handles no data.
  Malformed response containers, HTTP/API errors and failed raw validation
  never produce a successful partial dataset.

The existing generic normalizer remains unchanged for its other callers. It
can replace native float NaN/Infinity/null numeric values with zero, remove
commas, default absent fields, and copy a positive close/open into the other
nonpositive price (or use 0.01 when both are nonpositive). A regression explicitly
demonstrates this behavior and proves that provider validation rejects the
corrupt original input **before** those repairs. Candle models are unchanged.

`RawProviderDataError` is `ValueError`-compatible. Its `.data_quality` contains
bounded codes/counts/zero-based row examples and safe diagnostics, never raw
values or response payloads. Its diagnostic-frame provenance is explicitly
`data_version="raw-upstream:unversioned"`; it is **not** a content hash, loaded
cache identity, preview token, or assertion about raw response timezone metadata.
Invalid values become null solely in the diagnostic projection, not a repaired
output dataset. The shared route loader catches this exception before generic
`ValueError` and returns HTTP422 with safe `message` and `data_quality` detail.
Malformed response envelopes still return HTTP400. Failed fetches remain uncached
and never start research computation.

Canonical preview still inspects only the already-loaded cache without fetching.
Execution re-inspects its loaded canonical snapshot; changed preview identity
returns 409. Tests verify that warning-only elapsed gaps execute, reports/versions
match preview, guest runs remain unsaved, and saved fixture reports retain quality
and date-range provenance. The in-process Twelve Data route test overrides only
authentication with an invented identity; it is not an auth/owner-isolation test.

Elapsed gaps remain warnings: no exchange calendar establishes missing bars.
Month intervals have no invented fixed duration. Calendar and adjustment remain
unknown; freshness remains not assessed. Rejected raw rows are not available in
cache-only previews, and cached legacy/already-normalized bars cannot reveal
repairs that happened before this guard existed. Streaming, CSV, alternate
datastore loaders, symbol catalog and corporate-action endpoints are outside
these historical adapter fixtures.

## External live-provider opt-in evidence (not performed)

Before treating a provider as validated, obtain separate explicit approval for
that provider, bounded market-data-only request scope and any credential handling.
Do not create or connect billing, brokerage/trading accounts, place trades, or
request broad scopes. For each approved provider/asset/interval:

1. Record the adapter/SDK revision, endpoint, asset class, symbol, period,
   interval, requested timezone/order/adjustment settings and UTC capture time.
   Keep credentials, cookies, authorization/query keys and sensitive raw payloads
   out of public evidence, logs, fixtures and screenshots.
2. Preserve an access-controlled raw response and its digest privately, with
   row count/schema, timestamp representation/precision, numeric formats,
   response metadata, availability/errors and explicit capture provenance.
   A sanitized shape alone is not that captured response.
3. Run the actual adapter and canonical pipeline against that capture, recording
   raw and canonical counts/date bounds, every dropped non-OHLCV field and all
   conversions/rejections. Verify timezone semantics for daily and intraday bars
   separately, returned ordering/duplicates, partial last bars, missing volume,
   numeric precision and SDK adjustment settings rather than relying on labels.
4. Independently establish requested-range completeness, calendar, adjustment,
   and freshness expectations from applicable provider documentation and data
   availability. An elapsed-gap warning or old historical range proves none of
   these. Include bounded no-data/rate-limit/HTTP/API failure evidence without
   sending corrupt data to a provider or retrying without approval.
5. Document remaining asset/interval/provider/version limitations and obtain
   human acceptance. Keep evidence for one provider distinct from others;
   never relabel offline synthetic cache data as native provider coverage.

### Redistribution is a separate external gate

Review the provider's current terms, upstream exchange/vendor terms and the
specific intended use (private research, display, storage/cache, exports,
derived results, attribution and public redistribution). Record dated source
links and the authorized human/legal decision privately where necessary. SDK
licensing, public endpoints, free/demo access and these tests do **not** grant
market-data redistribution rights. No licenses or permissions are asserted here,
and no deployment/publication approval follows from a passing test.

## Documentation and local reproduction

Official references consulted for upstream contracts (not licensing clearance):

- [yfinance Ticker.history](https://ranaroussi.github.io/yfinance/reference/api/yfinance.Ticker.history.html)
- [Binance Spot REST market-data documentation](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints)
- [Twelve Data documentation](https://twelvedata.com/docs#time-series)
- [Twelve Data timezone guidance](https://support.twelvedata.com/en/articles/5745849-timezones)

The Binance rendered documentation was not retrievable in this environment;
its expected array/unit contract is also visible in the existing adapter and
installed SDK. That limitation is not live-provider verification.

```sh
.venv/bin/python -m pytest backend/tests/test_provider_raw_quality.py backend/tests/test_provider_quality_routes.py backend/tests/test_data_quality.py backend/tests/test_quality_integration.py
.venv/bin/ruff check backend/market/data_sources backend/tests/_provider_raw_fixtures.py backend/tests/test_provider_raw_quality.py backend/tests/test_provider_quality_routes.py
.venv/bin/mypy --exclude 'backend/datastore/_data/' backend/market/data_sources backend/tests/_provider_raw_fixtures.py backend/tests/test_provider_raw_quality.py backend/tests/test_provider_quality_routes.py
```

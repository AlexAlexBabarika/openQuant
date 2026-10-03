"""
FastAPI backend: REST + WebSocket for OHLCV data.
Standalone runnable (uvicorn backend.app:app).

In production the built frontend (frontend/dist/) can be served as static
files by mounting it on "/" — see the startup event below.
"""

import asyncio
import logging
import json
import os
import tempfile
import time
from collections import defaultdict, deque
from pathlib import Path

from fastapi import (
    FastAPI,
    File,
    HTTPException,
    Request,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware

from backend.market import cache
from backend.core.migrations import apply_migrations
from backend.market.data_sources import load_csv, load_yfinance
from backend.market.data_sources.csv_loader import csv_preview
from backend.market.models import OHLCVCandleList
from backend.market.ohlcv_limits import cap_candles
from backend.market.shared_config import validate_interval, validate_period
from backend.websocket import stream_candles
from backend.streaming.hub import ClientSession, get_hub
from backend.scripts.seed_symbols import seed_providers
from backend.streaming.protocol import (
    ClientMessage,
    ErrorMessage,
    PongMessage,
    ServerMessage,
    SubscribeMessage,
    SubscribeQuoteMessage,
    UnsubscribeMessage,
    UnsubscribeQuoteMessage,
)
from backend.core.database import check_database
from backend.core.config import security_settings, validate_runtime_config
from backend.core.runtime_secrets import load_runtime_secrets
from backend.core.uploads import read_upload
from backend.core.logging_security import install_secret_redaction
from backend.routes.auth_routes import router as auth_router
from backend.routes.user_routes import router as user_router
from backend.routes.ticker_workspace_routes import router as ticker_workspace_router
from backend.routes.api_key_routes import router as api_key_router
from backend.routes.market_routes import router as market_router
from backend.routes.indicator_routes import router as indicator_router
from backend.routes.analytics_routes import router as analytics_router
from backend.routes.symbol_routes import router as symbol_router
from backend.routes.volume_profile_routes import router as volume_profile_router
from backend.routes.position_metrics_routes import router as position_metrics_router
from backend.routes.script_routes import router as script_router
from backend.routes.comparison_routes import router as comparison_router
from backend.routes.sweep_routes import router as sweep_router, shutdown_sweeps
from backend.routes.backtest_routes import router as backtest_router
from backend.routes.run_routes import router as run_router
from backend.routes.portfolio_routes import router as portfolio_router
from backend.routes.datastore_routes import router as datastore_router
from backend.routes.strategy_routes import router as strategy_router
from backend.routes.trial_routes import router as trial_router
from backend.routes.robustness_routes import router as robustness_router
from backend.core.rate_limit import allow, client_key, retry_after_seconds
from backend.core.auth_deps import _user_from_token

logger = logging.getLogger(__name__)

FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"

_WS_PROVIDERS = frozenset({"yfinance", "binance", "twelvedata", "csv"})
_WS_PRIVATE_PROVIDERS = frozenset({"twelvedata", "csv"})
_ws_connections: dict[str, int] = defaultdict(int)


def _ws_origin_allowed(websocket: WebSocket) -> bool:
    origin = websocket.headers.get("origin")
    if not origin:
        return True
    host = websocket.headers.get("host")
    same_origin = {f"http://{host}", f"https://{host}"}
    return origin in same_origin or origin in _security.cors_origins


def _ws_authenticated(websocket: WebSocket) -> bool:
    token = websocket.query_params.get("token")
    if not token:
        return False
    try:
        _user_from_token(token)
    except HTTPException:
        return False
    return True


async def _ws_admit(websocket: WebSocket, *, private: bool = False) -> str | None:
    if not _ws_origin_allowed(websocket) or (
        private and not _ws_authenticated(websocket)
    ):
        await websocket.close(code=1008)
        return None
    host = websocket.client.host if websocket.client else "unknown"
    if _ws_connections[host] >= _security.ws_max_connections_per_ip:
        await websocket.close(code=1013)
        return None
    _ws_connections[host] += 1
    return host


def _ws_release(host: str | None) -> None:
    if host is None:
        return
    _ws_connections[host] = max(0, _ws_connections[host] - 1)
    if not _ws_connections[host]:
        _ws_connections.pop(host, None)


@asynccontextmanager
async def lifespan(app: FastAPI):
    validate_runtime_config()
    load_runtime_secrets()
    install_secret_redaction()
    await run_in_threadpool(check_database)
    applied = await run_in_threadpool(apply_migrations)
    logger.info("PostgreSQL ready; applied migrations: %s", applied or "none")

    hub = get_hub()
    await hub.start()
    seed_task = None
    if os.environ.get("SEED_SYMBOLS_ON_STARTUP", "0").strip() == "1":
        providers = [
            provider.strip()
            for provider in os.environ.get("SYMBOL_SEED_PROVIDERS", "binance").split(
                ","
            )
            if provider.strip()
        ]

        async def seed_symbols() -> None:
            try:
                failed = await run_in_threadpool(seed_providers, providers)
                if failed:
                    logger.warning(
                        "Startup symbol seed failed for: %s", ", ".join(failed)
                    )
            except Exception:
                logger.exception("Startup symbol seed could not run")

        seed_task = asyncio.create_task(seed_symbols())
    try:
        yield
    finally:
        if seed_task is not None and not seed_task.done():
            seed_task.cancel()
        sweeps_stopped = await run_in_threadpool(shutdown_sweeps)
        if not sweeps_stopped:
            logger.warning("Timed out waiting for optimization sweeps to stop")
        await hub.stop()


app = FastAPI(
    title="OpenQuant API",
    description="OHLCV data API with yfinance and CSV sources, WebSocket streaming",
    version="1.0.0",
    lifespan=lifespan,
)

_security = security_settings()
app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(_security.allowed_hosts))


@app.middleware("http")
async def reject_oversized_requests(request: Request, call_next):
    raw_length = request.headers.get("content-length")
    if raw_length:
        try:
            content_length = int(raw_length)
        except ValueError:
            return JSONResponse(
                status_code=400, content={"detail": "Invalid Content-Length"}
            )
        if content_length > _security.max_request_bytes:
            return JSONResponse(
                status_code=413, content={"detail": "Request body is too large"}
            )
    return await call_next(request)


if _security.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(_security.cors_origins),
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
        expose_headers=["WWW-Authenticate"],
    )

app.include_router(auth_router)
app.include_router(user_router)
app.include_router(ticker_workspace_router)
app.include_router(api_key_router)
app.include_router(market_router)
app.include_router(indicator_router)
app.include_router(analytics_router)
app.include_router(symbol_router)
app.include_router(volume_profile_router)
app.include_router(position_metrics_router)
app.include_router(script_router)
app.include_router(comparison_router)
app.include_router(sweep_router)
app.include_router(backtest_router)
app.include_router(run_router)
app.include_router(portfolio_router)
app.include_router(datastore_router)
app.include_router(strategy_router)
app.include_router(trial_router)
app.include_router(robustness_router)


@app.get("/health")
async def health() -> dict[str, str]:
    await run_in_threadpool(check_database)
    return {"status": "ok"}


@app.get("/data/yfinance/{symbol}", response_model=OHLCVCandleList, deprecated=True)
async def get_yfinance(
    request: Request,
    symbol: str,
    period: str = "1mo",
    interval: str = "1d",
) -> OHLCVCandleList:
    """
    **Deprecated** — use ``GET /data/market`` with ``provider=yfinance``.

    Same validation and cache key as the unified market route (``yfinance:symbol``).

    Response includes ``Deprecation: true`` and a ``Link`` successor hint header;
    OpenAPI marks this operation deprecated; generated clients may not surface headers.
    """
    if not allow(client_key(request.client.host if request.client else None)):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many market data requests. Try again shortly.",
            headers={"Retry-After": str(retry_after_seconds())},
        )
    validate_period(period)
    validate_interval(interval)
    sym = symbol.strip()
    candles = await run_in_threadpool(
        load_yfinance,
        sym,
        period,
        interval,
    )
    candles = cap_candles(candles)
    cache.set_cached("yfinance", sym, candles, period=period, interval=interval)
    body = OHLCVCandleList(symbol=sym, candles=candles)
    return JSONResponse(
        content=body.model_dump(mode="json"),
        headers={
            "Deprecation": "true",
            "Link": '</data/market?provider=yfinance>; rel="successor-version"',
        },
    )


@app.post("/data/csv", response_model=dict)
async def post_csv(
    file: UploadFile = File(...),
    symbol: str = "CSV",
) -> dict:
    """
    Upload CSV; auto-detect columns, normalize to OHLCV, cache by symbol.
    """
    content = await read_upload(file)
    suffix = Path(file.filename or "data.csv").suffix or ".csv"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name
    try:
        candles = await run_in_threadpool(load_csv, tmp_path, symbol)
        cache.set_cached_csv(symbol, candles)
        return {
            "symbol": symbol,
            "count": len(candles),
            "preview_columns": ["timestamp", "open", "high", "low", "close", "volume"],
        }
    finally:
        Path(tmp_path).unlink(missing_ok=True)


@app.post("/data/csv/preview")
async def csv_preview_endpoint(
    file: UploadFile = File(...),
    max_rows: int = 5,
) -> dict:
    """
    Preview CSV: returns column names and first max_rows.
    Request body: multipart form with 'file' and optional 'max_rows'.
    """
    content = await read_upload(file)
    suffix = Path(file.filename or "data.csv").suffix or ".csv"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name
    try:
        columns, rows = await run_in_threadpool(
            csv_preview, tmp_path, max_rows=max_rows
        )
        # Serialize rows for JSON (datetime -> str)
        out_rows = []
        for r in rows:
            out_rows.append(
                {k: str(v) if hasattr(v, "isoformat") else v for k, v in r.items()}
            )
        return {"columns": columns, "preview": out_rows}
    finally:
        Path(tmp_path).unlink(missing_ok=True)


async def _ws_stream_impl(websocket: WebSocket, provider: str, symbol: str) -> None:
    sym = symbol.strip()
    p = provider.strip().lower()
    host = await _ws_admit(websocket, private=p in _WS_PRIVATE_PROVIDERS)
    if host is None:
        return
    await websocket.accept()
    if p not in _WS_PROVIDERS:
        await websocket.send_json(
            {"error": f"unknown provider '{provider}'", "symbol": sym}
        )
        return
    try:
        candles = cache.get_cached(p, sym)
        if not candles:
            if p == "yfinance":
                candles = await run_in_threadpool(load_yfinance, sym)
                candles = cap_candles(candles)
                cache.set_cached("yfinance", sym, candles)
            else:
                await websocket.send_json(
                    {
                        "error": (
                            "no cached data for this provider; "
                            "load the chart first (GET /data/market or POST /data/csv)"
                        ),
                        "symbol": sym,
                        "provider": p,
                    }
                )
                return
        if not candles:
            await websocket.send_json({"error": "no data", "symbol": sym})
            return
        await stream_candles(websocket, candles, delay_seconds=0.02)
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("WebSocket replay failed for %s:%s", p, sym)
        try:
            await websocket.send_json({"error": "stream failed"})
        except Exception:
            pass
    finally:
        _ws_release(host)


@app.websocket("/ws/stream/{provider}/{symbol}")
async def ws_stream(websocket: WebSocket, provider: str, symbol: str) -> None:
    """
    Replay cached OHLCV as a stream. Use the same **provider** as the data source
    (``yfinance``, ``binance``, ``twelvedata``, ``csv``). Load data via REST first
    except for **yfinance**, which can cold-fetch.
    """
    await _ws_stream_impl(websocket, provider, symbol)


@app.websocket("/ws/stream/{symbol}")
async def ws_stream_legacy(websocket: WebSocket, symbol: str) -> None:
    """Legacy URL: same as ``/ws/stream/yfinance/{symbol}``."""
    await _ws_stream_impl(websocket, "yfinance", symbol)


@app.websocket("/ws/live")
async def ws_live(websocket: WebSocket) -> None:
    """
    Multiplexed live market-data stream.

    Protocol: see ``backend/streaming/protocol.py``. Clients send
    ``subscribe`` / ``unsubscribe`` / ``ping`` JSON messages; server replies
    with ``snapshot`` / ``candle`` / ``status`` / ``error`` / ``pong``.
    Auth (token query param + per-user gating) lands in a later step;
    happy-path is anonymous Binance public data.
    """
    from pydantic import TypeAdapter, ValidationError

    host = await _ws_admit(websocket)
    if host is None:
        return
    await websocket.accept()
    hub = get_hub()
    client_id = f"{id(websocket):x}"

    async def send(msg: ServerMessage) -> None:
        await websocket.send_json(msg.model_dump(mode="json"))

    session = ClientSession(client_id=client_id, send=send)
    client_msg_adapter: TypeAdapter[ClientMessage] = TypeAdapter(ClientMessage)
    message_times: deque[float] = deque()

    try:
        while True:
            raw_text = await websocket.receive_text()
            now = time.monotonic()
            while message_times and now - message_times[0] >= 60:
                message_times.popleft()
            if len(message_times) >= _security.ws_max_messages_per_minute:
                await websocket.close(code=1008, reason="message rate limit exceeded")
                break
            message_times.append(now)
            try:
                raw = json.loads(raw_text)
                msg = client_msg_adapter.validate_python(raw)
            except (json.JSONDecodeError, ValidationError):
                await send(ErrorMessage(code="bad_message", message="Invalid message"))
                continue

            if isinstance(msg, SubscribeMessage):
                if msg.provider in _WS_PRIVATE_PROVIDERS and not _ws_authenticated(
                    websocket
                ):
                    await send(
                        ErrorMessage(
                            code="authentication_required",
                            message="Authentication required",
                        )
                    )
                    continue
                if len(session.subscriptions) >= _security.ws_max_subscriptions:
                    await send(
                        ErrorMessage(
                            code="subscription_limit",
                            message="Subscription limit reached",
                        )
                    )
                    continue
                key = (msg.provider, msg.symbol, msg.interval)
                try:
                    await hub.subscribe(session, key, since=msg.since)
                except NotImplementedError as exc:
                    await send(ErrorMessage(code="unsupported", message=str(exc)))
                except Exception:
                    # Don't tear down the socket on a single bad subscribe —
                    # the client would just reconnect and re-fire the same
                    # request, producing a tight failure loop.
                    logger.exception("subscribe failed for %s", key)
                    await hub.unsubscribe(session, key)
                    await send(
                        ErrorMessage(
                            code="subscribe_failed", message="Subscription failed"
                        )
                    )
            elif isinstance(msg, UnsubscribeMessage):
                key = (msg.provider, msg.symbol, msg.interval)
                await hub.unsubscribe(session, key)
            elif isinstance(msg, SubscribeQuoteMessage):
                if len(session.quote_subscriptions) >= _security.ws_max_subscriptions:
                    await send(
                        ErrorMessage(
                            code="subscription_limit",
                            message="Subscription limit reached",
                        )
                    )
                    continue
                qkey = (msg.provider, msg.symbol)
                try:
                    await hub.subscribe_quote(session, qkey)
                except NotImplementedError as exc:
                    await send(ErrorMessage(code="unsupported", message=str(exc)))
                except Exception:
                    logger.exception("subscribe_quote failed for %s", qkey)
                    await hub.unsubscribe_quote(session, qkey)
                    await send(
                        ErrorMessage(
                            code="subscribe_failed", message="Subscription failed"
                        )
                    )
            elif isinstance(msg, UnsubscribeQuoteMessage):
                qkey = (msg.provider, msg.symbol)
                await hub.unsubscribe_quote(session, qkey)
            elif msg.type == "ping":
                await send(PongMessage())
            else:
                await send(
                    ErrorMessage(
                        code="not_implemented",
                        message=f"'{msg.type}' not yet supported",
                    )
                )
    except WebSocketDisconnect:
        pass
    finally:
        await hub.disconnect(session)
        _ws_release(host)


# Mount static files (must be at the end of the file to capture all remaining routes)
if FRONTEND_DIST.is_dir():
    app.mount(
        "/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend"
    )

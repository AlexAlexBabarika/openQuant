# OpenQuant

OpenQuant is a self-hosted research workspace for charting market data, exploring indicators and analytics, and running reproducible backtests and portfolio simulations. **The research workspace opens by default.**

Open **Robustness** from the workspace header or Strategy editor to check the current strategy draft (including unsaved changes) on the selected provider, symbol, period and interval. Sign in for workspace runs. The configuration sidebar supports execution costs, starting cash, a chronological holdout percentage, JSON parameter overrides and one sensitivity parameter. Performance, Holdout, Sensitivity and Assumptions tabs compare zero-cost / configured-cost runs and buy-and-hold, with source/data SHA-256 provenance and a local HTML export. Source code is not included in exported reports or public links. Saved strategies work by opening them in the editor first.

Workspace checks reuse one provider/cache OHLCV snapshot, not the live chart stream. Parameters default to their first declared grid value unless overridden; no optimization is performed. Sensitivity measures immediate declared-grid neighbors (Choice uses declaration order), holding all other parameters fixed. Holdout starts with fresh cash, strategy/module state and no earlier indicator history. A chronological split **cannot prove dates were unseen during your research**. The suite is single-symbol only, allows 40–10,000 bars with at least 20 per segment, at most 1,000 grid values per parameter, two concurrent suites per server process, and a 30-second whole-suite timeout. Stopping the browser's wait does not terminate server computation; it remains timeout-bounded. Data hashes identify evaluated bars but do not permanently store them; no provider data licensing or production multi-tenant security claim is made.

The same workbench retains **Built-in examples** on clearly labeled synthetic data; example configuration links rerun only these curated examples. Direct `/?trial=1` links open the panel; shared example links select examples mode. Legacy `/?workspace=1` links still open research. The examples-only server below never accepts user strategy code or market-data requests.

## Start in seconds

Install and start Docker Desktop, download and fully extract the OpenQuant
folder, then use the launcher for your operating system:

| System | Start OpenQuant | Stop OpenQuant |
| --- | --- | --- |
| macOS | Double-click `Start OpenQuant.command` | Double-click `Stop OpenQuant.command` |
| Windows | Double-click `Start OpenQuant.bat` | Double-click `Stop OpenQuant.bat` |
| Linux | Run `./scripts/start-openquant.sh` | Run `./scripts/stop-openquant.sh` |

The start launcher waits until OpenQuant is healthy and opens it in your
browser. The stop launcher preserves your accounts, settings, provider keys,
and database. No `.env` file, API key, or PostgreSQL setup is required.

See **[START_HERE.md](START_HERE.md)** for complete instructions, macOS
permissions, terminal commands, port configuration, and troubleshooting.

![OpenQuant dashboard](docs/images/openquant-dashboard.png)

> [!IMPORTANT]
> **Project status: pre-release alpha.** OpenQuant is under active development. Expect breaking changes, incomplete workflows, and no guaranteed upgrade path until the first tagged release. The `amd64` and `arm64` acceptance tests are still release blockers.

Use OpenQuant to:

- chart OHLCV data from Yahoo Finance, Binance, Twelve Data, or your own CSV files;
- compare instruments and explore technical indicators, risk, and distribution analytics;
- write and run research scripts and backtests; and
- save accounts, provider credentials, strategies, and run history locally.

> [!WARNING]
> OpenQuant is educational and research software, not investment advice or a brokerage. It does not place trades. Backtests and simulated results do not guarantee future performance. Market data may be delayed, incomplete, or inaccurate; verify important information with an authoritative source before making financial decisions.

## Continuing research

- Open **Runs** in the toolbox to name experiments, add comma-separated tags and notes, and pin a single-symbol baseline. **Compare with baseline** beside a result uses the existing stored-run comparison; portfolio runs can be reopened but are not comparable to single-symbol baselines.
- Comparisons include **What changed?** for stored source fingerprints, resolved parameters, costs, dataset context, engine, seed and portfolio configuration where recorded. Missing inputs are explicitly unavailable. Replay uses stored bars and the current engine; provider state and runtime/dependency versions are not preserved. Recorded non-default costs are not replayed by the current rerun path. A run ID, notebook label or hash alone does not guarantee reproducibility.
- **Workspaces** offers local Strategy/Indicator draft recovery and up to ten named presets. Presets include data context, overlays, panel visibility, editor split sizes, and copies of both editor drafts. Restore requires confirmation, does not execute scripts, and does not include CSV data. Re-upload CSV files when needed.
- Draft recovery, notebook annotations, and presets live in this browser, separated by account (including a guest scope). They are not cloud saves or a secure vault. Reloaded drafts require an explicit recovery choice; clearing browser storage removes them. Older unscoped notebook references remain in the guest notebook; you can explicitly copy them into your account from **Runs** without moving the originals. Account-saved scripts retain their existing account requirements. Stored run snapshots are global and content-addressed on this server, not account-scoped; notebook accounts do not provide server-snapshot isolation.
- **Inspect data** in the data controls shows loaded versus selected context, actual coverage, browser receipt times, and observed timestamp/OHLCV anomalies. Long intervals are not proof of missing bars; exchange calendars and adjustment policies remain unknown unless supplied by the source.
- In result **Trades** and **Drawdown** tabs, **Focus** selects that period on the result's own price chart. **Show full run** clears the selection without changing calculations.
- Press **Ctrl/⌘ K**, or choose **Commands** in the toolbox, to search research surfaces, drawing tools, symbols, saved account scripts, and notebook runs. Use arrow keys and Enter to select, Escape to dismiss. Opening a saved script does not run it and asks before discarding unsaved editor changes.

## Quick start

1. Install [Docker Desktop](https://docs.docker.com/desktop/) (or Docker Engine with the Compose plugin on Linux).
2. [Download this repository](https://github.com/AlexAlexBabarika/openQuant/archive/refs/heads/main.zip) and extract it, or clone it:

   ```bash
   git clone https://github.com/AlexAlexBabarika/openQuant.git
   cd openQuant
   ```

3. Start OpenQuant using either option:

   - **macOS:** double-click `Start OpenQuant.command`.
   - **Windows:** double-click `Start OpenQuant.bat`.
   - **Linux:** run `./scripts/start-openquant.sh`.

   The launcher waits for healthy containers and opens OpenQuant in your default
   browser. Alternatively, start it from a terminal:

   ```bash
   docker compose up -d
   ```

4. The launcher opens the app when both services are healthy. If you used the
   terminal command, check readiness and then open
   [http://localhost:8000](http://localhost:8000):

   ```bash
   docker compose ps
   ```

No `.env` file, provider key, or PostgreSQL administration is needed for the default experience. OpenQuant generates unique application secrets on first boot and keeps them across restarts.

### After updating the source

Restarting an existing container does not rebuild its frontend. From the updated
checkout, run `docker compose up -d --build`, then refresh the browser to use the
new source. This preserves the existing named data volumes. To review an unmerged
PR, build its checked-out branch rather than a `main` checkout or an older image.

## Optional: standalone robustness examples (not the full app)

The three examples — training-selected momentum, frequent trading with a two-bar holding period, and buy-and-hold — use deterministic, locally generated **synthetic educational OHLCV scenarios, not real market history**. These developer-designed scenarios teach backtest questions; they are not independent evidence of market alpha, investment advice, certification or promises of future performance. There is no live trading, submitted strategy code, billing or provider-key requirement.

With Python 3.12+ and Node.js 20+ installed, run these commands from the repository root (verified on Linux with Python 3.12 and Node 24):

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
npm --prefix frontend ci
python gen_dashboard_fixture.py
npm --prefix frontend run build
uvicorn backend.trial_app:app --host 127.0.0.1 --port 8000
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000); stop with `Ctrl+C`. Dependencies are downloaded during installation. After that the demo needs no PostgreSQL, Docker, account, data-provider keys or provider network access. The fixture generation step supplies the existing workspace dashboard's ignored build fixture; it does not supply or alter trial evidence.

**This command starts an examples-only server, not OpenQuant’s research workspace.** Changing the URL to `/?workspace=1` cannot enable research here. Use the normal launcher or full-app Docker setup above for research.

This standalone server exposes only the curated `/trial/catalog` and `/trial/run` API, health and local frontend files. Workspace links explain that research is unavailable here, including direct `/?workspace=1` requests. In normal mode, `/trial` is also registered in the existing backend and proxied by the Vite development server.

Each run starts with 10,000 currency units. The baseline is frictionless; the realistic strategy and benchmark use your chosen costs. Holdout accounts are separately funded on the same test segment and their curves are never stitched to training. Momentum selects its parameter on training only; the frequent trader uses a fixed cadence. Fixed neighboring parameters are measured on holdout without retuning. Returns and nonpositive drawdowns are fractions in the API, and percentages in the interface.

Copy a configuration link to rerun the current scenario and engine versions; it is **not a permanent hosted report**. Download a self-contained HTML snapshot for the measured metrics, equity curves, findings, assumptions and limitations. Repeated runs use a bounded process-local cache and one computation slot; a busy server responds with a retryable 503.

## What you need

| Requirement | Support |
| --- | --- |
| Operating system | Current macOS or Windows with Docker Desktop; Linux with Docker Engine and Compose v2 |
| CPU architecture | `linux/amd64` and `linux/arm64` are intended targets; formal clean-machine validation is still pending |
| Memory | 4 GB available to Docker recommended; a formal minimum has not been benchmarked |
| Disk | 2 GB free recommended for images and initial data, plus space for uploaded and generated datasets |
| Browser | A current desktop browser |
| Network | Required to download/build the containers and for Yahoo Finance, Binance, and Twelve Data; not required after startup when working only with local CSV data |

Docker support ultimately depends on the [platforms supported by Docker](https://docs.docker.com/desktop/setup/install/). OpenQuant currently binds to `127.0.0.1`, so other devices on your network cannot connect by default.

The default stack caps OpenQuant at 2 CPU cores, 2 GiB RAM, and 512 processes,
and PostgreSQL at 1 CPU core, 1 GiB RAM, and 256 processes. Optimization sweeps
are limited to two concurrent jobs. These conservative limits protect a typical
desktop; lower `MAX_CONCURRENT_SWEEPS` to `1` on smaller systems.

## Data providers

| Provider | Credentials | Internet | Notes |
| --- | --- | --- | --- |
| Yahoo Finance (through `yfinance`) | None | Required | Stocks, ETFs, currencies, and crypto. This is an unofficial integration intended for research/personal use; review [Yahoo's terms](https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html). Yahoo does not publish a stable API quota, so requests may be throttled. |
| Binance | None for public market data; a user-owned key is optional | Required | Crypto pairs and live public streams. Limits are IP- and request-weight-based; see the [official API limits](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/limits) and [terms](https://www.binance.com/en/terms). Availability varies by jurisdiction. |
| Twelve Data | User-owned API key and an OpenQuant account | Required | Add the key inside OpenQuant's API key settings. Allowances depend on the subscription; see [pricing/rate limits](https://twelvedata.com/pricing) and [terms](https://twelvedata.com/terms). |
| CSV | None | No | The file is uploaded to your local OpenQuant server. CSV uploads default to a 10 MiB maximum. |

OpenQuant also enforces its own shared market-data limit of 120 requests per 60 seconds by default. Provider limits still apply independently.

## Everyday operations

Run these commands from the repository directory.

### Start, stop, and inspect

Double-click `Start OpenQuant.command` / `Start OpenQuant.bat` to start the app,
or `Stop OpenQuant.command` / `Stop OpenQuant.bat` to stop it without deleting
data. Linux users can run `./scripts/start-openquant.sh` and
`./scripts/stop-openquant.sh`.

The equivalent terminal commands are:

```bash
docker compose up -d
docker compose stop
docker compose start
docker compose ps
docker compose logs -f openquant
```

`stop`, `start`, and `docker compose down` preserve accounts, saved keys, generated secrets, and database data in Docker volumes. Press `Ctrl+C` to stop following logs.
Compose rotates each service's local logs at 10 MiB and retains three files, so
routine access and health-check logs cannot grow without bound.

### Update

The project is currently pre-release. Ordered database migrations run automatically when the updated app starts, but rollback compatibility is not yet guaranteed. Back up first, review the [release notes](https://github.com/AlexAlexBabarika/openQuant/releases), then rebuild from the checked-out revision:

```bash
git pull --ff-only
docker compose up -d --build
```

Tagged releases can be run without a local build. Set an immutable version and
use the release override:

```bash
export OPENQUANT_VERSION=0.1.0
docker compose -f docker-compose.yml -f compose.release.yml pull
docker compose -f docker-compose.yml -f compose.release.yml up --no-build -d --wait
```

See [the upgrade and rollback guide](docs/UPGRADING.md) before changing versions.

### Development and HTTPS overrides

The default Compose file remains the local-only configuration. Developers who
need direct PostgreSQL access can add `compose.dev.yml`:

```bash
docker compose -f docker-compose.yml -f compose.dev.yml up -d --build
```

For a host-based HTTPS reverse proxy, set its public hostname and enable the
secure-cookie override:

```bash
export PUBLIC_HOST=openquant.example.com
docker compose -f docker-compose.yml -f compose.proxy.yml up -d
```

The proxy should terminate TLS and forward to `127.0.0.1:8000`. Do not expose
that upstream port directly to the internet.

### Back up

This creates a PostgreSQL dump and copies the application data (including the encryption secrets needed by saved provider keys) into `backup/`:

```bash
mkdir -p backup/app-data
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' > backup/openquant.sql
docker compose cp openquant:/app/data/. backup/app-data
```

Protect the backup: it contains account data and the key material that protects saved provider credentials.

### Restore

Restore only into a compatible OpenQuant revision. These commands replace the current database contents with the dump:

```bash
docker compose up -d
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < backup/openquant.sql
docker compose cp backup/app-data/. openquant:/app/data
docker compose restart openquant
```

### Reset all data

> [!CAUTION]
> This permanently deletes all OpenQuant accounts, saved API keys, generated secrets, PostgreSQL data, and application data. It cannot be undone without a backup.

```bash
docker compose down --volumes
```

### Uninstall

To remove the containers and locally built image while preserving data:

```bash
docker compose down --rmi local
```

To uninstall OpenQuant **and permanently delete its data**:

```bash
docker compose down --volumes --rmi local
```

You can then delete the downloaded repository directory.

## Configuration

Configuration is optional for local use. Copy `env.example` to `.env` only when overriding a default. Byte values are positive integers; comma-separated lists must not contain `*`.

| Variable | Purpose | Default | Allowed format | Secret? | Required when |
| --- | --- | --- | --- | --- | --- |
| `OPENQUANT_PORT` | Local browser port | `8000` | TCP port | No | Only to change the port |
| `POSTGRES_DB` | Database name | `openquant` | PostgreSQL identifier | No | Never |
| `POSTGRES_USER` | Database user | `openquant` | PostgreSQL identifier | No | Never |
| `POSTGRES_PASSWORD` | Database password | `openquant` | String | Yes | Only when overriding the local default |
| `JWT_SECRET` | Signs authentication tokens | Generated and persisted | At least 32 characters | Yes | Only for externally managed secrets |
| `API_KEYS_ENCRYPTION_KEY` | Encrypts saved provider keys | Generated and persisted | Exactly 64 hexadecimal characters | Yes | Only for externally managed secrets; retain across restore/upgrade |
| `COOKIE_SECURE` | Adds the cookie `Secure` flag | `0` | `0` or `1` | No | Set to `1` for HTTPS/internet exposure |
| `COOKIE_SAMESITE` | Refresh-cookie cross-site policy | `lax` | `lax`, `strict`, or `none` | No | `none` requires `COOKIE_SECURE=1` |
| `CORS_ORIGINS` | Permitted separate frontend origins | Empty (same-origin only) | Comma-separated origins | No | Only for a separate frontend |
| `ALLOWED_HOSTS` | Accepted HTTP hostnames | `localhost,127.0.0.1` | Comma-separated hostnames | No | Add every reverse-proxy/public hostname |
| `MAX_UPLOAD_BYTES` | Maximum CSV upload | `10485760` | Positive bytes | No | Never |
| `MAX_REQUEST_BYTES` | Maximum HTTP request body | `12582912` | Positive bytes, at least upload limit | No | Never |
| `WS_MAX_MESSAGE_BYTES` | Maximum WebSocket message | `65536` | Positive bytes | No | Never |
| `WS_MAX_CONNECTIONS_PER_IP` | WebSocket connection cap per address | `20` | Positive integer | No | Never |
| `WS_MAX_MESSAGES_PER_MINUTE` | WebSocket message cap per connection | `120` | Positive integer | No | Never |
| `WS_MAX_SUBSCRIPTIONS` | Active subscriptions per socket | `20` | Positive integer | No | Never |
| `MAX_CONCURRENT_SWEEPS` | Concurrent optimization sweeps | `2` | Positive integer | No | Never |
| `MAX_MARKET_OHLCV_CANDLES` | Maximum candles per market response | `8000` | Integer of at least `100` | No | Never |
| `MARKET_RATE_LIMIT_MAX` | Market requests allowed per window | `120` | Positive integer | No | Never |
| `MARKET_RATE_LIMIT_WINDOW_SEC` | Market rate-limit window | `60` | Positive number of seconds | No | Never |
| `SEED_SYMBOLS_ON_STARTUP` | Refresh provider symbol catalogs after startup | `1` in Compose | `0` or `1` | No | Set to `0` to disable |
| `SYMBOL_SEED_PROVIDERS` | Catalogs refreshed at startup | `binance` | Comma-separated `binance`, `twelvedata` | No | Twelve Data also needs `TWELVEDATA_API_KEY` |
| `TWELVEDATA_API_KEY` | Operator key used only by the startup catalog seeder | Empty | Twelve Data API key | Yes | Only when startup seeding includes `twelvedata` |

`DATABASE_URL` and `OPENQUANT_SECRETS_FILE` are wired internally by Compose and normally should not be overridden. For an internet-facing deployment, use an HTTPS reverse proxy, enable secure cookies, set explicit allowed hosts, and review the [security policy](SECURITY.md).

## Data and privacy

OpenQuant has no documented telemetry. Local accounts, password hashes, refresh sessions, encrypted provider keys, preferences, and metadata live in the `postgres_data` Docker volume. Generated encryption secrets and application datasets live in `app_data`. Uploaded CSV contents and in-memory market-data caches are not sent to OpenQuant maintainers.

When you request market data, the OpenQuant backend sends the requested symbol, interval, period/time range, and ordinary network metadata such as your public IP address to the selected provider:

- Yahoo Finance receives Yahoo/yfinance market-data requests.
- Binance receives public REST or WebSocket market-data requests and, if configured, your Binance API credentials.
- Twelve Data receives market-data requests and your Twelve Data API key.
- CSV data stays between your browser and your self-hosted OpenQuant instance unless you explicitly use it in another workflow.

Each provider handles received data under its own privacy policy and terms. OpenQuant does not submit brokerage orders.

## Troubleshooting

- **The page does not open:** run `docker compose ps`; wait for both services to report `healthy`, then inspect `docker compose logs openquant postgres`.
- **A macOS launcher says permission denied:** ensure the repository was fully
  extracted, then run `chmod +x "Start OpenQuant.command" "Stop OpenQuant.command" scripts/*.sh`
  once from Terminal. The files are executable in Git, but some archive tools
  discard that permission.
- **A container is unhealthy:** inspect the service's recent output with `docker compose logs --tail=200 openquant postgres`. Configuration and migration failures are reported in the `openquant` log; PostgreSQL storage and startup failures appear in the `postgres` log.
- **Port 8000 is occupied:** set `OPENQUANT_PORT=8001` in `.env`, restart with `docker compose up -d`, and open `http://localhost:8001`.
- **A provider fails or throttles:** check internet access, symbol/interval support, provider availability, and the provider's rate limit. Twelve Data also requires signing in and saving a valid key.
- **Saved provider keys no longer decrypt:** restore the matching `app_data` backup or the original `API_KEYS_ENCRYPTION_KEY`. Do not generate a replacement for existing encrypted keys.
- **The database is unhealthy after an update:** inspect `docker compose logs openquant postgres`. Migrations are transactional, but restoring a compatible backup is the safest recovery path; automatic rollback is not yet supported.
- **A volume is old or corrupted:** restore a backup made from a compatible OpenQuant revision. If no data must be retained, use the destructive reset command above to recreate clean volumes. Never delete volumes as a troubleshooting step when their data is still needed.

For unresolved problems, [open a bug report](https://github.com/AlexAlexBabarika/openQuant/issues/new/choose). Report suspected vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Project links

- [Contributing guide](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [API documentation](http://localhost:8000/docs) (available while OpenQuant is running)
- [Releases and changelog](https://github.com/AlexAlexBabarika/openQuant/releases)
- [Version history](CHANGELOG.md) and [upgrade guide](docs/UPGRADING.md)
- [Issue tracker and roadmap](https://github.com/AlexAlexBabarika/openQuant/issues)
- [Apache License 2.0](LICENSE), [NOTICE](NOTICE), and [third-party notices](THIRD_PARTY_NOTICES.md)

By contributing, you agree to the [Developer Certificate of Origin process](CONTRIBUTING.md). The OpenQuant name is covered by the repository's [trademark guidance](TRADEMARKS.md).

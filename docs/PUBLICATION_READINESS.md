# Publication readiness: configuration evidence, not approval

OpenQuant remains useful as a local research workbench. This slice adds an
operator checker, not hosting, billing, cloud sync, stronger authorization, or
certification. Do not expose an instance simply because automated checks clear.
Review [SECURITY.md](../SECURITY.md) privately for security concerns; never put
undisclosed findings or account/provider data in public reports.

## Read-only preflight

From the repository root with the existing Python environment:

```bash
.venv/bin/python -m backend.scripts.publication_preflight --mode local
.venv/bin/python -m backend.scripts.publication_preflight --mode hosted \
  --public-origin https://research.example.com --format json
```

The checker reads **its process environment**, not `.env` automatically. Run it
with the same environment and filesystem view as the target app. It does not
import/start the app, connect to PostgreSQL, contact providers, invoke Docker,
generate secrets, create directories, modify configuration, or perform backups.
It reads only bounded secrets/configuration metadata, never saved strategies,
research snapshots, cookies, provider keys, or arbitrary data-file contents.
Its output contains fixed messages and numeric limits, not input values,
connection strings, file paths, exception details, or secret contents.

For an **already running** Compose instance, inspect its actual process context:

```bash
docker compose exec -T openquant python -m backend.scripts.publication_preflight \
  --mode local --format json
```

Optional normalized Compose JSON supplies declared storage/resource metadata.
`docker compose config --format json` resolves interpolation; its output can
contain secrets. Never paste, attach, commit, or log it. Generate it in an
access-restricted directory, using the **exact same** project, `-f` overrides,
environment and Docker context as the target. Do not use image-resolution flags
that could contact registries. The checker itself only reads the resulting file
or stdin. For example (operator-run; no service startup):

```bash
# In a private operator shell. Retain normal Compose arguments on both commands.
umask 077
docker compose -f docker-compose.yml -f compose.proxy.yml config --format json \
  > /protected/operator/preflight-compose.json
docker compose -f docker-compose.yml -f compose.proxy.yml exec -T openquant \
  python -m backend.scripts.publication_preflight --mode hosted \
  --public-origin https://research.example.com --compose-config - --format json \
  < /protected/operator/preflight-compose.json
```

The directory above must already exist with restricted access. `PUBLIC_HOST` and
runtime secrets must be supplied by your normal approved configuration mechanism,
not by copying secrets into command arguments. Protect/dispose of the resolved
metadata according to your retention policy. Without metadata, hosted checks
block on unverified mounts/container limits. For non-Compose infrastructure,
do not fabricate metadata to get clearance: retain that blocker and provide an
equivalent independent operator review.

### Stable output and exits

JSON `schema_version: 1` exposes `mode`, `automated_status` (`clear`/`blocked`),
`publication_status`, `exit_code`, `findings` (`code`, `level`, `message`), numeric
`limits`, and `human_gates` (`code`, `status`). Human output presents the same
checks/gates. Integrations should use finding codes, not parse message prose.

| Exit | Meaning                                                                                                           |
| ---- | ----------------------------------------------------------------------------------------------------------------- |
| `0`  | Local automated checks clear; warnings and human gates may remain. No hosting approval.                           |
| `1`  | Configuration blockers, **or any hosted evaluation**. Even clear hosted configuration has unverified human gates. |
| `2`  | Invalid CLI arguments, or supplied Compose metadata is missing/unreadable/malformed/too large.                    |

There is no `--approve-hosting`, licensing boolean, sandbox-certification flag,
or activation endpoint. Hosted `automated_status: clear` still reports
`publication_status: not_approved` and exits `1`. Local publication status is
`not_evaluated`. Do not turn either into a green “safe to publish” indicator.

### What is checked (and what is not)

- **Runtime configuration:** the existing uncached `security_settings` validator
  checks hosts/origins, cookie policy, positive upload/request/WebSocket/sweep
  limits and request size versus upload size. Invalid values are reported
  without echoing exceptions. Hosted checks additionally require secure cookies,
  a prospective non-loopback HTTPS origin, an exact allowed public hostname,
  and HTTPS-only separate frontend origins; empty CORS remains same-origin only.
- **Market controls actually read by the app:** `MARKET_RATE_LIMIT_MAX`,
  `MARKET_RATE_LIMIT_WINDOW_SEC`, and `MAX_MARKET_OHLCV_CANDLES`. The checker rejects
  nonfinite/invalid budgets and candle caps below 100 even though the runtime
  clamps a smaller candle cap. No new environment switches are introduced.
- **Database intent:** parse the actual libpq connection configuration without
  connecting; flag absent/default password configuration for hosted review.
  External credential mechanisms, transport, reachability, schema health and
  backup durability are not verified by parsing a connection string.
- **Secrets:** environment overrides take precedence. If either value is absent,
  read the existing secrets metadata, check signing-secret length and encryption
  key encoding, and flag group/other permissions. Missing local metadata is a
  warning (startup can generate it); hosted absence blocks. Corrupt, incomplete,
  oversized or unreadable metadata blocks and is **left untouched**. If both
  values are externally configured, the unused file is not read. The checker
  cannot prove key entropy, external persistence, ACLs, or restore-key matching.
- **Declared durability/resources:** require an explicit absolute app-data root
  for hosted use and check its directory presence. Optional Compose metadata
  checks writable named/bind mounts covering the configured root and file-backed
  secrets, plus PostgreSQL 16's `/var/lib/postgresql/data`; both long-running
  services need positive `cpus`, `mem_limit` and `pids_limit`. Published app
  upstream ports must be loopback. Mount coverage is lexical configuration
  evidence, not verified mount identity, symlink containment or surviving a
  machine loss. Compose metadata is not live enforcement or proof that its
  environment matches the inspected process.
- **Execution review remains manual:** HTTP backtest and portfolio routes use
  30-second budgets; display scripts accept a positive timeout up to 30 seconds.
  Runner defaults are 5 seconds (single/display) and 10 seconds (portfolio).
  `MAX_CONCURRENT_SWEEPS` bounds the registry, not all users' execution work.
  The runner's `DEFAULT_MEMORY_MB=512` is **not an enforced per-worker memory
  cap**. Aggregate Compose memory/PID/CPU declarations and best-effort POSIX
  controls are not per-account quotas or proven hostile-code isolation.
  Market/WebSocket limits are not a distributed abuse-control system. Inspect
  actual platform enforcement, proxy/client-IP trust, concurrency and overload
  behavior before considering internet exposure.

The default Compose upstream is loopback; `compose.proxy.yml` configures secure
cookies and allowed hosts but does not install or validate a TLS proxy. The
provided HTTPS origin expresses intent only: certificate validity, TLS
termination, proxy headers, firewall rules and deployment topology are untested.

## Human publication gates: always unverified by this CLI

1. **Provider redistribution rights:** separately verify provider terms,
   commercial/hosted display and caching/redistribution rights, attribution,
   jurisdiction, user-key handling and licensing. A configured key proves none
   of these. The project's code license does not grant market-data rights.
2. **Per-account/private artifacts:** review authorization and ownership for all
   persisted artifacts, exports, caches and logs. Research snapshots are
   currently **server-local/shared**, as the notebook UI documents; this slice
   does not make them account-private or change backend authorization.
3. **Sandbox/resources/abuse:** maintainers must review hostile-code boundaries,
   effective quotas, denial-of-service containment, rate limiting and incident
   response, including every execution entry point. No boolean proves isolation.
4. **Isolated restore drill:** restore a compatible database **and** matching
   app-data/secrets into disposable infrastructure; verify meaningful recovery.
5. **Privacy and retention:** define collection, deletion, retention, backup
   expiry and access policy; handle browser-local state honestly.
6. **Operating responsibility:** name owners for upgrades, costs, monitoring,
   incidents, support and shutdown. Record their approvals privately, separately
   from the automated report. Passing checks is not certification.

## Repeatable isolated restore drill (operator-run, never run by preflight)

Use the [existing README backup/restore mechanisms](../README.md#back-up): a plain
PostgreSQL `pg_dump --clean --if-exists` and `docker compose cp` of `/app/data`.
A database dump plus app-data copy is not one atomic cross-store snapshot.
Quiesce all application writers and scheduled jobs for a consistent pair;
stopping the app still permits copying its data from the stopped container.
Keep PostgreSQL running for the dump. Preserve externally managed encryption
and signing secrets through their approved backup mechanism, too.

1. Record the compatible source code/image revision, PostgreSQL major version,
   database/role identities, timestamp and expected synthetic recovery evidence
   privately. Put both artifacts in an access-restricted, encrypted backup store.
   The app-data backup includes research data/strategies and may contain secrets;
   the SQL dump contains accounts and encrypted provider credentials. Never
   attach these artifacts to an issue, chat or commit.
2. Use a disposable VM/Docker context with **no production containers or volumes**.
   A distinct Compose project provides additional naming isolation, not the
   primary safety boundary. Choose a free loopback port; pin the compatible
   images before the drill. Prepare an operator-owned override outside the
   checkout setting the existing `SEED_SYMBOLS_ON_STARTUP=0`, using the internal
   default network and an independently reviewed outbound-deny policy. Do not
   contact restored providers. No restored real account may be used for trading.
3. Keep every command scoped identically. A shell function reduces accidental
   omission of the isolated project/override:

   ```bash
   # On the disposable VM only, at the compatible checkout.
   export OPENQUANT_PORT=18080
   drill() {
     docker compose -p openquant-restore-drill \
       -f docker-compose.yml -f /protected/operator/restore-drill.yml "$@"
   }
   drill up -d postgres
   # Wait for PostgreSQL readiness. App must not be running during restore.
   drill exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
   drill create --no-deps openquant
   drill exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
     < /protected/backup/openquant.sql
   drill cp /protected/backup/app-data/. openquant:/app/data
   # Inspect ownership/access privately; app runs as UID 10001 in the image.
   # Supply original externally managed secrets if that was the source setup.
   drill up -d openquant
   ```

   Fresh drill database credentials can differ, but restored role ownership and
   database identity must be compatible with the dump; plan any required role
   mapping before restore. `ON_ERROR_STOP` prevents treating partial SQL replay
   as success. Never start the app against restored encrypted keys with newly
   generated replacement key material. Compose starts its existing identity
   migration dependency; review compatibility before allowing that step.

4. In the isolated instance, verify database rows/schema and app-data manifests/
   research snapshots are present, restored provider-key records can decrypt
   **without printing keys or calling providers**, and restart retains the same
   data/key material. Check any synthetic recovery scenario with a disposable
   browser profile. Record downtime, artifact hashes, expected versus observed
   counts and failures, without sensitive payloads. The preflight can be run
   there as additional configuration evidence, not as the recovery assertion.
5. Keep failures as failures; missing/mismatched key material is not fixed by
   rotation for existing ciphertext. Repeat after meaningful storage/schema/
   secret-management changes. Only after reviewing results, remove the drill
   project's containers/volumes on that disposable context. The destructive
   command `drill down --volumes` applies only **there**. Follow retention policy for sensitive
   copies. Do not run volume deletion against the source deployment.

**Excluded from server backups:** browser-local notebook names/tags/notes and
baseline choices, saved workspace layouts, recoverable drafts and Elements/
annotations. Account-scoped browser records remain local to that browser;
local storage is neither encrypted storage nor cloud sync. A server restore
does not restore them. Keep guest/legacy data separate and never silently adopt
it into an account. Use only existing explicit export/recovery mechanisms where
available; do not promise a comprehensive browser backup that does not exist.

## Local research versus a prospective paid service

Local charting, strategy authoring, experiments, comparison and robustness remain
valuable without payment. Nothing here activates billing, imposes a paywall or
makes research performance a financial promise. No broker/trade execution or
AI buy/sell advice is added.

A future paid boundary could charge for **operated** compute capacity, explicit
durable sync/retention, collaboration and support, once actually implemented
with ownership, isolation, quotas, licensing and recovery obligations. These
capabilities are not implemented today: browser notebooks are not cloud-synced,
and shared server snapshots are not a private managed research service. Selling
hosting now would assume responsibilities that this configuration checker cannot
fulfil. Keep that boundary explicit rather than describing local features as
an already activated paid product.

## Authoritative references

- [Starlette TrustedHost/CORS middleware](https://www.starlette.io/middleware/)
- [Docker Compose normalized config](https://docs.docker.com/reference/cli/docker/compose/config/)
- [Compose resource/mount settings](https://docs.docker.com/reference/compose-file/services/)
- [Compose project naming](https://docs.docker.com/compose/how-tos/project-name/)
- [Docker volume lifecycle](https://docs.docker.com/engine/storage/volumes/)
- [PostgreSQL 16 SQL dump/restore](https://www.postgresql.org/docs/16/backup-dump.html)
- [PostgreSQL libpq configuration](https://www.postgresql.org/docs/16/libpq-connect.html)

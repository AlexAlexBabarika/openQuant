# Publication operations: evidence still required

**Hosted status: NOT_APPROVED. All external/live acceptance below: UNVERIFIED.**
This is an operator evidence checklist, not deployment instructions, a sandbox
certificate, a licensing acknowledgment or a billing switch. Local research
remains available. Use the [read-only preflight](PUBLICATION_READINESS.md) for
redacted configuration evidence; even automatic clearance cannot approve hosting.
Keep private review records outside the checkout. Follow [SECURITY.md](../SECURITY.md)
for suspected vulnerabilities; do not put findings or remediation in public
issues, reports or branches pending that private process.

## Source-reviewed declarations versus acceptance

The table describes the shipped source, not a running hosted service. Review it
again whenever runtime enforcement changes. No arbitrary acknowledgment clears
the checker's known resource blockers.

| Boundary | Current declaration/control | What it does not prove |
| --- | --- | --- |
| Saved research | Saved-run routes select `RunStore.for_owner` through required authentication; account namespaces do not move unassigned legacy runs. Authenticated run persistence is separate from guest execution. | Hosted account/tenant authorization acceptance, filesystem containment, export/log privacy and browser-owner lifecycle acceptance remain UNVERIFIED. |
| Annotations/browser research | Account-private state must stay distinct from guest/legacy device state; no silent adoption. | Browser storage is not encrypted durable cloud sync or a server backup. Parent browser/recovery evidence must be reviewed separately. |
| Single/portfolio runs | HTTP run budgets are 30s. Spawned single/display defaults are 5s; portfolio default is 10s. Display requests accept positive timeouts up to 30s. Parent worker collection terminates/joins on timeout. | A worker timeout is not a whole-request/data-fetch deadline, queue bound or verified disconnect/shutdown containment. |
| Robustness | Authenticated route uses a process-local semaphore of two suites, with a 30s spawned suite budget. | Two per process is not two across replicas or a per-account allocation. |
| Worker CPU/files | Resource helper attempts POSIX `RLIMIT_CPU=(30,30)` and `RLIMIT_NOFILE=(64,64)`; unsupported/error cases are skipped. CPU time is cumulative per worker. | Best-effort declarations are not verified live caps or a renewable per-trial budget; platform coverage remains UNVERIFIED. |
| Worker memory | `DEFAULT_MEMORY_MB=512` and display `memory_mb` input exist, but `_apply_resource_limits` intentionally ignores memory. | No per-worker/account memory enforcement. Wallclock time is not a memory cap. `MemoryError` output alone does not establish containment. |
| Optimization | `MAX_CONCURRENT_SWEEPS` limits a process-local registry. Pool size defaults to CPU count. Schema, trial rerun and walk-forward evaluation include documented app-process work. | No shared active/queued worker budget across all entry points, aggregate trial-expansion cap or whole-job wallclock containment. |
| Request/stream limits | Positive size/subscription limits plus process-local IP rate/connection counters. | Distributed abuse control, correct proxy client-IP attribution or tenant quotas. Worker/replica count multiplies local capacity. |
| Compose resources | Application declares 2 CPU, 2GiB memory, 512 PIDs; PostgreSQL declares 1 CPU, 1GiB memory, 256 PIDs. Resolved metadata may override these. | Cgroup/platform enforcement, per-worker allocation and keeping the app responsive under overload are UNVERIFIED. |
| Proxy/network | Default Compose upstream is loopback. Proxy override sets secure cookies and allowed hosts, not TLS. Preflight flags absent/trust-all proxy intent and non-loopback published app/database ports or host networking. | Real TLS certificates, firewall, sanitized forwarding chain and trusted peer topology remain UNVERIFIED. |
| Backups | Database includes accounts/encrypted provider keys; app-data may include research and key material. | Encryption at rest, matching-key recovery, expiry, account deletion and browser recovery remain UNVERIFIED. |

## Private operator evidence record

For each gate, record a responsible person/team, review date, exact code/image
revision and environment/topology, evidence reference, unresolved limitations,
and next review trigger. A checked box, environment boolean, synthetic fixture
or successful preflight is not evidence. Until actual acceptance is separately
reviewed, retain **UNVERIFIED**. Do not upload raw configuration, logs with account
data, research exports, backup manifests/payloads, connection strings or secrets.

### 1. Code license and provider terms — UNVERIFIED

- Identify distribution/hosting obligations under the code license, NOTICE,
  third-party licenses/notices and trademark policy; code rights do not grant
  market-data rights.
- For each supported provider, retain authoritative terms/version and applicable
  account/product: local versus hosted/commercial display, attribution, caching
  duration, redistribution/export, derivative-data rights, geography and end-user
  credential handling. Identify the person authorized to approve those terms.
- A configured key or invented SDK/HTTP response verifies neither rights nor
  native-provider behavior. Provider credentials and live calls are not part of
  this preflight. Missing rights evidence blocks publication planning.

### 2. Private research and lifecycle — UNVERIFIED

- Review intended authenticated owner boundaries and export/log/cache access
  privately; retain synthetic owner-isolation and account-switch evidence without
  source-bearing payloads. Do not claim a source review is hosted acceptance.
- Preserve guest and unassigned legacy artifacts; import/adoption requires an
  explicit user decision and provenance, never default ownership assignment.
- Record disconnect, cancel, failure, restart and actual teardown behavior. A
  hidden workbench task is not unmount; aborting a client is not proof that server
  computation stopped. Sensitive findings follow the private security process.

### 3. Containment, overload and alerting — UNVERIFIED

- Independently review every execution entry point and actual worker/app/process
  isolation. Document effective CPU/memory/PID and wallclock limits, bounded
  active/queued work, trial expansion, fair account allocation and cleanup.
  Resource architecture requires separate review, not an unreviewed integration
  rewrite or a preflight-only flag that claims containment.
- Record worker/replica count and counter scope. Verify overload produces bounded
  rejection/backpressure, recovers capacity and does not strand work or starve
  health/auth/recovery paths. Synthetic local unit tests are not hosted abuse
  acceptance; do not run hostile probes or production load from this checklist.
- Specify monitoring and alert thresholds for resident memory, CPU throttling,
  PID/worker occupancy, queue depth, timeouts/cancellations, request rejection,
  WebSocket reconnects, storage/disk errors and backup age/failure. Name alert
  recipients, response expectations and a verified notification drill. Never log
  credentials, cookies, submitted source or account-private research.

### 4. TLS and proxy topology — UNVERIFIED

- Privately diagram client → TLS termination → trusted proxy peer(s) → upstream,
  including networks, socket/port bindings, certificate renewal and direct
  upstream/database access rules. Record actual launch arguments, not only env.
- Verify forwarding headers are sanitized, only intended peers are trusted and
  client-IP counters behave correctly for direct, proxied and NAT clients.
  `FORWARDED_ALLOW_IPS=*` or a `/0` network is not trusted-proxy verification.
- Review secure cookies, CORS and host settings in that topology. A prospective
  HTTPS origin proves none of certificate validity, TLS or firewall enforcement.

### 5. Retention, deletion and recovery — UNVERIFIED

- Define separate retention/access policies for account research, browser-local
  state, logs, provider cache/keys, database dumps, app-data and every replica or
  exported copy. Record deletion ownership, user-visible behavior and backup
  expiry deadlines; deletion from the live app alone is not deletion from backups.
- Specify encryption/access control, key custody and matching-key retention
  through backup expiry. Retain the isolated [research recovery](RESEARCH_RECOVERY.md)
  drill record privately, including revision compatibility, paired-store
  consistency, expected versus observed recovery and unresolved limitations.
  This checklist neither performs nor duplicates that procedure.
- Record recovery point/time objectives and drill timing/failure evidence. A hash
  check is not a PostgreSQL restore, a source-free report is not full research
  recovery, and server backups do not imply browser annotation/draft recovery.

### 6. Operating and incident responsibility — UNVERIFIED

- Name owners/backups for upgrades and vulnerability response, provider rights,
  storage/backup expiry, TLS renewals, resource capacity/costs, alerting, support,
  incidents and shutdown. Ownership of costs does not activate billing.
- Define private incident intake, containment/escalation authority, preservation
  and redaction policy, rollback/restore responsibility and user communication.
  Include overload, data loss, expired rights/certificates and access concerns.
- Record maintenance/review cadence and changes that invalidate evidence. No
  trading/broker accounts, trades, provider credentials or public deployment are
  authorized by this document.

## Authoritative configuration references

- [Uvicorn settings: proxy trust, workers and resource limits](https://www.uvicorn.org/settings/)
- [Python resource limits: availability and CPU/address-space semantics](https://docs.python.org/3/library/resource.html)
- [Compose services: CPU, memory, PID, networking and ports](https://docs.docker.com/reference/compose-file/services/)
- [Compose normalized config (can contain secrets)](https://docs.docker.com/reference/cli/docker/compose/config/)

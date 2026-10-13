"""Read-only configuration evidence, never approval for public hosting."""

from __future__ import annotations

import argparse
import ipaddress
import json
import math
import os
import stat
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import NoReturn
from urllib.parse import urlsplit

from psycopg.conninfo import conninfo_to_dict

from backend.core.config import security_settings
from backend.core.runtime_secrets import _DEFAULT_PATH, _SECRET_NAMES


HUMAN_GATES = (
    "provider_redistribution_rights",
    "per_account_private_artifacts",
    "sandbox_resource_abuse_review",
    "isolated_restore_drill",
    "privacy_retention_policy",
    "operating_responsibility",
)
_MAX_METADATA_BYTES = 1024 * 1024


@dataclass(frozen=True)
class Finding:
    code: str
    level: str
    message: str


@dataclass
class Report:
    mode: str
    findings: list[Finding]
    limits: dict[str, int | float]
    input_error: bool = False

    @property
    def exit_code(self) -> int:
        if self.input_error:
            return 2
        return int(
            self.mode == "hosted"
            or any(item.level == "blocker" for item in self.findings)
        )

    def to_dict(self) -> dict:
        return {
            "schema_version": 1,
            "mode": self.mode,
            "automated_status": "blocked"
            if any(item.level == "blocker" for item in self.findings)
            else "clear",
            "publication_status": "not_approved"
            if self.mode == "hosted"
            else "not_evaluated",
            "exit_code": self.exit_code,
            "findings": [asdict(item) for item in self.findings],
            "limits": self.limits,
            "human_gates": [
                {"code": gate, "status": "unverified"} for gate in HUMAN_GATES
            ],
        }


def _read_json(path: Path, max_bytes: int, *, allow_stdin: bool = False) -> object:
    if allow_stdin and path == Path("-"):
        payload = sys.stdin.buffer.read(max_bytes + 1)
    else:
        with path.open("rb") as handle:
            payload = handle.read(max_bytes + 1)
    if len(payload) > max_bytes:
        raise ValueError("Metadata exceeds the read limit")
    return json.loads(payload)


def _origin_host(value: str) -> str | None:
    try:
        parsed = urlsplit(value)
        if (
            parsed.scheme != "https"
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path
            or parsed.query
            or parsed.fragment
            or any(char.isspace() for char in value)
        ):
            return None
        if parsed.port == 0:
            return None
        return parsed.hostname
    except ValueError:
        return None


def _local_host(host: str) -> bool:
    if host.rstrip(".") == "localhost":
        return True
    try:
        address = ipaddress.ip_address(host)
        return address.is_loopback or address.is_unspecified
    except ValueError:
        return False


def _within(path: Path, directory: Path) -> bool:
    path = Path(os.path.abspath(path))
    directory = Path(os.path.abspath(directory))
    return path == directory or directory in path.parents


def _positive(value: object, *, integer: bool = False) -> bool:
    if integer:
        return type(value) is int and value > 0
    try:
        number = float(str(value))
        return math.isfinite(number) and number > 0
    except (ValueError, OverflowError):
        return False


def _is_directory(path: str) -> bool:
    try:
        return Path(path).is_dir()
    except (OSError, ValueError):
        return False


def _trusts_all_peers(peer: str) -> bool:
    if peer == "*":
        return True
    try:
        return ipaddress.ip_network(peer, strict=False).prefixlen == 0
    except ValueError:
        return False


def inspect(
    mode: str = "local",
    *,
    public_origin: str | None = None,
    compose_config: Path | None = None,
) -> Report:
    """Inspect this process's environment and optional resolved Compose metadata.

    Never import the app, load/generate runtime secrets, connect to a database,
    or read research artifacts. All messages are fixed, not interpolated input.
    """
    if mode not in {"local", "hosted"}:
        raise ValueError("Unsupported preflight mode")
    report = Report(mode, [], {})

    def add(code: str, level: str, message: str) -> None:
        report.findings.append(Finding(code, level, message))

    caution = "blocker" if mode == "hosted" else "warning"
    try:
        settings = security_settings.__wrapped__()
    except (RuntimeError, ValueError):
        add(
            "runtime.invalid",
            "blocker",
            "Runtime security settings are invalid; review documented cookie, host, origin and size limits privately.",
        )
    else:
        report.limits.update(
            {
                key: value
                for key, value in asdict(settings).items()
                if key.startswith(("max_", "ws_max_"))
            }
        )
        if os.environ.get("COOKIE_SECURE", "0").strip() not in {"0", "1"}:
            add("cookie.invalid", "blocker", "COOKIE_SECURE must be 0 or 1.")
        if not settings.cookie_secure:
            add(
                "cookie.insecure",
                caution,
                "Secure cookies are disabled; use only loopback HTTP, not public hosting.",
            )
        if mode == "hosted":
            host = _origin_host(public_origin or "")
            if host is None or _local_host(host):
                add(
                    "tls.origin",
                    "blocker",
                    "Supply a prospective public HTTPS origin without credentials, path, query or fragment.",
                )
            elif host not in settings.allowed_hosts:
                add(
                    "host.public_missing",
                    "blocker",
                    "The prospective public hostname is not explicitly in ALLOWED_HOSTS.",
                )
            if any("*" in item for item in settings.allowed_hosts):
                add("host.wildcard", "blocker", "Use explicit hosted hostnames.")
            if any(_origin_host(item) is None for item in settings.cors_origins):
                add(
                    "cors.insecure",
                    "blocker",
                    "Hosted CORS origins must be explicit HTTPS origins; empty permits same-origin use.",
                )
            add(
                "tls.unverified",
                "warning",
                "An HTTPS origin is configuration intent only; TLS termination and trusted proxy routing remain unverified.",
            )

    proxy_peers = tuple(
        peer.strip()
        for peer in os.environ.get("FORWARDED_ALLOW_IPS", "").split(",")
        if peer.strip()
    )
    if not proxy_peers:
        add(
            "proxy.trust_missing",
            caution,
            "Explicit proxy peer trust is absent. The shipped Uvicorn launcher defaults to loopback trust; record the actual proxy topology and launch arguments privately.",
        )
    elif any(_trusts_all_peers(peer) for peer in proxy_peers):
        add(
            "proxy.trust_all",
            caution,
            "Proxy headers are configured to trust every peer. Restrict trust to reviewed proxy peers; forwarded client identities are not verified.",
        )
    add(
        "proxy.unverified",
        "warning",
        "Proxy peer configuration does not prove TLS, header sanitization, client-IP attribution or blocked direct upstream access; launch arguments may override it.",
    )

    for name, default, minimum, integer in (
        ("MARKET_RATE_LIMIT_MAX", "120", 1, True),
        ("MARKET_RATE_LIMIT_WINDOW_SEC", "60", 0, False),
        ("MAX_MARKET_OHLCV_CANDLES", "8000", 100, True),
    ):
        try:
            raw = os.environ.get(name, default)
            value = int(raw) if integer else float(raw)
            if not math.isfinite(value) or value < minimum or value <= 0:
                raise ValueError
        except (ValueError, OverflowError):
            add(
                "limits.market_invalid",
                "blocker",
                "Market limits must be finite and positive; the candle cap must be at least 100.",
            )
        else:
            report.limits[name.lower()] = value

    database = os.environ.get(
        "DATABASE_URL", "postgresql://openquant:openquant@127.0.0.1:5432/openquant"
    ).strip()
    try:
        database_config = conninfo_to_dict(database)
        if not database:
            raise ValueError
    except Exception:
        add(
            "database.invalid",
            "blocker",
            "Database connection configuration is invalid; no connection was attempted.",
        )
    else:
        if not os.environ.get("DATABASE_URL", "").strip() or database_config.get(
            "password"
        ) in {None, "", "openquant", "opentrade"}:
            add(
                "database.credentials",
                caution,
                "Database credentials are default or absent; hosted credential management needs review.",
            )
        add(
            "database.unverified",
            "warning",
            "Database reachability, transport protection and durable storage were not tested.",
        )

    secrets_path = Path(os.environ.get("OPENQUANT_SECRETS_FILE", _DEFAULT_PATH))
    configured = {name: os.environ.get(name, "").strip() for name in _SECRET_NAMES}
    if not all(configured.values()):
        try:
            stored = _read_json(secrets_path, 65536)
            if not isinstance(stored, dict) or any(
                name in stored and not isinstance(stored[name], str)
                for name in _SECRET_NAMES
            ):
                raise ValueError
            configured = {
                name: configured[name] or stored.get(name, "").strip()
                for name in _SECRET_NAMES
            }
            if secrets_path.stat().st_mode & (stat.S_IRWXG | stat.S_IRWXO):
                add(
                    "secrets.permissions",
                    caution,
                    "Secrets metadata grants group/other permissions; review access controls.",
                )
        except FileNotFoundError:
            add(
                "secrets.missing",
                caution,
                "Secrets metadata is absent. Startup may generate local secrets; this checker never does.",
            )
        except (OSError, ValueError, UnicodeError, RecursionError):
            add(
                "secrets.unreadable",
                "blocker",
                "Secrets metadata is unreadable or invalid; preserve it and investigate privately, do not overwrite it.",
            )
        else:
            if not all(configured.values()):
                add(
                    "secrets.incomplete",
                    "blocker",
                    "Secrets metadata is missing required values; preserve it and recover matching key material.",
                )
    if configured["JWT_SECRET"] and len(configured["JWT_SECRET"]) < 32:
        add(
            "secrets.jwt_invalid",
            "blocker",
            "The configured signing secret is too short.",
        )
    if configured["API_KEYS_ENCRYPTION_KEY"]:
        try:
            if len(bytes.fromhex(configured["API_KEYS_ENCRYPTION_KEY"])) != 32:
                raise ValueError
        except ValueError:
            add(
                "secrets.encryption_invalid",
                "blocker",
                "The encryption key must encode exactly 32 bytes as hexadecimal; retain original key material for recovery.",
            )
    add(
        "secrets.retention",
        "warning",
        "Secret persistence, external secret management and backup key matching require operator verification.",
    )

    data_root = os.environ.get("OPENQUANT_DATA_ROOT", "")
    if not data_root or not Path(data_root).is_absolute():
        add(
            "data.explicit_root",
            caution,
            "Configure an absolute OPENQUANT_DATA_ROOT for a durable hosted data mount; local defaults remain useful.",
        )
    if data_root and not _is_directory(data_root):
        add(
            "data.missing",
            caution,
            "Configured application data directory is missing or inaccessible; no directory was created.",
        )

    if compose_config is None:
        add(
            "compose.missing",
            caution,
            "Resolved Compose storage/resource metadata was not supplied; container limits and mounts are unverified.",
        )
    else:
        try:
            metadata = _read_json(compose_config, _MAX_METADATA_BYTES, allow_stdin=True)
            if not isinstance(metadata, dict):
                raise ValueError
            services = metadata["services"]
            if not isinstance(services, dict) or any(
                not isinstance(services.get(name), dict)
                for name in ("openquant", "postgres")
            ):
                raise ValueError
        except (OSError, ValueError, KeyError, UnicodeError, RecursionError):
            report.input_error = True
            add(
                "compose.invalid",
                "blocker",
                "Compose metadata is missing, unreadable or malformed; supply normalized docker compose config JSON.",
            )
        else:
            for name in ("openquant", "postgres"):
                service = services[name]
                if not all(
                    _positive(service.get(key), integer=key != "cpus")
                    for key in ("cpus", "mem_limit", "pids_limit")
                ):
                    add(
                        "compose.resource_limits",
                        caution,
                        "Both application and PostgreSQL need finite positive cpus and positive integer mem_limit bytes and pids_limit in normalized metadata.",
                    )
                else:
                    report.limits.update(
                        {
                            f"compose_{name}_{key}": float(service[key])
                            if key == "cpus"
                            else service[key]
                            for key in ("cpus", "mem_limit", "pids_limit")
                        }
                    )
                if service.get("network_mode") == "host":
                    add(
                        "compose.host_network",
                        caution,
                        "Host networking bypasses the declared port mapping boundary; upstream and database exposure need a reviewed isolated network.",
                    )
                mounts = service.get("volumes", [])
                if not isinstance(mounts, list):
                    mounts = []
                targets = [
                    Path(item["target"])
                    for item in mounts
                    if isinstance(item, dict)
                    and item.get("type") in ("volume", "bind")
                    and item.get("source")
                    and isinstance(item.get("target"), str)
                    and Path(item["target"]).is_absolute()
                    and not item.get("read_only", False)
                ]
                required = (
                    [Path("/var/lib/postgresql/data")]
                    if name == "postgres"
                    else [Path(data_root)]
                )
                if name == "openquant" and not all(
                    os.environ.get(key, "").strip() for key in _SECRET_NAMES
                ):
                    required.append(secrets_path)
                if not targets or any(
                    not path.is_absolute()
                    or not any(_within(path, target) for target in targets)
                    for path in required
                ):
                    add(
                        "compose.durable_mounts",
                        caution,
                        "Resolved mounts do not cover configured application data/secrets or PostgreSQL 16 data; durability is not proven by path existence.",
                    )
                ports = service.get("ports", [])
                if not isinstance(ports, list) or any(
                    not isinstance(port, dict)
                    or port.get("host_ip") not in ("127.0.0.1", "::1")
                    for port in ports
                ):
                    add(
                        "compose.upstream_exposure"
                        if name == "openquant"
                        else "compose.database_exposure",
                        caution,
                        "Published application upstream and database ports must stay on loopback; private network topology still requires review.",
                    )
            add(
                "compose.evidence_only",
                "warning",
                "Compose metadata is declared configuration, not live enforcement or proof that it matches this process's runtime environment.",
            )

    for code, message in (
        (
            "execution.memory_unenforced",
            "This revision's worker resource helper ignores memory_mb. Container memory declarations are aggregate, not enforced per-worker or per-account memory quotas.",
        ),
        (
            "execution.aggregate_unbounded",
            "There is no shared admission bound across execution entry points. Sweep pool size follows CPU count; job, trial expansion and queue budgets need bounded enforcement.",
        ),
        (
            "execution.in_process",
            "Schema evaluation, sweep trial reruns and walk-forward out-of-sample code can execute in the app process without the spawned runner's wallclock boundary.",
        ),
        (
            "limits.process_local",
            "Rate counters, WebSocket counts, sweep registry and robustness semaphore are process-local; more workers or replicas multiply capacity, not distributed quotas.",
        ),
    ):
        add(code, caution, message)
    add(
        "execution.review",
        "warning",
        "Spawned runner wallclock timeouts and best-effort POSIX CPU/descriptor caps do not certify sandbox isolation. Live enforcement, overload and cleanup remain unverified.",
    )
    add(
        "auth.owner_review",
        "warning",
        "Saved research routes require authenticated owner stores; guest and unassigned legacy artifacts are separate. This checker does not exercise owner authorization or certify hosted tenant isolation.",
    )
    add(
        "backup.credentials_unverified",
        "warning",
        "Database backups include account records and encrypted provider credentials; app-data may include research and key material. Matching-key recovery, deletion and backup expiry remain unverified.",
    )
    return report


def render_human(report: Report) -> str:
    data = report.to_dict()
    lines = [
        f"OpenQuant {report.mode} preflight: automated checks {data['automated_status']}",
        f"Publication: {data['publication_status']} (configuration checks are not certification)",
    ]
    lines.extend(
        f"{item.level.upper()} {item.code}: {item.message}" for item in report.findings
    )
    lines.extend(f"LIMIT {name}: {value}" for name, value in report.limits.items())
    lines.extend(f"UNVERIFIED {gate}" for gate in HUMAN_GATES)
    return "\n".join(lines)


class _Parser(argparse.ArgumentParser):
    def error(self, message: str) -> NoReturn:
        self.exit(
            2,
            "Invalid preflight arguments. Use --help; do not pass secrets on the command line.\n",
        )


def main(argv: list[str] | None = None) -> int:
    parser = _Parser(description=__doc__)
    parser.add_argument("--mode", choices=("local", "hosted"), default="local")
    parser.add_argument(
        "--public-origin", help="Prospective HTTPS origin, not TLS proof"
    )
    parser.add_argument(
        "--compose-config",
        type=Path,
        help="Optional normalized Compose JSON metadata; '-' reads stdin (read only)",
    )
    parser.add_argument("--format", choices=("human", "json"), default="human")
    args = parser.parse_args(argv)
    report = inspect(
        args.mode, public_origin=args.public_origin, compose_config=args.compose_config
    )
    print(
        json.dumps(report.to_dict(), indent=2)
        if args.format == "json"
        else render_human(report)
    )
    return report.exit_code


if __name__ == "__main__":
    raise SystemExit(main())

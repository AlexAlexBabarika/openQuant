import json
import os
import socket
import subprocess
import sys
from pathlib import Path

import psycopg
import pytest

from backend.core import runtime_secrets
from backend.core.config import security_settings
from backend.scripts import publication_preflight as preflight


ENV_NAMES = (
    "COOKIE_SECURE",
    "COOKIE_SAMESITE",
    "CORS_ORIGINS",
    "ALLOWED_HOSTS",
    "MAX_UPLOAD_BYTES",
    "MAX_REQUEST_BYTES",
    "WS_MAX_CONNECTIONS_PER_IP",
    "WS_MAX_MESSAGE_BYTES",
    "WS_MAX_MESSAGES_PER_MINUTE",
    "WS_MAX_SUBSCRIPTIONS",
    "MAX_CONCURRENT_SWEEPS",
    "MARKET_RATE_LIMIT_MAX",
    "MARKET_RATE_LIMIT_WINDOW_SEC",
    "MAX_MARKET_OHLCV_CANDLES",
    "JWT_SECRET",
    "API_KEYS_ENCRYPTION_KEY",
    "OPENQUANT_DATA_ROOT",
    "OPENQUANT_SECRETS_FILE",
    "DATABASE_URL",
    "FORWARDED_ALLOW_IPS",
    "TWELVEDATA_API_KEY",
)
SENTINEL = "DO_NOT_DISCLOSE_TEST_SENTINEL"


@pytest.fixture(autouse=True)
def isolated_environment(monkeypatch, tmp_path):
    for name in ENV_NAMES:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("OPENQUANT_SECRETS_FILE", str(tmp_path / "secrets.json"))


def codes(report):
    return {item.code for item in report.findings}


def hosted_environment(monkeypatch, tmp_path):
    monkeypatch.setenv("COOKIE_SECURE", "1")
    monkeypatch.setenv("ALLOWED_HOSTS", "research.example.com")
    monkeypatch.setenv(
        "DATABASE_URL", "postgresql://drill:synthetic-password@postgres/drill"
    )
    monkeypatch.setenv("JWT_SECRET", "synthetic-signing-secret" * 3)
    monkeypatch.setenv("API_KEYS_ENCRYPTION_KEY", "ab" * 32)
    monkeypatch.setenv("OPENQUANT_DATA_ROOT", str(tmp_path))
    monkeypatch.setenv("FORWARDED_ALLOW_IPS", "127.0.0.1,::1")


def compose_metadata(tmp_path, *, app_target=None):
    metadata = {
        "services": {
            name: {
                "cpus": 1.0,
                "mem_limit": 1073741824,
                "pids_limit": 256,
                "volumes": [
                    {
                        "type": "volume",
                        "source": name + "_data",
                        "target": (app_target or str(tmp_path))
                        if name == "openquant"
                        else "/var/lib/postgresql/data",
                    }
                ],
                "ports": [{"target": 8000, "published": "8000", "host_ip": "127.0.0.1"}]
                if name == "openquant"
                else [],
            }
            for name in ("openquant", "postgres")
        }
    }
    path = tmp_path / "compose.json"
    path.write_text(json.dumps(metadata))
    return path, metadata


def hosted(monkeypatch, tmp_path, **kwargs):
    hosted_environment(monkeypatch, tmp_path)
    path, _ = compose_metadata(tmp_path)
    return preflight.inspect(
        "hosted",
        public_origin="https://research.example.com",
        compose_config=path,
        **kwargs,
    )


def test_local_defaults_remain_useful_and_do_not_generate_secrets(tmp_path):
    report = preflight.inspect()
    assert report.exit_code == 0
    assert report.to_dict()["publication_status"] == "not_evaluated"
    assert {"cookie.insecure", "secrets.missing", "compose.missing"} <= codes(report)
    assert not (tmp_path / "secrets.json").exists()


EXECUTION_BLOCKERS = {
    "execution.memory_unenforced",
    "execution.aggregate_unbounded",
    "execution.in_process",
    "limits.process_local",
}


def test_hosted_declarations_cannot_hide_known_runtime_gaps(monkeypatch, tmp_path):
    report = hosted(monkeypatch, tmp_path)
    output = report.to_dict()
    assert output["automated_status"] == "blocked"
    assert {item.code for item in report.findings if item.level == "blocker"} == (
        EXECUTION_BLOCKERS
    )
    assert output["publication_status"] == "not_approved"
    assert output["exit_code"] == 1
    assert len(output["human_gates"]) == 6
    assert all(gate["status"] == "unverified" for gate in output["human_gates"])
    assert "configuration checks are not certification" in preflight.render_human(
        report
    )


def test_hosted_even_a_clear_report_never_approves_publication():
    report = preflight.Report("hosted", [], {})
    assert report.to_dict()["automated_status"] == "clear"
    assert report.to_dict()["publication_status"] == "not_approved"
    assert report.exit_code == 1
    assert all(
        gate["status"] == "unverified" for gate in report.to_dict()["human_gates"]
    )


def test_local_execution_gaps_are_warnings_not_local_activation_gates():
    report = preflight.inspect()
    assert {item.code for item in report.findings if item.level == "warning"} >= (
        EXECUTION_BLOCKERS | {"auth.owner_review", "backup.credentials_unverified"}
    )
    assert report.exit_code == 0


@pytest.mark.parametrize("value", [None, "", " , "])
def test_missing_proxy_trust_is_hosted_blocker_local_warning(
    monkeypatch, tmp_path, value
):
    hosted_environment(monkeypatch, tmp_path)
    if value is None:
        monkeypatch.delenv("FORWARDED_ALLOW_IPS")
    else:
        monkeypatch.setenv("FORWARDED_ALLOW_IPS", value)
    for mode, level in (("local", "warning"), ("hosted", "blocker")):
        report = preflight.inspect(mode, public_origin="https://research.example.com")
        assert any(
            item.code == "proxy.trust_missing" and item.level == level
            for item in report.findings
        )


@pytest.mark.parametrize("value", ["*", "127.0.0.1, * ", "0.0.0.0/0", "::/0"])
def test_trust_all_proxy_declarations_block_hosted(monkeypatch, tmp_path, value):
    hosted_environment(monkeypatch, tmp_path)
    monkeypatch.setenv("FORWARDED_ALLOW_IPS", value)
    report = preflight.inspect("hosted", public_origin="https://research.example.com")
    assert any(
        item.code == "proxy.trust_all" and item.level == "blocker"
        for item in report.findings
    )


@pytest.mark.parametrize("value", ["127.0.0.1,::1", "192.0.2.0/24", "/run/proxy.sock"])
def test_explicit_proxy_intent_is_not_topology_acceptance(monkeypatch, value):
    monkeypatch.setenv("FORWARDED_ALLOW_IPS", value)
    report = preflight.inspect()
    assert not {"proxy.trust_missing", "proxy.trust_all"} & codes(report)
    assert "proxy.unverified" in codes(report)


def test_acknowledgment_booleans_cannot_approve_hosting(monkeypatch, tmp_path):
    for name in ("HOSTING_APPROVED", "SANDBOX_APPROVED", "PROVIDER_LICENSED"):
        monkeypatch.setenv(name, "1")
    report = hosted(monkeypatch, tmp_path)
    assert EXECUTION_BLOCKERS <= codes(report)
    assert report.to_dict()["publication_status"] == "not_approved"
    assert all(
        gate["status"] == "unverified" for gate in report.to_dict()["human_gates"]
    )


@pytest.mark.parametrize(
    "name,value",
    [
        ("MAX_UPLOAD_BYTES", "0"),
        ("MAX_REQUEST_BYTES", "1"),
        ("WS_MAX_CONNECTIONS_PER_IP", "-1"),
        ("WS_MAX_MESSAGE_BYTES", SENTINEL),
        ("WS_MAX_MESSAGES_PER_MINUTE", "0"),
        ("WS_MAX_SUBSCRIPTIONS", "0"),
        ("MAX_CONCURRENT_SWEEPS", "0"),
        ("COOKIE_SAMESITE", SENTINEL),
        ("CORS_ORIGINS", "*"),
        ("ALLOWED_HOSTS", "*"),
    ],
)
def test_runtime_validation_is_reused_without_exposing_input(monkeypatch, name, value):
    monkeypatch.setenv(name, value)
    report = preflight.inspect()
    assert report.exit_code == 1
    assert "runtime.invalid" in codes(report)
    assert SENTINEL not in json.dumps(report.to_dict()) + preflight.render_human(report)


def test_inspection_does_not_change_the_application_settings_cache(monkeypatch):
    security_settings.cache_clear()
    original = security_settings()
    monkeypatch.setenv("MAX_UPLOAD_BYTES", "12")
    assert preflight.inspect().limits["max_upload_bytes"] == 12
    assert security_settings() is original
    security_settings.cache_clear()


@pytest.mark.parametrize("value", ["", "yes", SENTINEL])
def test_invalid_secure_cookie_values_are_blocked(monkeypatch, value):
    monkeypatch.setenv("COOKIE_SECURE", value)
    assert "cookie.invalid" in codes(preflight.inspect())


@pytest.mark.parametrize(
    "name,value",
    [
        ("MARKET_RATE_LIMIT_MAX", "0"),
        ("MARKET_RATE_LIMIT_MAX", "1.5"),
        ("MARKET_RATE_LIMIT_WINDOW_SEC", "nan"),
        ("MARKET_RATE_LIMIT_WINDOW_SEC", "inf"),
        ("MARKET_RATE_LIMIT_WINDOW_SEC", "-2"),
        ("MAX_MARKET_OHLCV_CANDLES", "99"),
        ("MAX_MARKET_OHLCV_CANDLES", SENTINEL),
    ],
)
def test_market_limits_fail_closed(monkeypatch, name, value):
    monkeypatch.setenv(name, value)
    report = preflight.inspect()
    assert report.exit_code == 1
    assert "limits.market_invalid" in codes(report)
    assert SENTINEL not in preflight.render_human(report)


def test_limits_are_actual_effective_values(monkeypatch):
    monkeypatch.setenv("MAX_CONCURRENT_SWEEPS", "3")
    monkeypatch.setenv("MARKET_RATE_LIMIT_WINDOW_SEC", "0.5")
    report = preflight.inspect()
    assert report.limits["max_concurrent_sweeps"] == 3
    assert report.limits["market_rate_limit_window_sec"] == 0.5
    assert report.limits["max_market_ohlcv_candles"] == 8000


@pytest.mark.parametrize(
    "origin",
    [
        None,
        "http://research.example.com",
        "https://research.example.com/path",
        "https://research.example.com/",
        "https://research.example.com?" + SENTINEL,
        "https://research.example.com#" + SENTINEL,
        "https://" + SENTINEL + "@research.example.com",
        "https://research.example.com:bad",
        "https://localhost",
        "https://localhost.",
        "https://127.5.6.7",
        "https://0.0.0.0",
        "https://[::]",
        "https://research.example.com:0",
        "https://[::1]",
    ],
)
def test_invalid_public_origins_are_blocked_without_echo(monkeypatch, tmp_path, origin):
    hosted_environment(monkeypatch, tmp_path)
    report = preflight.inspect("hosted", public_origin=origin)
    assert "tls.origin" in codes(report)
    assert SENTINEL not in json.dumps(report.to_dict())


def test_host_and_cors_contracts(monkeypatch, tmp_path):
    hosted_environment(monkeypatch, tmp_path)
    monkeypatch.setenv("CORS_ORIGINS", "http://frontend.example.com")
    report = preflight.inspect("hosted", public_origin="https://other.example.com")
    assert {"cors.insecure", "host.public_missing", "tls.unverified"} <= codes(report)
    monkeypatch.setenv("CORS_ORIGINS", "https://frontend.example.com")
    monkeypatch.setenv("ALLOWED_HOSTS", "*.example.com")
    assert "host.wildcard" in codes(
        preflight.inspect("hosted", public_origin="https://research.example.com")
    )


@pytest.mark.parametrize(
    "payload",
    [
        "broken " + SENTINEL,
        "[]",
        "null",
        '{"JWT_SECRET": 32}',
        '{"JWT_SECRET": "short"}',
        "[" * 1200,
    ],
)
def test_bad_secret_metadata_is_preserved(tmp_path, payload):
    path = tmp_path / "secrets.json"
    path.write_text(payload)
    before = path.read_bytes()
    report = preflight.inspect()
    assert report.exit_code == 1
    assert {"secrets.unreadable", "secrets.incomplete"} & codes(report)
    assert path.read_bytes() == before
    assert SENTINEL not in json.dumps(report.to_dict()) + preflight.render_human(report)


def test_secret_environment_precedence_and_permissions(monkeypatch, tmp_path):
    path = tmp_path / "secrets.json"
    path.write_text(
        json.dumps({"JWT_SECRET": "old" * 20, "API_KEYS_ENCRYPTION_KEY": "ab" * 32})
    )
    path.chmod(0o600)
    monkeypatch.setenv("JWT_SECRET", SENTINEL * 2)
    report = preflight.inspect()
    assert not any(
        item.code.startswith("secrets.") and item.level == "blocker"
        for item in report.findings
    )
    assert "secrets.permissions" not in codes(report)
    path.chmod(0o644)
    assert "secrets.permissions" in codes(preflight.inspect())
    assert path.stat().st_mode & 0o777 == 0o644


def test_unreadable_storage_is_not_replaced(monkeypatch, tmp_path):
    path = tmp_path / "secrets.json"
    path.write_text(SENTINEL)
    original_open = Path.open

    def deny_secret(self, *args, **kwargs):
        if self == path:
            raise PermissionError(SENTINEL)
        return original_open(self, *args, **kwargs)

    monkeypatch.setattr(Path, "open", deny_secret)
    report = preflight.inspect()
    assert "secrets.unreadable" in codes(report)
    assert SENTINEL not in preflight.render_human(report)
    monkeypatch.setattr(Path, "open", original_open)
    assert path.read_text() == SENTINEL


def test_fully_external_secrets_skip_unreadable_local_file(monkeypatch, tmp_path):
    hosted_environment(monkeypatch, tmp_path)
    (tmp_path / "secrets.json").write_text("corrupt")
    assert "secrets.unreadable" not in codes(preflight.inspect())


@pytest.mark.parametrize(
    "name,value,code",
    [
        ("JWT_SECRET", SENTINEL, "secrets.jwt_invalid"),
        ("API_KEYS_ENCRYPTION_KEY", SENTINEL, "secrets.encryption_invalid"),
        ("API_KEYS_ENCRYPTION_KEY", "ab" * 31, "secrets.encryption_invalid"),
    ],
)
def test_invalid_secrets_are_redacted(monkeypatch, name, value, code):
    monkeypatch.setenv("JWT_SECRET", "a" * 64)
    monkeypatch.setenv("API_KEYS_ENCRYPTION_KEY", "ab" * 32)
    monkeypatch.setenv(name, value)
    report = preflight.inspect()
    assert code in codes(report)
    assert SENTINEL not in preflight.render_human(report)


@pytest.mark.parametrize("database", ["", SENTINEL, "postgresql://%invalid"])
def test_database_errors_are_redacted(monkeypatch, database):
    monkeypatch.setenv("DATABASE_URL", database)
    report = preflight.inspect()
    assert "database.invalid" in codes(report)
    assert SENTINEL not in preflight.render_human(report)


@pytest.mark.parametrize(
    "payload",
    [
        "bad " + SENTINEL,
        "[]",
        "{}",
        '{"services": []}',
        '{"services": {"openquant": []}}',
        "[" * 1200,
    ],
)
def test_missing_or_corrupt_compose_metadata_has_stable_exit_two(tmp_path, payload):
    path = tmp_path / (SENTINEL + ".json")
    assert preflight.inspect(compose_config=path).exit_code == 2
    path.write_text(payload)
    before = path.read_bytes()
    report = preflight.inspect(compose_config=path)
    assert report.exit_code == 2
    assert path.read_bytes() == before
    assert SENTINEL not in preflight.render_human(report)


def test_oversized_metadata_is_not_read_or_overwritten(tmp_path):
    path = tmp_path / "compose.json"
    path.write_bytes(b" " * (preflight._MAX_METADATA_BYTES + 1))
    assert preflight.inspect(compose_config=path).exit_code == 2
    path = tmp_path / "secrets.json"
    path.write_bytes(b" " * 65537)
    assert "secrets.unreadable" in codes(preflight.inspect())
    assert path.stat().st_size == 65537


@pytest.mark.parametrize(
    "name,key,value",
    [
        ("openquant", "cpus", "nan"),
        ("postgres", "pids_limit", -1),
        ("openquant", "mem_limit", 0),
        ("openquant", "mem_limit", 0.5),
        ("postgres", "pids_limit", 1.5),
        ("postgres", "pids_limit", "2"),
        ("postgres", "cpus", "inf"),
        ("openquant", "mem_limit", True),
        ("postgres", "network_mode", "host"),
        ("openquant", "network_mode", "host"),
        ("postgres", "volumes", []),
        (
            "openquant",
            "volumes",
            [{"type": [], "source": SENTINEL, "target": "/app/data"}],
        ),
        ("openquant", "ports", [{"host_ip": "0.0.0.0"}]),
        ("openquant", "ports", [{"host_ip": []}]),
        ("postgres", "ports", [{"host_ip": "0.0.0.0"}]),
        ("postgres", "ports", [{"host_ip": "::"}]),
        ("postgres", "ports", [{"published": "5432"}]),
    ],
)
def test_container_metadata_failures_are_blockers_for_hosted(
    monkeypatch, tmp_path, name, key, value
):
    hosted_environment(monkeypatch, tmp_path)
    path, metadata = compose_metadata(tmp_path)
    metadata["services"][name][key] = value
    path.write_text(json.dumps(metadata))
    report = preflight.inspect(
        "hosted", public_origin="https://research.example.com", compose_config=path
    )
    assert report.to_dict()["automated_status"] == "blocked"
    assert any(
        item.code.startswith("compose.") and item.level == "blocker"
        for item in report.findings
    )
    assert SENTINEL not in preflight.render_human(report)


def test_normalized_compose_limits_are_reported_only_as_numeric_declarations(
    monkeypatch, tmp_path
):
    report = hosted(monkeypatch, tmp_path)
    for name in ("openquant", "postgres"):
        assert report.limits[f"compose_{name}_cpus"] == 1.0
        assert report.limits[f"compose_{name}_mem_limit"] == 1073741824
        assert report.limits[f"compose_{name}_pids_limit"] == 256
    assert "compose.evidence_only" in codes(report)
    assert EXECUTION_BLOCKERS <= codes(report)


def test_loopback_database_mapping_remains_local_intent(monkeypatch, tmp_path):
    hosted_environment(monkeypatch, tmp_path)
    path, metadata = compose_metadata(tmp_path)
    metadata["services"]["postgres"]["ports"] = [
        {"host_ip": "::1", "published": "5432"}
    ]
    path.write_text(json.dumps(metadata))
    report = preflight.inspect(compose_config=path)
    assert "compose.database_exposure" not in codes(report)
    assert "compose.evidence_only" in codes(report)


def test_integer_declarations_are_not_rounded_through_float(monkeypatch, tmp_path):
    hosted_environment(monkeypatch, tmp_path)
    path, metadata = compose_metadata(tmp_path)
    metadata["services"]["openquant"]["mem_limit"] = 2**53 + 1
    path.write_text(json.dumps(metadata))
    report = preflight.inspect(compose_config=path)
    assert report.limits["compose_openquant_mem_limit"] == 2**53 + 1


def test_mount_checks_include_file_secrets_and_reject_parent_traversal(
    monkeypatch, tmp_path
):
    hosted_environment(monkeypatch, tmp_path)
    monkeypatch.delenv("JWT_SECRET")
    monkeypatch.delenv("API_KEYS_ENCRYPTION_KEY")
    (tmp_path / "secrets.json").write_text(
        json.dumps({"JWT_SECRET": "a" * 64, "API_KEYS_ENCRYPTION_KEY": "ab" * 32})
    )
    (tmp_path / "secrets.json").chmod(0o600)
    path, metadata = compose_metadata(tmp_path)
    report = preflight.inspect(
        "hosted", public_origin="https://research.example.com", compose_config=path
    )
    assert "compose.durable_mounts" not in codes(report)
    monkeypatch.setenv("OPENQUANT_DATA_ROOT", str(tmp_path / ".." / "outside"))
    assert "compose.durable_mounts" in codes(preflight.inspect(compose_config=path))
    monkeypatch.setenv("OPENQUANT_DATA_ROOT", str(tmp_path))
    metadata["services"]["openquant"]["volumes"][0]["read_only"] = True
    path.write_text(json.dumps(metadata))
    assert "compose.durable_mounts" in codes(preflight.inspect(compose_config=path))


def test_preflight_does_not_call_network_runtime_loader_or_modify_environment(
    monkeypatch, tmp_path
):
    def forbidden(*args, **kwargs):
        raise AssertionError("unexpected mutating or network operation")

    monkeypatch.setattr(socket, "socket", forbidden)
    monkeypatch.setattr(psycopg, "connect", forbidden)
    monkeypatch.setattr(runtime_secrets, "load_runtime_secrets", forbidden)
    environment = dict(os.environ)
    files = sorted(tmp_path.iterdir())
    preflight.inspect()
    assert dict(os.environ) == environment
    assert sorted(tmp_path.iterdir()) == files


def test_cli_smoke_json_human_and_stdin(monkeypatch, tmp_path):
    command = [sys.executable, "-m", "backend.scripts.publication_preflight"]
    local = subprocess.run(
        command + ["--format", "json"], capture_output=True, text=True
    )
    assert local.returncode == 0
    assert json.loads(local.stdout)["schema_version"] == 1
    assert not local.stderr
    hosted_environment(monkeypatch, tmp_path)
    _, metadata = compose_metadata(tmp_path)
    metadata["saved_strategy"] = SENTINEL
    result = subprocess.run(
        command
        + [
            "--mode",
            "hosted",
            "--public-origin",
            "https://research.example.com",
            "--compose-config",
            "-",
            "--format",
            "json",
        ],
        input=json.dumps(metadata),
        capture_output=True,
        text=True,
    )
    assert result.returncode == 1
    assert json.loads(result.stdout)["automated_status"] == "blocked"
    assert SENTINEL not in result.stdout + result.stderr
    human = subprocess.run(command, capture_output=True, text=True)
    assert "UNVERIFIED provider_redistribution_rights" in human.stdout
    invalid = subprocess.run(
        command + ["--mode", SENTINEL], capture_output=True, text=True
    )
    assert invalid.returncode == 2
    assert SENTINEL not in invalid.stdout + invalid.stderr


def test_all_output_channels_redact_provider_keys_paths_and_connection_strings(
    monkeypatch, tmp_path, capsys
):
    hosted_environment(monkeypatch, tmp_path)
    monkeypatch.setenv("JWT_SECRET", SENTINEL * 3)
    monkeypatch.setenv("TWELVEDATA_API_KEY", SENTINEL)
    monkeypatch.setenv("FORWARDED_ALLOW_IPS", SENTINEL + ",*")
    monkeypatch.setenv(
        "DATABASE_URL", "postgresql://" + SENTINEL + ":" + SENTINEL + "@postgres/drill"
    )
    monkeypatch.setenv("OPENQUANT_DATA_ROOT", str(tmp_path / SENTINEL))
    monkeypatch.setenv("OPENQUANT_SECRETS_FILE", str(tmp_path / SENTINEL))
    for output_format in ("json", "human"):
        assert (
            preflight.main(
                [
                    "--mode",
                    "hosted",
                    "--format",
                    output_format,
                    "--public-origin",
                    "https://" + SENTINEL + "@research.example.com",
                ]
            )
            == 1
        )
        captured = capsys.readouterr()
        assert SENTINEL not in captured.out + captured.err

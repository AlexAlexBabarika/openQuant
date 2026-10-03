from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess

import pytest


ROOT = Path(__file__).resolve().parents[2]


def test_launcher_select_port_skips_published_docker_port(tmp_path: Path) -> None:
    docker = tmp_path / "docker"
    docker.write_text(
        "#!/bin/sh\nprintf '%s\\n' '0.0.0.0:8000->8000/tcp, [::]:8000->8000/tcp'\n",
        encoding="utf-8",
    )
    docker.chmod(0o755)

    result = subprocess.run(
        [
            "sh",
            "-c",
            ". scripts/launcher-common.sh; launcher_select_port 8000",
        ],
        cwd=ROOT,
        env={**os.environ, "PATH": f"{tmp_path}:{os.environ['PATH']}"},
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout == "8001\n"


@pytest.mark.parametrize(
    "dotenv_port,shell_port,existing_port,occupied_port,expected_port",
    [
        ("8010", None, None, "8000", "8010"),
        ("8010", None, "8002", None, "8010"),
        ("8010", "8020", None, None, "8020"),
        (None, None, "8002", None, "8002"),
        (None, None, None, "8000", "8001"),
        (None, None, None, None, "8000"),
    ],
)
def test_start_launcher_respects_compose_port_configuration(
    tmp_path: Path,
    dotenv_port: str | None,
    shell_port: str | None,
    existing_port: str | None,
    occupied_port: str | None,
    expected_port: str,
) -> None:
    scripts = tmp_path / "scripts"
    scripts.mkdir()
    for name in ("start-openquant.sh", "launcher-common.sh"):
        shutil.copy(ROOT / "scripts" / name, scripts / name)
    if dotenv_port:
        (tmp_path / ".env").write_text(f"OPENQUANT_PORT={dotenv_port}\n")
    if existing_port:
        (tmp_path / ".published-port").write_text(existing_port)

    docker = tmp_path / "docker"
    docker.write_text(
        """#!/bin/sh
case "$*" in
  'compose version'|'info') exit 0 ;;
  'compose config --environment')
    if [ -n "${OPENQUANT_PORT:-}" ]; then
      printf 'OPENQUANT_PORT=%s\n' "$OPENQUANT_PORT"
    elif [ -f .env ]; then
      cat .env
    fi
    ;;
  'compose port openquant 8000')
    [ -f .published-port ] || exit 1
    printf '127.0.0.1:%s\n' "$(cat .published-port)"
    ;;
  'ps --format {{.Ports}}')
    if [ -n "${TEST_OCCUPIED_PORT:-}" ]; then
      printf '0.0.0.0:%s->8000/tcp\n' "$TEST_OCCUPIED_PORT"
    fi
    ;;
  'compose up -d --wait --wait-timeout 180')
    printf '%s' "${OPENQUANT_PORT:-8000}" > .published-port
    ;;
  *) printf 'Unexpected docker command: %s\n' "$*" >&2; exit 1 ;;
esac
"""
    )
    docker.chmod(0o755)
    opener = tmp_path / "xdg-open"
    opener.write_text('#!/bin/sh\nprintf "%s" "$1" > .opened-url\n')
    opener.chmod(0o755)
    uname = tmp_path / "uname"
    uname.write_text("#!/bin/sh\nprintf 'Linux\\n'\n")
    uname.chmod(0o755)

    env = {
        **os.environ,
        "PATH": f"{tmp_path}:{os.environ['PATH']}",
        "OPENQUANT_LAUNCHED_FROM_GUI": "0",
        "TEST_OCCUPIED_PORT": occupied_port or "",
    }
    env.pop("OPENQUANT_PORT", None)
    if shell_port:
        env["OPENQUANT_PORT"] = shell_port
    result = subprocess.run(
        ["sh", str(scripts / "start-openquant.sh")],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert (tmp_path / ".published-port").read_text() == expected_port
    assert f"OpenQuant is ready at http://localhost:{expected_port}" in result.stdout
    assert (tmp_path / ".opened-url").read_text() == f"http://localhost:{expected_port}"

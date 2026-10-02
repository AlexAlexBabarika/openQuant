from __future__ import annotations

import os
from pathlib import Path
import subprocess


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

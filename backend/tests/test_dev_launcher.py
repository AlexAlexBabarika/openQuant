import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys

import pytest


ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize("health_status", ["200", "503"])
def test_dev_launcher_requires_health_and_stops_backend(tmp_path: Path, health_status):
    shutil.copy(ROOT / "run.sh", tmp_path / "run.sh")
    (tmp_path / "frontend").mkdir()
    (tmp_path / "backend_stub.py").write_text(
        """
import os
from pathlib import Path
import signal
import time
def stop(*_):
    Path('.backend-stopped').touch()
    raise SystemExit(0)
signal.signal(signal.SIGTERM, stop)
Path('.backend-pid').write_text(str(os.getpid()))
while True:
    time.sleep(0.01)
"""
    )
    stubs = {
        "python3": '#!/bin/sh\n[ "$1" = "-c" ] && exit 0\nexec "$TEST_PYTHON" "$TEST_ROOT/backend_stub.py"\n',
        "curl": '#!/bin/sh\nwhile [ ! -f "$TEST_ROOT/.backend-pid" ]; do /usr/bin/sleep .01; done\nprintf "%s" "$TEST_HEALTH"\n',
        "npm": '#!/bin/sh\ntouch "$TEST_ROOT/.frontend-started"\n',
        "sleep": "#!/bin/sh\nexit 0\n",
    }
    for name, source in stubs.items():
        path = tmp_path / name
        path.write_text(source)
        path.chmod(0o755)
    log = tmp_path / "launcher.log"
    with log.open("w") as output:
        process = subprocess.Popen(
            ["bash", str(tmp_path / "run.sh")],
            env={
                **os.environ,
                "PATH": f"{tmp_path}:{os.environ['PATH']}",
                "TEST_PYTHON": sys.executable,
                "TEST_ROOT": str(tmp_path),
                "TEST_HEALTH": health_status,
            },
            stdout=output,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    try:
        process.wait(timeout=5)
        assert (process.returncode == 0) == (health_status == "200"), log.read_text()
        assert (tmp_path / ".frontend-started").exists() == (health_status == "200")
        assert (tmp_path / ".backend-stopped").exists()
        with pytest.raises(ProcessLookupError):
            os.kill(int((tmp_path / ".backend-pid").read_text()), 0)
    finally:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=5)

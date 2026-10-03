#!/usr/bin/env bash
# OpenQuant: run backend + frontend in one command.
# Usage: ./run.sh [--install]
#   --install  install deps (pip + npm) before starting

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR"
cd "$ROOT"

BACKEND_PID=""
cleanup() {
  if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "Stopping backend (PID $BACKEND_PID)..."
    kill "$BACKEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# --- Backend ---
run_backend() {
  if [[ -d "$ROOT/.venv" ]]; then
    source "$ROOT/.venv/bin/activate"
  fi
  if ! command -v python3 &>/dev/null && command -v python &>/dev/null; then
    PYTHON=python
  else
    PYTHON=python3
  fi
  export PYTHONPATH="$ROOT"
  exec "$PYTHON" run_backend.py
}

# --- Frontend ---
run_frontend() {
  cd "$ROOT/frontend"
  npm run dev
}

# --- Install ---
do_install() {
  echo "Installing dependencies..."
  if [[ -d "$ROOT/.venv" ]]; then
    source "$ROOT/.venv/bin/activate"
  fi
  PYTHON="${PYTHON:-python3}"
  command -v python3 &>/dev/null || PYTHON=python
  "$PYTHON" -m pip install -q -r "$ROOT/backend/requirements.txt"
  cd "$ROOT/frontend" && npm install
  cd "$ROOT"
  echo "Done."
}

# --- Parse args ---
INSTALL=false
for arg in "$@"; do
  case "$arg" in
    --install)  INSTALL=true ;;
  esac
done

if "$INSTALL"; then
  do_install
fi

# Ensure backend can run
if [[ -d "$ROOT/.venv" ]]; then
  source "$ROOT/.venv/bin/activate"
fi
if ! python3 -c "import fastapi" 2>/dev/null && ! python -c "import fastapi" 2>/dev/null; then
  echo "Backend dependencies missing. Run: ./run.sh --install"
  exit 1
fi

# Start backend in background
echo "Starting backend on http://127.0.0.1:8000 ..."
run_backend &
BACKEND_PID=$!
cd "$ROOT"

# Wait for backend to be up
BACKEND_READY=false
for i in {1..30}; do
  if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/health 2>/dev/null | grep -q 200; then
    echo "Backend ready."
    BACKEND_READY=true
    break
  fi
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "Backend process exited. Check logs above."
    exit 1
  fi
  sleep 0.5
done

if ! "$BACKEND_READY"; then
  echo "Backend did not become healthy. Check logs above."
  exit 1
fi

echo "Starting frontend on http://localhost:5173 ..."
run_frontend

#!/bin/sh

set -u
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(dirname -- "$SCRIPT_DIR")
cd -- "$PROJECT_DIR" || exit 1

. "$SCRIPT_DIR/launcher-common.sh"
launcher_require_docker
launcher_start_docker

if [ -z "${OPENQUANT_PORT:-}" ]; then
  compose_environment=$(docker compose config --environment) || launcher_fail \
    "Docker Compose configuration could not be read. Check your .env and Compose files."
  OPENQUANT_PORT=$(printf '%s\n' "$compose_environment" | sed -n 's/^OPENQUANT_PORT=//p')
  unset compose_environment
fi

if [ -z "${OPENQUANT_PORT:-}" ]; then
  existing_address=$(docker compose port openquant 8000 2>/dev/null | head -n 1)
  existing_port=${existing_address##*:}
  case "$existing_port" in
    ''|*[!0-9]*)
      OPENQUANT_PORT=$(launcher_select_port 8000) || launcher_fail \
        "No available local port was found. Set OPENQUANT_PORT explicitly, then try again."
      ;;
    *) OPENQUANT_PORT=$existing_port ;;
  esac
fi
export OPENQUANT_PORT

printf 'Starting OpenQuant on port %s…\n' "$OPENQUANT_PORT"
if ! docker compose up -d --wait --wait-timeout 180; then
  printf '\nRecent container logs:\n' >&2
  docker compose logs --tail=100 >&2
  launcher_fail "Startup failed. Review the messages above for the cause."
fi

published_address=$(docker compose port openquant 8000 2>/dev/null | head -n 1)
published_port=${published_address##*:}
case "$published_port" in
  ''|*[!0-9]*) published_port=8000 ;;
esac
app_url="http://localhost:${published_port}"

printf '\nOpenQuant is ready at %s\n' "$app_url"
case "$(uname -s)" in
  Darwin) open "$app_url" >/dev/null 2>&1 || true ;;
  Linux)
    if command -v xdg-open >/dev/null 2>&1; then
      xdg-open "$app_url" >/dev/null 2>&1 || true
    fi
    ;;
esac

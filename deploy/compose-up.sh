#!/usr/bin/env bash
# Safe docker compose restart for /opt/agnyusha.
set -euo pipefail

cd "$(dirname "$0")"

LOCK_FILE="${COMPOSE_LOCK_FILE:-/tmp/agnyusha-compose.lock}"
SERVICES=("$@")

cleanup_recreate_orphans() {
  local names
  names="$(docker ps -a --format '{{.Names}}' 2>/dev/null || true)"
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    case "$name" in
      [a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9]_agnyusha-*)
        echo "Removing compose recreate orphan: $name"
        docker rm -f "$name" >/dev/null 2>&1 || true
        ;;
    esac
  done <<<"$names"

  docker ps -aq --filter "label=com.docker.compose.project=agnyusha" --filter "status=created" \
    | xargs -r docker rm -f >/dev/null 2>&1 || true
}

run_up() {
  cleanup_recreate_orphans
  if [ "${#SERVICES[@]}" -eq 0 ]; then
    docker compose pull
    docker compose up -d --remove-orphans
  else
    docker compose pull "${SERVICES[@]}"
    docker compose up -d --remove-orphans "${SERVICES[@]}"
  fi
  docker image prune -f >/dev/null 2>&1 || true
}

exec 9>"$LOCK_FILE"
if ! flock -w 600 9; then
  echo "Could not acquire compose lock ($LOCK_FILE) within 600s" >&2
  exit 1
fi
run_up

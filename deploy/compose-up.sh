#!/usr/bin/env bash
# Safe docker compose restart for /opt/agnyusha.
set -euo pipefail

cd "$(dirname "$0")"

LOCK_FILE="${COMPOSE_LOCK_FILE:-/tmp/agnyusha-compose.lock}"
SERVICES=("$@")
PULL_ATTEMPTS="${COMPOSE_PULL_ATTEMPTS:-5}"
PULL_RETRY_SLEEP_SEC="${COMPOSE_PULL_RETRY_SLEEP_SEC:-15}"

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

pull_with_retries() {
  local attempt=1
  local exit_code=0
  while [ "$attempt" -le "$PULL_ATTEMPTS" ]; do
    echo "docker compose pull (attempt ${attempt}/${PULL_ATTEMPTS})..."
    if [ "${#SERVICES[@]}" -eq 0 ]; then
      if docker compose pull; then
        return 0
      fi
      exit_code=$?
    else
      if docker compose pull "${SERVICES[@]}"; then
        return 0
      fi
      exit_code=$?
    fi
    if [ "$attempt" -eq "$PULL_ATTEMPTS" ]; then
      echo "docker compose pull failed after ${PULL_ATTEMPTS} attempts" >&2
      return "$exit_code"
    fi
    echo "Pull failed (exit ${exit_code}); retrying in ${PULL_RETRY_SLEEP_SEC}s..." >&2
    sleep "$PULL_RETRY_SLEEP_SEC"
    attempt=$((attempt + 1))
  done
  return 1
}

run_up() {
  cleanup_recreate_orphans
  pull_with_retries
  if [ "${#SERVICES[@]}" -eq 0 ]; then
    docker compose up -d --remove-orphans
  else
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

#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="infra/docker-compose.prod.yml"
ENV_FILE="infra/.env.prod"
SKIP_BUILD=0
TIMEOUT_SECONDS="${DEPLOY_HEALTH_TIMEOUT_SECONDS:-120}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build)
      SKIP_BUILD=1
      shift
      ;;
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    --compose-file)
      COMPOSE_FILE="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1"
      echo "Usage: $0 [--skip-build] [--env-file <path>] [--compose-file <path>]"
      exit 1
      ;;
  esac
done

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Copy infra/.env.prod.example first."
  exit 1
fi

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

wait_http_ok() {
  local url="$1"
  local timeout="$2"
  local elapsed=0

  while (( elapsed < timeout )); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done
  return 1
}

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  echo "[deploy] Building images..."
  compose build
else
  echo "[deploy] Skipping build (--skip-build)."
fi

echo "[deploy] Rolling restart: api -> worker -> web"
compose up -d --force-recreate --no-deps api

if ! wait_http_ok "http://127.0.0.1:8000/health" "$TIMEOUT_SECONDS"; then
  echo "[deploy] API health check failed after ${TIMEOUT_SECONDS}s."
  compose logs --tail=200 api || true
  exit 1
fi

compose up -d --force-recreate --no-deps worker
compose up -d --force-recreate --no-deps web

echo "Services are up. Current status:"
compose ps

echo "[deploy] Verifying app endpoints..."
for endpoint in \
  "http://127.0.0.1:8000/health" \
  "http://127.0.0.1:8000/health/db" \
  "http://127.0.0.1:8000/health/redis" \
  "http://127.0.0.1:3000"
do
  if ! wait_http_ok "$endpoint" "$TIMEOUT_SECONDS"; then
    echo "[deploy] Endpoint check failed: $endpoint"
    compose logs --tail=200 api web worker || true
    exit 1
  fi
done

echo "[deploy] Deployment completed successfully."

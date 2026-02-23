#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="infra/docker-compose.prod.yml"
ENV_FILE="infra/.env.prod"
SKIP_BUILD=0
SKIP_PUBLIC_CHECK=0
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
    --skip-public-check)
      SKIP_PUBLIC_CHECK=1
      shift
      ;;
    *)
      echo "Unknown argument: $1"
      echo "Usage: $0 [--skip-build] [--skip-public-check] [--env-file <path>] [--compose-file <path>]"
      exit 1
      ;;
  esac
done

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Copy infra/.env.prod.example first."
  exit 1
fi

load_env_file() {
  local first=1
  while IFS= read -r raw_line || [[ -n "$raw_line" ]]; do
    local line="${raw_line%$'\r'}"
    if [[ $first -eq 1 ]]; then
      line="${line#$'\ufeff'}"
      first=0
    fi
    [[ -z "$line" ]] && continue
    [[ "${line:0:1}" == "#" ]] && continue
    [[ "$line" != *"="* ]] && continue
    local key="${line%%=*}"
    local value="${line#*=}"
    key="$(echo "$key" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    value="$(echo "$value" | sed 's/^[[:space:]]*//')"
    export "$key=$value"
  done < "$ENV_FILE"
}

load_env_file

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

APP_DOMAIN="${APP_DOMAIN:-}"
APP_DOMAIN_PRIMARY="$(echo "${APP_DOMAIN}" | cut -d',' -f1 | xargs)"
API_PORT="${API_PORT:-8000}"
WEB_PORT="${WEB_PORT:-3000}"
GRADER_IMAGE="${GRADER_IMAGE:-qa-lab-grader-python}"

if [[ -z "$APP_DOMAIN_PRIMARY" ]] || [[ "$APP_DOMAIN_PRIMARY" == "localhost" ]] || [[ "$APP_DOMAIN_PRIMARY" == "127.0.0.1" ]]; then
  echo "[deploy][warn] APP_DOMAIN is not set to a public host. External users may not be able to access this service."
fi

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  echo "[deploy] Pulling base images..."
  compose pull postgres redis caddy || true

  echo "[deploy] Building images..."
  compose build --pull api worker web

  echo "[deploy] Building grader image: ${GRADER_IMAGE}"
  docker build -t "${GRADER_IMAGE}" -f grader-images/python/Dockerfile .
else
  echo "[deploy] Skipping build (--skip-build)."
fi

echo "[deploy] Rolling restart: api -> worker -> web -> caddy"
compose up -d --force-recreate --no-deps api

if ! wait_http_ok "http://127.0.0.1:${API_PORT}/health" "$TIMEOUT_SECONDS"; then
  echo "[deploy] API health check failed after ${TIMEOUT_SECONDS}s."
  compose logs --tail=200 api || true
  exit 1
fi

compose up -d --force-recreate --no-deps worker
compose up -d --force-recreate --no-deps web
compose up -d --force-recreate --no-deps caddy

echo "Services are up. Current status:"
compose ps

echo "[deploy] Verifying app endpoints..."
for endpoint in \
  "http://127.0.0.1:${API_PORT}/health" \
  "http://127.0.0.1:${API_PORT}/health/db" \
  "http://127.0.0.1:${API_PORT}/health/redis" \
  "http://127.0.0.1:${WEB_PORT}" \
  "http://127.0.0.1"
do
  if ! wait_http_ok "$endpoint" "$TIMEOUT_SECONDS"; then
    echo "[deploy] Endpoint check failed: $endpoint"
    compose logs --tail=200 api web worker caddy || true
    exit 1
  fi
done

if [[ "$SKIP_PUBLIC_CHECK" -eq 0 ]] && [[ -n "$APP_DOMAIN_PRIMARY" ]] && [[ "$APP_DOMAIN_PRIMARY" != "localhost" ]] && [[ "$APP_DOMAIN_PRIMARY" != "127.0.0.1" ]]; then
  echo "[deploy] Verifying public URL: https://${APP_DOMAIN_PRIMARY}"
  if ! wait_http_ok "https://${APP_DOMAIN_PRIMARY}" "$TIMEOUT_SECONDS"; then
    echo "[deploy] Public endpoint check failed: https://${APP_DOMAIN_PRIMARY}"
    compose logs --tail=200 caddy web || true
    exit 1
  fi
else
  echo "[deploy] Skipping public URL check."
fi

echo "[deploy] Deployment completed successfully."

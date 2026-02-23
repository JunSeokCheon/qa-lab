#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="infra/docker-compose.prod.yml"
ENV_FILE="infra/.env.prod"
BACKUP_ROOT="backups"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_DIR="$BACKUP_ROOT/$TIMESTAMP"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    --compose-file)
      COMPOSE_FILE="$2"
      shift 2
      ;;
    --output-dir)
      BACKUP_ROOT="$2"
      BACKUP_DIR="$BACKUP_ROOT/$TIMESTAMP"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1"
      echo "Usage: $0 [--env-file <path>] [--compose-file <path>] [--output-dir <dir>]"
      exit 1
      ;;
  esac
done

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE"
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

POSTGRES_USER_VALUE="${POSTGRES_USER:-}"
POSTGRES_DB_VALUE="${POSTGRES_DB:-}"
if [[ -z "$POSTGRES_USER_VALUE" || -z "$POSTGRES_DB_VALUE" ]]; then
  echo "POSTGRES_USER and POSTGRES_DB must be defined in $ENV_FILE"
  exit 1
fi

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

mkdir -p "$BACKUP_DIR"

echo "[backup] Saving Postgres dump..."
compose exec -T postgres pg_dump -U "${POSTGRES_USER_VALUE}" -d "${POSTGRES_DB_VALUE}" > "$BACKUP_DIR/postgres.sql"

echo "[backup] Saving Redis snapshot..."
compose exec -T redis redis-cli SAVE >/dev/null
REDIS_CID="$(compose ps -q redis)"
docker cp "${REDIS_CID}:/data/dump.rdb" "$BACKUP_DIR/redis_dump.rdb"

echo "[backup] Saving bundles directory..."
API_CID="$(compose ps -q api)"
docker cp "${API_CID}:/app/var/bundles" "$BACKUP_DIR/bundles"

echo "[backup] Saving metadata..."
{
  echo "timestamp=${TIMESTAMP}"
  echo "postgres_user=${POSTGRES_USER_VALUE}"
  echo "postgres_db=${POSTGRES_DB_VALUE}"
  echo "alembic_current=$(compose exec -T api alembic current | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g')"
  echo "git_commit=$(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
} > "$BACKUP_DIR/manifest.txt"

echo "[backup] Completed: $BACKUP_DIR"

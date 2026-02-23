#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="infra/docker-compose.prod.yml"
ENV_FILE="infra/.env.prod"
INPUT_DIR=""
RESTORE_REDIS=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --input-dir)
      INPUT_DIR="$2"
      shift 2
      ;;
    --restore-redis)
      RESTORE_REDIS=1
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
      echo "Usage: $0 --input-dir <backup_dir> [--restore-redis] [--env-file <path>] [--compose-file <path>]"
      exit 1
      ;;
  esac
done

if [[ -z "$INPUT_DIR" ]]; then
  echo "--input-dir is required"
  exit 1
fi

if [[ ! -f "$INPUT_DIR/postgres.sql" ]]; then
  echo "Missing $INPUT_DIR/postgres.sql"
  exit 1
fi

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

echo "[restore] Restoring Postgres..."
compose exec -T postgres psql -U "${POSTGRES_USER_VALUE}" -d "${POSTGRES_DB_VALUE}" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
compose exec -T postgres psql -U "${POSTGRES_USER_VALUE}" -d "${POSTGRES_DB_VALUE}" < "$INPUT_DIR/postgres.sql"

if [[ -d "$INPUT_DIR/bundles" ]]; then
  echo "[restore] Restoring bundles..."
  API_CID="$(compose ps -q api)"
  docker cp "$INPUT_DIR/bundles/." "${API_CID}:/app/var/bundles"
else
  echo "[restore] bundles directory not found in backup; skipping bundles restore."
fi

if [[ "$RESTORE_REDIS" -eq 1 ]]; then
  if [[ ! -f "$INPUT_DIR/redis_dump.rdb" ]]; then
    echo "[restore] redis_dump.rdb not found, cannot restore redis."
    exit 1
  fi
  echo "[restore] Restoring Redis snapshot..."
  REDIS_CID="$(compose ps -q redis)"
  docker cp "$INPUT_DIR/redis_dump.rdb" "${REDIS_CID}:/data/dump.rdb"
  compose restart redis
fi

echo "[restore] Running migrations to ensure schema is up to date..."
compose exec -T api alembic upgrade head

echo "[restore] Completed."

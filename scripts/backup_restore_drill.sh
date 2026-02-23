#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="infra/docker-compose.prod.yml"
ENV_FILE="infra/.env.prod"
BACKUP_ROOT="backups"
REPORT_ROOT="backups/drill-reports"

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
      REPORT_ROOT="$BACKUP_ROOT/drill-reports"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1"
      echo "Usage: $0 [--env-file <path>] [--compose-file <path>] [--output-dir <dir>]"
      exit 1
      ;;
  esac
done

mkdir -p "$BACKUP_ROOT"
mkdir -p "$REPORT_ROOT"

echo "[drill] creating fresh backup..."
bash scripts/backup_prod.sh --env-file "$ENV_FILE" --compose-file "$COMPOSE_FILE" --output-dir "$BACKUP_ROOT"

LATEST_BACKUP_BASENAME="$(
  find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -printf "%f\n" \
    | grep -E '^[0-9]{8}_[0-9]{6}$' \
    | sort -r \
    | head -n 1
)"
LATEST_BACKUP="${BACKUP_ROOT}/${LATEST_BACKUP_BASENAME}"
if [[ -z "${LATEST_BACKUP_BASENAME}" ]]; then
  echo "[drill] failed to find latest backup directory"
  exit 1
fi

if [[ ! -f "${LATEST_BACKUP}/postgres.sql" ]]; then
  echo "[drill] postgres.sql is missing in ${LATEST_BACKUP}"
  exit 1
fi
if [[ ! -f "${LATEST_BACKUP}/manifest.txt" ]]; then
  echo "[drill] manifest.txt is missing in ${LATEST_BACKUP}"
  exit 1
fi

SOURCE_ROLE="$(awk -F= '/^postgres_user=/{print $2; exit}' "${LATEST_BACKUP}/manifest.txt" | tr -d '\r')"

TMP_CONTAINER="qa-lab-restore-drill-$(date +%s)"
TMP_PASSWORD="drill-pass-$(date +%s)"
TMP_DB="restore_drill"
REPORT_PATH="${REPORT_ROOT}/restore_drill_$(date +%Y%m%d_%H%M%S).txt"

cleanup() {
  docker rm -f "$TMP_CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[drill] starting temporary postgres container: ${TMP_CONTAINER}"
docker run -d --name "$TMP_CONTAINER" \
  -e POSTGRES_PASSWORD="$TMP_PASSWORD" \
  -e POSTGRES_DB="$TMP_DB" \
  postgres:16-alpine >/dev/null

for i in {1..60}; do
  if docker exec "$TMP_CONTAINER" pg_isready -U postgres -d "$TMP_DB" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

docker exec "$TMP_CONTAINER" psql -U postgres -d postgres -c "CREATE DATABASE ${TMP_DB};" >/dev/null 2>&1 || true

if [[ -n "$SOURCE_ROLE" ]]; then
  docker exec "$TMP_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
    "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${SOURCE_ROLE}') THEN CREATE ROLE \"${SOURCE_ROLE}\" LOGIN; END IF; END \$\$;" \
    >/dev/null
fi

echo "[drill] restoring postgres.sql into temporary database..."
cat "${LATEST_BACKUP}/postgres.sql" | docker exec -i "$TMP_CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d "$TMP_DB" >/dev/null

TABLE_COUNT="$(
  docker exec "$TMP_CONTAINER" psql -U postgres -d "$TMP_DB" -tAc \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';"
)"
USERS_EXISTS="$(
  docker exec "$TMP_CONTAINER" psql -U postgres -d "$TMP_DB" -tAc \
    "SELECT CASE WHEN to_regclass('public.users') IS NULL THEN '0' ELSE '1' END;"
)"
EXAMS_EXISTS="$(
  docker exec "$TMP_CONTAINER" psql -U postgres -d "$TMP_DB" -tAc \
    "SELECT CASE WHEN to_regclass('public.exams') IS NULL THEN '0' ELSE '1' END;"
)"

if [[ "${USERS_EXISTS}" != "1" || "${EXAMS_EXISTS}" != "1" ]]; then
  echo "[drill] critical tables are missing after restore"
  exit 1
fi

{
  echo "timestamp=$(date -Iseconds)"
  echo "backup_dir=${LATEST_BACKUP}"
  echo "table_count=${TABLE_COUNT}"
  echo "users_table=${USERS_EXISTS}"
  echo "exams_table=${EXAMS_EXISTS}"
  echo "result=PASS"
} > "$REPORT_PATH"

echo "[drill] PASS - report written to ${REPORT_PATH}"

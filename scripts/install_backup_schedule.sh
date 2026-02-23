#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(pwd)"
ENV_FILE="infra/.env.prod"
COMPOSE_FILE="infra/docker-compose.prod.yml"
BACKUP_ROOT="backups"
KEEP_LAST=14

DAILY_CRON="30 2 * * *"
WEEKLY_DRILL_CRON="30 3 * * 0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-dir)
      APP_DIR="$2"
      shift 2
      ;;
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    --compose-file)
      COMPOSE_FILE="$2"
      shift 2
      ;;
    --backup-root)
      BACKUP_ROOT="$2"
      shift 2
      ;;
    --keep-last)
      KEEP_LAST="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1"
      echo "Usage: $0 [--app-dir <path>] [--env-file <path>] [--compose-file <path>] [--backup-root <dir>] [--keep-last <count>]"
      exit 1
      ;;
  esac
done

if ! command -v crontab >/dev/null 2>&1; then
  echo "crontab command not found. Install cron first."
  exit 1
fi

if ! [[ "$KEEP_LAST" =~ ^[0-9]+$ ]]; then
  echo "--keep-last must be an integer"
  exit 1
fi

DAILY_CMD="cd ${APP_DIR} && bash scripts/backup_prod.sh --env-file ${ENV_FILE} --compose-file ${COMPOSE_FILE} --output-dir ${BACKUP_ROOT} && bash scripts/prune_backups.sh --backup-root ${BACKUP_ROOT} --keep-last ${KEEP_LAST}"
DRILL_CMD="cd ${APP_DIR} && bash scripts/backup_restore_drill.sh --env-file ${ENV_FILE} --compose-file ${COMPOSE_FILE} --output-dir ${BACKUP_ROOT}"

EXISTING="$(crontab -l 2>/dev/null || true)"
FILTERED="$(echo "$EXISTING" | sed '/# qa-lab backup schedule/d' | sed '/scripts\/backup_prod.sh/d' | sed '/scripts\/backup_restore_drill.sh/d' | sed '/scripts\/prune_backups.sh/d')"

{
  echo "$FILTERED"
  echo "# qa-lab backup schedule"
  echo "${DAILY_CRON} ${DAILY_CMD}"
  echo "${WEEKLY_DRILL_CRON} ${DRILL_CMD}"
} | crontab -

echo "[schedule] installed"
echo "[schedule] daily backup: ${DAILY_CRON}"
echo "[schedule] weekly restore drill: ${WEEKLY_DRILL_CRON}"


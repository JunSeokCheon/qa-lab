#!/usr/bin/env bash
set -euo pipefail

BACKUP_ROOT="backups"
KEEP_LAST=14

while [[ $# -gt 0 ]]; do
  case "$1" in
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
      echo "Usage: $0 [--backup-root <dir>] [--keep-last <count>]"
      exit 1
      ;;
  esac
done

if [[ ! -d "$BACKUP_ROOT" ]]; then
  echo "[prune] backup root does not exist: $BACKUP_ROOT"
  exit 0
fi

if ! [[ "$KEEP_LAST" =~ ^[0-9]+$ ]]; then
  echo "[prune] keep-last must be an integer"
  exit 1
fi

mapfile -t BACKUP_DIRS < <(
  find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -printf "%f\t%p\n" \
    | grep -E '^[0-9]{8}_[0-9]{6}[[:space:]]' \
    | sort -r \
    | awk -F '\t' '{print $2}'
)

TOTAL="${#BACKUP_DIRS[@]}"
echo "[prune] found ${TOTAL} timestamped backup directories"

if (( TOTAL <= KEEP_LAST )); then
  echo "[prune] nothing to prune (keep-last=${KEEP_LAST})"
  exit 0
fi

for (( i=KEEP_LAST; i<TOTAL; i++ )); do
  dir="${BACKUP_DIRS[$i]}"
  echo "[prune] removing $dir"
  rm -rf -- "$dir"
done

echo "[prune] completed"

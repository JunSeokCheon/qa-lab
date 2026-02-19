#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:8000}"
WEB_BASE_URL="${WEB_BASE_URL:-http://127.0.0.1:3000}"

check_url() {
  local url="$1"
  local name="$2"
  if curl -fsS "$url" >/dev/null; then
    echo "[ok] $name -> $url"
  else
    echo "[fail] $name -> $url"
    return 1
  fi
}

echo "[ops] Running health checks..."
check_url "${WEB_BASE_URL}" "web"
check_url "${API_BASE_URL}/health" "api"
check_url "${API_BASE_URL}/health/db" "db"
check_url "${API_BASE_URL}/health/redis" "redis"

echo "[ops] Done."

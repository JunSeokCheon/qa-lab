#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="infra/docker-compose.prod.yml"
ENV_FILE="infra/.env.prod"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Copy infra/.env.prod.example first."
  exit 1
fi

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d

echo "Services are up. Current status:"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps

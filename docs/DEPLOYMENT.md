# Deployment Guide (Production)

## Prerequisites
- Linux server with Docker + Docker Compose
- Domain/TLS termination (Cloudflare + Nginx/Caddy recommended)
- Repo cloned on the server

## 1) Prepare environment
```bash
cp infra/.env.prod.example infra/.env.prod
```

Update required values in `infra/.env.prod`:
- `POSTGRES_PASSWORD`
- `JWT_SECRET_KEY`
- `ALLOWED_ORIGINS`

## 2) Build and deploy
```bash
bash scripts/deploy_prod.sh
```

Useful options:
```bash
bash scripts/deploy_prod.sh --skip-build
bash scripts/deploy_prod.sh --env-file infra/.env.prod --compose-file infra/docker-compose.prod.yml
```

## 3) Verify
```bash
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml ps
bash scripts/ops_healthcheck.sh
```

Manual checks:
- Web: `http://<server>:3000`
- API docs: `http://<server>:8000/docs`
- API ops summary (admin token): `GET /admin/ops/summary`

## 4) Update deployment
```bash
git pull
bash scripts/deploy_prod.sh
```

## 5) Backup
```bash
bash scripts/backup_prod.sh
```

Artifacts are written to `backups/<timestamp>/`:
- `postgres.sql`
- `redis_dump.rdb`
- `bundles/`
- `manifest.txt`

## 6) Restore
```bash
bash scripts/restore_prod.sh --input-dir backups/<timestamp>
```

Optional Redis restore:
```bash
bash scripts/restore_prod.sh --input-dir backups/<timestamp> --restore-redis
```

## 7) Rollback (practical)
1. Checkout previous stable commit/tag.
2. Redeploy.

```bash
git checkout <stable-tag-or-commit>
bash scripts/deploy_prod.sh
```

If API fails after deploy:
```bash
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml logs --tail=200 api
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml logs --tail=200 worker
```

# Operations Runbook

## Daily checks
```bash
bash scripts/ops_healthcheck.sh
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml ps
```

## Weekly tasks
- Run backup and verify backup folder integrity.
- Verify latest backup can be listed and opened.
- Review worker/API logs for repeated failures.

## Backup procedure
```bash
bash scripts/backup_prod.sh
```

Expected output folder:
- `backups/<timestamp>/postgres.sql`
- `backups/<timestamp>/redis_dump.rdb`
- `backups/<timestamp>/bundles/`
- `backups/<timestamp>/manifest.txt`

## Restore procedure
```bash
bash scripts/restore_prod.sh --input-dir backups/<timestamp>
```

With Redis:
```bash
bash scripts/restore_prod.sh --input-dir backups/<timestamp> --restore-redis
```

## SLO baseline (MVP)
- API availability: >= 99.5%
- Grading success ratio: >= 99.0%
- P95 grading latency: <= 60s
- Queue depth steady-state: <= 100

## Alert thresholds (manual baseline)
- `GET /health`, `/health/db`, `/health/redis` fail for 5 minutes
- Submission `RUNNING` count keeps increasing for 10 minutes
- Queue depth > 200 for 10 minutes
- Worker process restart loop detected

## Incident response quick steps
1. Confirm service health (`scripts/ops_healthcheck.sh`).
2. Check compose status and recent logs.
3. If grading stuck: run admin watchdog endpoint and inspect queue depth.
4. If DB issue: validate postgres health and connections.
5. If release issue: rollback to previous stable commit and redeploy.

## Useful commands
```bash
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml logs -f api
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml logs -f worker
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml restart api worker
```

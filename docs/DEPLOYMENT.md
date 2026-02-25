# Deployment Guide (Production)

운영 서버에 배포할 때 실제로 쓰는 순서입니다.

## 1) 준비
- Linux 서버 + Docker + Docker Compose
- 도메인 및 TLS 설정(Caddy/Nginx)
- 서버에 저장소 clone 완료

환경파일 생성:
```bash
cp infra/.env.prod.example infra/.env.prod
```

최소 확인 값:
- `POSTGRES_PASSWORD`
- `JWT_SECRET_KEY`
- `ALLOWED_ORIGINS`

## 2) 배포
```bash
bash scripts/deploy_prod.sh --env-file infra/.env.prod
```

자주 쓰는 옵션:
```bash
bash scripts/deploy_prod.sh --skip-build
bash scripts/deploy_prod.sh --env-file infra/.env.prod --compose-file infra/docker-compose.prod.yml
```

## 3) 배포 확인
```bash
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml ps
bash scripts/ops_healthcheck.sh
```

## 4) 업데이트 배포
```bash
git pull --ff-only origin main
bash scripts/deploy_prod.sh --env-file infra/.env.prod
```

## 5) 백업
```bash
bash scripts/backup_prod.sh
```

백업 산출물:
- `backups/<timestamp>/postgres.sql`
- `backups/<timestamp>/redis_dump.rdb`
- `backups/<timestamp>/bundles/`
- `backups/<timestamp>/manifest.txt`

## 6) 복구
```bash
bash scripts/restore_prod.sh --input-dir backups/<timestamp>
```

Redis까지 복구할 때:
```bash
bash scripts/restore_prod.sh --input-dir backups/<timestamp> --restore-redis
```

## 7) 롤백
1. 직전 안정 커밋/태그 체크아웃
2. 배포 스크립트 재실행

```bash
git checkout <stable-tag-or-commit>
bash scripts/deploy_prod.sh --env-file infra/.env.prod
```

문제 원인 확인 로그:
```bash
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml logs --tail=200 api
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml logs --tail=200 worker
```

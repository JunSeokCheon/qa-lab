# Operations Runbook

운영 중 장애 대응/점검 시 기본으로 보는 문서입니다.

## 일일 점검
```bash
bash scripts/ops_healthcheck.sh
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml ps
```

## 주간 점검
- 백업 실행 및 백업 폴더 무결성 확인
- 최신 백업을 실제로 열어볼 수 있는지 확인
- worker/API 로그에서 반복 실패 패턴 점검

## 백업
```bash
bash scripts/backup_prod.sh
```

예상 산출물:
- `backups/<timestamp>/postgres.sql`
- `backups/<timestamp>/redis_dump.rdb`
- `backups/<timestamp>/bundles/`
- `backups/<timestamp>/manifest.txt`

## 복구
```bash
bash scripts/restore_prod.sh --input-dir backups/<timestamp>
```

Redis 포함 복구:
```bash
bash scripts/restore_prod.sh --input-dir backups/<timestamp> --restore-redis
```

## SLO 기준 (MVP)
- API 가용성: `>= 99.5%`
- 채점 성공률: `>= 99.0%`
- P95 채점 지연: `<= 60s`
- 평시 큐 길이: `<= 100`

## 수동 알림 기준
- `/health`, `/health/db`, `/health/redis` 5분 이상 실패
- `RUNNING` 제출 건이 10분 이상 계속 증가
- 큐 길이 200 초과가 10분 이상 지속
- worker 재시작 루프 발생

## 장애 대응 순서
1. 헬스체크 실행
2. compose 상태 + 최근 로그 확인
3. 채점 정체면 큐 깊이와 watchdog 경로 점검
4. DB 이슈면 postgres 상태/연결 수 확인
5. 배포 이슈면 이전 안정 커밋으로 롤백

## 자주 쓰는 명령
```bash
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml logs -f api
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml logs -f worker
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml restart api worker
```

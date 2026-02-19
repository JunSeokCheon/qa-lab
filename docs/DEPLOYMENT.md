# Deployment Guide (Production)

작성일: 2026-02-19

## 1) 사전 준비
- Docker / Docker Compose가 설치된 Linux 서버
- 도메인 및 TLS(권장: Cloudflare, Nginx/Caddy 앞단)
- Git 저장소 clone 완료

## 2) 환경변수 준비
1. `infra/.env.prod.example`을 복사해 `infra/.env.prod` 생성
2. 최소 필수값 변경:
- `POSTGRES_PASSWORD`
- `JWT_SECRET_KEY`
- `ALLOWED_ORIGINS` (실서비스 도메인)

## 3) 배포 실행
루트에서 실행:

```bash
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml build
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml up -d
```

## 4) 상태 확인
```bash
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml ps
curl -fsS http://127.0.0.1:8000/health
curl -fsS http://127.0.0.1:8000/health/db
curl -fsS http://127.0.0.1:8000/health/redis
```

## 5) 운영 확인 포인트
- 웹: `http://<server>:3000`
- API: `http://<server>:8000/docs`
- 관리자 운영 요약: `/admin/ops/summary` (admin 토큰 필요)
- 모든 API 응답 헤더에서 `X-Request-ID` 확인

## 6) 업데이트 배포
```bash
git pull
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml build
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml up -d
```

## 7) 롤백(간단)
1. 이전 안정 커밋으로 checkout
2. 다시 build/up

```bash
git checkout <stable-commit>
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml build
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml up -d
```

# QA Lab Monorepo

Next.js(App Router) + FastAPI + Docker Compose 기반 QA 서비스입니다.  
현재 구조는 **시험지(Exam) 전용**이며, 레거시 `problems/submissions/run-public` 흐름은 제거되었습니다.

## 구성
- `apps/web`: Next.js 프론트엔드
- `apps/api`: FastAPI 백엔드
- `docker-compose.yml`: 통합 실행

## 빠른 시작 (로컬)

### 1) API 실행
```bash
cd apps/api
python -m venv .venv
. .venv/Scripts/Activate.ps1
python -m pip install -r requirements.txt
alembic upgrade head
fastapi dev main.py
```

### 2) Web 실행
```bash
cd apps/web
pnpm install
pnpm dev
```

### 3) 접속
- Web: `http://localhost:3000`
- API Docs: `http://127.0.0.1:8000/docs`

## Docker 실행
```bash
docker compose up -d --build
docker compose ps
```

기본 포트:
- Web: `http://localhost:3000`
- API: `http://localhost:8000`

## 기본 계정
- 관리자: `admin` / `admin1234`
- 사용자: `user` / `user1234`

## 주요 사용자 화면
- 시험 목록: `/problems`
- 시험 응시: `/problems/{examId}`
- 내 제출 내역: `/submissions`
- 관리자 시험 관리: `/admin/problems`

## 현재 API (시험지 전용)

### 인증
- `POST /auth/login`
- `POST /auth/logout`
- `POST /auth/register`
- `POST /auth/password/forgot`
- `POST /auth/password/reset`
- `GET /me`

### 시험지
- 관리자
  - `POST /admin/exams`
  - `GET /admin/exams`
  - `GET /admin/exams/{exam_id}/submissions`
- 사용자
  - `GET /exams`
  - `GET /exams/{exam_id}`
  - `POST /exams/{exam_id}/submit`
  - `GET /me/exam-submissions`

### 기타 운영
- `GET /health`
- `GET /health/db`
- `GET /health/redis`
- `GET /admin/health`
- `GET /admin/ops/summary`
- `POST /admin/watchdog/requeue-stale`
- `GET /admin/audit-logs`

## 테스트

### API 단위 테스트
```bash
apps/api/.venv/Scripts/pytest.exe -q apps/api/tests/unit
```

### API E2E 테스트
```bash
apps/api/.venv/Scripts/pytest.exe -q apps/api/tests/e2e/test_full_stack_e2e.py
```

### Web 빌드
```bash
pnpm --filter web build
```

### Web E2E (Playwright)
```bash
cd apps/web
pnpm test:e2e
```

## 참고
- 시험지 카테고리는 `problem-folders`를 사용합니다.
- 프론트는 `/api/*` Next Route Handler를 통해 FastAPI와 통신합니다.

## Runtime Env Notes
- Web server-side API calls use `FASTAPI_INTERNAL_URL` first, then `FASTAPI_BASE_URL`.
- Local run (PowerShell):
```powershell
$env:FASTAPI_INTERNAL_URL="http://127.0.0.1:8000"
cd apps/web
pnpm dev
```

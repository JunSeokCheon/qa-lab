# QA Lab Monorepo

Next.js(App Router) + FastAPI + Docker Compose 기반 QA 서비스입니다.
현재는 **시험지(Exam) 중심 구조**로 운영됩니다.

## 구성
- `apps/web`: Next.js 프론트엔드
- `apps/api`: FastAPI 백엔드
- `infra/docker-compose.prod.yml`: 배포용 Compose

## 로컬 실행

### 1) API
```bash
cd apps/api
python -m venv .venv
. .venv/Scripts/Activate.ps1
python -m pip install -r requirements.txt
alembic upgrade head
fastapi dev main.py
```

### 2) Web
```bash
cd apps/web
pnpm install
pnpm dev
```

### 3) 접속
- Web: `http://localhost:3000`
- API Docs: `http://127.0.0.1:8000/docs`

## Docker 배포 실행

`infra/.env.prod`를 먼저 설정한 뒤 실행하세요.

```bash
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml up -d --build
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml ps
```

기본 포트:
- Web: `http://localhost:3000`
- API: `http://localhost:8000`

## 기본 계정
- 관리자: `admin` / `admin1234`
- 사용자: `user` / `user1234`

## 주요 화면
- 시험 목록: `/problems`
- 시험 응시: `/problems/{examId}`
- 내 제출 목록: `/submissions`
- 관리자 시험 관리: `/admin/problems`

## API 요약

### 인증
- `POST /auth/login`
- `POST /auth/logout`
- `POST /auth/register`
- `POST /auth/password/forgot`
- `POST /auth/password/reset`
- `GET /me`

### 시험
- 관리자
  - `POST /admin/exams`
  - `GET /admin/exams`
  - `GET /admin/exams/{exam_id}/submissions`
  - `GET /admin/exams/{exam_id}/resources`
  - `POST /admin/exams/{exam_id}/resources`
- 사용자
  - `GET /exams`
  - `GET /exams/{exam_id}`
  - `POST /exams/{exam_id}/submit`
  - `GET /me/exam-submissions`
  - `GET /exams/{exam_id}/resources`
  - `GET /exams/{exam_id}/resources/{resource_id}/download`

### 운영
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

## 회원가입/로그인 입력값
- 회원가입: 아이디, 이름, 트랙, 비밀번호, 비밀번호 확인
- 로그인: 아이디, 비밀번호
- 트랙 옵션: `데이터 분석 11기`, `QAQC 4기`

## 마이그레이션 반영
기존 DB를 사용하는 경우 최신 스키마 반영:

```bash
cd apps/api
alembic upgrade head
```

## 시험 자료 업로드/통계
- 관리자(`/admin/problems`)에서 시험별 자료 파일 업로드 가능
- 학생(`/problems/{examId}`)에서 업로드된 자료 다운로드 가능
- 관리자 제출 상세에서 객관식 선택지별 응답자 수/학생 목록 확인 가능

## 환경 변수 (추가)
- `EXAM_RESOURCE_ROOT` (기본값: `./var/bundles/exam-resources`)
- `EXAM_RESOURCE_MAX_SIZE_BYTES` (기본값: `20971520`)

## Coding Auto Grading Resource Spec (Exam)
When an exam has `coding` questions, submit now enqueues a grading job to worker queue `grading`.

### Resource bundle rules
- Upload one or more resource files on admin exam page.
- `.zip` resources are extracted into grader bundle root.
- Non-zip resources are copied under `resources/`.

### Test target resolution
- First tries `tests/question_{order}` for each coding question (order = 1,2,3...)
- Falls back to `tests/` if question-specific path does not exist.

### Student code runtime path
- Student answer is written to `solution.py`.
- Test code can reference shared data files from `resources/`.

### Required DB migration
```bash
cd apps/api
alembic upgrade head
```

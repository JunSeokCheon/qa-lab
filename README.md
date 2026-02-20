# QA Lab Monorepo

Next.js(App Router) + FastAPI + Docker Compose 기반의 모노레포입니다.

## MVP 범위 고정
- MVP 고정 문서: `docs/MVP_SCOPE.md`
- 성취도 모델 고정 문서: `docs/MASTERY_MODEL.md`
- 디자인 시스템 가이드: `docs/DESIGN_SYSTEM.md`
- 현재 단계에서는 기능 추가보다 안정화/완성도를 우선합니다.
- 신규 요구는 MVP에 즉시 포함하지 않고 `Post-MVP Backlog`로 분리합니다.

## 어떻게 실행하는지

### Web (Next.js)
```bash
cd apps/web
pnpm install
pnpm dev
```
접속 주소: http://localhost:3000

문제 풀이 UX:
- 에디터 자동저장: 문제/버전별로 브라우저 로컬 저장
- 단축키:
  - `Ctrl/Cmd + Enter`: 제출
- 문제 상세 페이지에서 statement를 확인하고 바로 Workbench에서 실행/제출 가능

### API (FastAPI)
```bash
cd apps/api
python -m venv .venv
. .venv/Scripts/Activate.ps1
python -m pip install -r requirements.txt
fastapi dev main.py
```
접속 주소:
- API: http://127.0.0.1:8000/health
- DB Health: http://127.0.0.1:8000/health/db
- Redis Health: http://127.0.0.1:8000/health/redis
- Me (Bearer 필요): http://127.0.0.1:8000/me
- Docs: http://127.0.0.1:8000/docs

운영/보안 필수 환경변수:
- `APP_ENV` (`production`에서는 `JWT_SECRET_KEY` 기본값 사용 금지)
- `ALLOWED_ORIGINS` (CORS 허용 Origin 목록)
- `LOGIN_RATE_LIMIT_ATTEMPTS`, `LOGIN_RATE_LIMIT_WINDOW_SECONDS` (로그인 시도 제한)
- `PASSWORD_RESET_TOKEN_EXPIRE_MINUTES` (비밀번호 재설정 토큰 만료 시간)
- `BUNDLE_MAX_ENTRIES`, `BUNDLE_MAX_UNCOMPRESSED_BYTES` (zip bomb 방어)
- `MAX_LOG_BYTES` (grader stdout/stderr/log 절단 길이)
- `SUBMISSION_QUEUE_MAX_DEPTH` (큐 백프레셔 임계치)
- `SUBMISSION_MAX_ACTIVE_PER_USER` (사용자별 동시 채점 제한)
- `GRADING_RETRY_MAX_ATTEMPTS`, `GRADING_RETRY_BACKOFF_SECONDS` (일시 장애 재시도 정책)
- `GRADING_STUCK_TIMEOUT_SECONDS` (RUNNING 장기 체류 watchdog 기준)
- 로그인 시도 제한은 Redis 키(`auth:login-attempts:*`) 기반으로 동작합니다.

관측성(Observability):
- 모든 API 응답 헤더에 `X-Request-ID`가 포함됩니다.
- API는 JSON 구조 로그(`request.completed`)를 출력합니다.
- 운영 요약(관리자): `GET /admin/ops/summary`
  - `queue_depth`, `pending_grade_runs`, `submission_status_counts`, `health(db/redis)` 확인 가능

채점 신뢰성 운영 명령:
- RUNNING 장기 체류 정리 + 재큐잉(관리자):
```bash
curl -X POST "http://127.0.0.1:8000/admin/watchdog/requeue-stale?stale_seconds=300" ^
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```
- 제출 API 백프레셔:
  - 큐가 `SUBMISSION_QUEUE_MAX_DEPTH` 이상이면 `429`
  - 사용자의 `QUEUED/RUNNING`이 `SUBMISSION_MAX_ACTIVE_PER_USER` 이상이면 `429`

관리자 감사 로그:
- 조회 API: `GET /admin/audit-logs?limit=50`
- 기록 대상: 문제/버전/스킬 생성 및 수정, 번들 업로드, 재채점, watchdog 재큐잉

번들 업로드 보안 정책:
- 허용 경로: `statement.md`, `rubric.yaml`, `starter/*`, `tests/public/*`, `tests/hidden/*`
- 차단: 경로순회(`..`), 절대경로, NUL 문자, 의심 경로(`.git`, `.env`, `id_rsa`), 실행 파일 확장자(`.exe`, `.dll`, `.bat`, `.ps1` 등)

### 웹/백 동시 실행 방법
터미널 1 (API):
```bash
cd apps/api
. .venv/Scripts/Activate.ps1
fastapi dev main.py
```

터미널 2 (Web):
```bash
cd apps/web
pnpm dev
```

브라우저에서 `http://localhost:3000` 접속 후, 로그인 상태가 보이면 정상입니다.

### 로그인/JWT/RBAC 확인
1) 마이그레이션 적용(최초 1회):
```bash
cd apps/api
copy .env.example .env
. .venv/Scripts/Activate.ps1
alembic upgrade head
```

2) API 실행:
```bash
fastapi dev main.py
```

3) Web 실행(새 터미널):
```bash
cd apps/web
pnpm dev
```

4) 브라우저에서 로그인:
- URL: `http://localhost:3000/login`
- 회원가입: `http://localhost:3000/signup`
- 비밀번호 재설정: `http://localhost:3000/forgot-password` -> `http://localhost:3000/reset-password`
- 일반 사용자: `user` / `user1234`
- 관리자: `admin` / `admin1234`

5) 동작 확인:
- 로그인 후 새로고침해도 로그인 유지(httpOnly 쿠키)
- `GET http://localhost:3000/api/auth/me` 에 사용자 정보 반환
- `GET http://127.0.0.1:8000/me/progress` 에 skill별 mastery + 최근 제출 10개 반환
- `http://localhost:3000/admin` 접근 시:
  - 일반 사용자: 403 안내
  - 관리자: Admin API 접근 성공
- `http://localhost:3000/dashboard` 에서 성취도 히트맵/레벨 확인 가능
- `http://localhost:3000/problems` 에서 문제 목록 확인 가능
- `http://localhost:3000/submissions` 에서 내 제출 히스토리 확인 가능
- `http://localhost:3000/admin/problems` 에서 관리자 문제/버전/번들 관리 가능

회원가입/비밀번호 재설정 API:
- `POST /auth/register`
- `POST /auth/password/forgot` (개발모드에서는 응답에 `reset_token` 포함)
- `POST /auth/password/reset`

### 문제은행 API (Problem / ProblemVersion)
마이그레이션:
```bash
cd apps/api
. .venv/Scripts/Activate.ps1
alembic upgrade head
```

관리자 토큰 발급(curl):
```bash
curl -X POST "http://127.0.0.1:8000/auth/login" ^
  -H "Content-Type: application/json" ^
  -d "{\"username\":\"admin\",\"password\":\"admin1234\"}"
```

1) 스킬 생성:
```bash
curl -X POST "http://127.0.0.1:8000/admin/skills" ^
  -H "Authorization: Bearer <ADMIN_TOKEN>" ^
  -H "Content-Type: application/json" ^
  -d "{\"name\":\"자료구조\",\"description\":\"기본 자료구조 활용\"}"
```

2) 문제 생성:
```bash
curl -X POST "http://127.0.0.1:8000/admin/problems" ^
  -H "Authorization: Bearer <ADMIN_TOKEN>" ^
  -H "Content-Type: application/json" ^
  -d "{\"title\":\"Two Sum\",\"folder_id\":1}"
```

2-1) 폴더(모듈) 생성:
```bash
curl -X POST "http://127.0.0.1:8000/admin/problem-folders" ^
  -H "Authorization: Bearer <ADMIN_TOKEN>" ^
  -H "Content-Type: application/json" ^
  -d "{\"name\":\"Python\",\"sort_order\":10}"
```

2-2) 폴더 목록 조회:
```bash
curl "http://127.0.0.1:8000/admin/problem-folders" ^
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```

3) 문제 버전 생성(statement_md 포함):
```bash
curl -X POST "http://127.0.0.1:8000/admin/problems/1/versions" ^
  -H "Authorization: Bearer <ADMIN_TOKEN>" ^
  -H "Content-Type: application/json" ^
  -d "{\"type\":\"coding\",\"difficulty\":\"easy\",\"max_score\":100,\"statement_md\":\"# 문제\\n두 수의 합을 구하세요.\",\"skills\":[{\"skill_id\":1,\"weight\":70}]}"
```

3-1) 객관식 버전 생성:
```bash
curl -X POST "http://127.0.0.1:8000/admin/problems/1/versions" ^
  -H "Authorization: Bearer <ADMIN_TOKEN>" ^
  -H "Content-Type: application/json" ^
  -d "{\"type\":\"multiple_choice\",\"difficulty\":\"easy\",\"max_score\":100,\"statement_md\":\"정답을 고르세요.\",\"question_meta_json\":{\"choices\":[\"A\",\"B\",\"C\"],\"correct_index\":1}}"
```

3-2) 주관식 버전 생성:
```bash
curl -X POST "http://127.0.0.1:8000/admin/problems/1/versions" ^
  -H "Authorization: Bearer <ADMIN_TOKEN>" ^
  -H "Content-Type: application/json" ^
  -d "{\"type\":\"subjective\",\"difficulty\":\"easy\",\"max_score\":100,\"statement_md\":\"핵심 개념을 설명하세요.\",\"question_meta_json\":{\"acceptable_answers\":[\"회귀\",\"regression\"],\"case_sensitive\":false}}"
```

3-3) 코딩 문제 번들(zip) 업로드:
```bash
curl -X POST "http://127.0.0.1:8000/admin/problem-versions/1/bundle" ^
  -H "Authorization: Bearer <ADMIN_TOKEN>" ^
  -F "file=@problem_bundle.zip"
```

업로드 시 처리:
- SHA256 계산 + 저장
- 크기 제한(기본 50MB)
- `problem_versions.bundle_key / bundle_sha256 / bundle_size` 업데이트

4) 학생 API 조회(최신 버전 summary/detail):
```bash
curl "http://127.0.0.1:8000/problems"
curl "http://127.0.0.1:8000/problems/1"
```

### 제출(Submission) API
상태머신: `QUEUED -> RUNNING -> GRADED | FAILED`

문항 유형별 제출 동작:
- `coding`: 비동기 채점(`QUEUED -> RUNNING -> GRADED/FAILED`)
- `multiple_choice`, `subjective`: 즉시 채점(`GRADED`)

RQ 비동기 채점(Docker + pytest-json-report):
- 제출 생성 시 API가 Redis 큐(`grading`)에 작업 enqueue
- worker가 `submission_id`를 받아:
1) `status=RUNNING`
2) Docker grader에서 pytest 실행
3) `grades(score/max_score, feedback_json)` 저장 + `status=GRADED`

Bundle 표준:
- `statement.md`
- `starter/*`
- `tests/public/*`
- `tests/hidden/*`
- `rubric.yaml` (테스트별 배점/시간 제한)

Worker bundle 처리:
- storage 인터페이스로 번들 읽기 (MVP: 로컬 파일시스템 `var/bundles`)
- 안전 추출(Zip Slip 방지): zip entry 경로가 destination 하위인지 검증 후 추출
- 추출된 `tests/public|hidden`으로 grader docker 실행

학생 토큰 발급:
```bash
curl -X POST "http://127.0.0.1:8000/auth/login" ^
  -H "Content-Type: application/json" ^
  -d "{\"username\":\"user\",\"password\":\"user1234\"}"
```

1) 제출 생성 (`status=QUEUED`):
```bash
curl -X POST "http://127.0.0.1:8000/submissions" ^
  -H "Authorization: Bearer <USER_TOKEN>" ^
  -H "Content-Type: application/json" ^
  -d "{\"problem_version_id\":1,\"code_text\":\"print('hello')\"}"
```

2) 제출 단건 조회(본인 것만):
```bash
curl "http://127.0.0.1:8000/submissions/1" ^
  -H "Authorization: Bearer <USER_TOKEN>"
```

3) 내 제출 목록 조회:
```bash
curl "http://127.0.0.1:8000/me/submissions?limit=20" ^
  -H "Authorization: Bearer <USER_TOKEN>"
```

4) 내 성취도 조회:
```bash
curl "http://127.0.0.1:8000/me/progress" ^
  -H "Authorization: Bearer <USER_TOKEN>"
```
계산식:
- `mastery = (earned_points / possible_points) * 100`
- `earned_points += grade.score * weight`
- `possible_points += grade.max_score * weight`

### 관리자 재채점(Regrade) + Grade 실행 이력
마이그레이션 적용:
```bash
cd apps/api
. .venv/Scripts/Activate.ps1
alembic upgrade head
```

관리자 제출 상세(최신 점수 + run 이력):
```bash
curl "http://127.0.0.1:8000/admin/submissions/1" ^
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```

재채점 큐 등록:
```bash
curl -X POST "http://127.0.0.1:8000/admin/submissions/1/regrade" ^
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```

동작:
- 재채점 시 `grade_runs`에 새 실행 이력 1건 추가
- `grades`는 최신 run 결과로 갱신되어 현재 점수로 표시
- 웹 Admin 상세: `http://localhost:3000/admin/submissions/1`

### Public tests 실행(학생)
공개 테스트 전용 실행 API(`hidden` 미실행, 저장 없음):
```bash
curl -X POST "http://127.0.0.1:8000/problems/1/run-public" ^
  -H "Authorization: Bearer <USER_TOKEN>" ^
  -H "Content-Type: application/json" ^
  -d "{\"code_text\":\"def solve(a,b):\\n    return a+b\",\"problem_version\":1}"
```

응답 형식:
- `status`: `PASSED` 또는 `FAILED`
- `summary`: 실행 버전, docker 종료코드, 실행 시간(ms), 길이 제한된 stdout/stderr(최대 8KB)
- `public_feedback`: public 테스트 pass/fail 요약 및 실패 케이스

보안:
- `tests/public`만 실행
- docker 하드닝 옵션(`--network none`, `--read-only`, `--cap-drop ALL` 등) 동일 적용
- 출력에서 hidden 관련 라인 제거

### Worker 실행
1) grader 이미지 빌드:
```bash
docker build -t qa-lab-grader-python -f grader-images/python/Dockerfile .
```

2) Docker Compose로 Redis/Postgres/Worker 실행:
```bash
docker compose -f infra/docker-compose.yml up -d postgres redis worker
```

3) API 실행:
```bash
cd apps/api
. .venv/Scripts/Activate.ps1
fastapi dev main.py
```

4) Worker 로그 확인:
```bash
docker compose -f infra/docker-compose.yml logs -f worker
```

로컬에서 worker만 직접 실행할 수도 있습니다:
```bash
cd apps/api
. .venv/Scripts/Activate.ps1
python worker.py
```

검증 포인트:
- `/submissions` POST 직후 조회하면 `status=QUEUED` 또는 `RUNNING`
- 몇 초 뒤 재조회하면 `status=GRADED` 와 `grade.score` 값 확인
- hidden 테스트 상세 케이스는 `feedback_json.hidden`의 요약만 반환
- hidden 테스트 중 `test_no_network_access_hidden`로 네트워크 차단(`--network none`) 검증

worker가 사용하는 docker run(예시):
```bash
docker run --rm \
  --network none \
  --read-only \
  --security-opt no-new-privileges=true \
  --cap-drop ALL \
  --pids-limit 256 \
  --cpus 1.0 \
  --memory 1g \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  -e PYTHONDONTWRITEBYTECODE=1 \
  -v <workdir>:/work:rw \
  qa-lab-grader-python \
  sh -lc "pytest -q --json-report --json-report-file=/work/report.json /work/tests"
```

### Grader Smoke Test
Docker grader가 실제 실행되는지 빠르게 확인:
```bash
bash scripts/smoke_grader.sh
```

검증 내용:
- grader 이미지 build
- 임시 작업 폴더에 `solution.py`, `tests/public`, `tests/hidden` 생성
- 하드닝 옵션(`--network none`, `--read-only`, `--cap-drop ALL` 등)으로 docker run
- `/work/report.json` 생성 확인 + JSON 파싱 검증
- hidden 테스트 내 네트워크 차단 테스트 포함

### GitHub Actions 전체 E2E
PR/push 시 `.github/workflows/ci.yml`에서 전체 스택 E2E를 실행합니다.

구성:
- Postgres/Redis: GitHub Actions service containers
- API/Worker: CI job에서 직접 백그라운드 실행
- Grader: `docker build` 후 worker가 실제 `docker run`으로 채점

검증 시나리오(`apps/api/tests/e2e/test_full_stack_e2e.py`):
- (A) Admin: 문제 버전 생성 -> zip 업로드 -> submit -> `GRADED` 확인
- (B) Student: `run-public` 호출 -> public 결과 확인 (hidden 노출 금지)
- (C) Student: submit -> hidden 포함 채점 -> grade 저장 확인
- (D) (추가) 악성 zip(Zip Slip) 업로드 후 제출 -> 채점 `FAILED` 확인(안전 추출 방어 간접 검증)

Playwright UI E2E(`apps/web/tests/e2e/problem-flows.spec.ts`):
- 로그인 -> 문제 열기 -> Workbench 진입 및 제출 버튼 표시 확인
- 로그인 -> 제출 -> `QUEUED/RUNNING/GRADED` 상태 전환 및 점수 표시 확인

CI에서는 API/Worker/DB/Redis가 동작 중인 상태에서 Playwright를 실행하며,
실패 시 스크린샷/트레이스/비디오가 `apps/web/test-results`, `apps/web/playwright-report`에 남고 artifact로 업로드됩니다.

로컬 실행:
```bash
# 1) API + worker + DB/Redis 준비 (README의 기존 절차 사용)
# 2) 테스트용 문제/번들 부트스트랩
python apps/api/tests/e2e/bootstrap_playwright_data.py

# 3) 웹 Playwright 실행
cd apps/web
pnpm install
pnpm exec playwright install --with-deps chromium
pnpm test:e2e
```

### 테스트 보강 실행 (Unit + E2E)
API 단위 테스트:
```bash
python -m pip install pytest
pytest -vv --tb=short apps/api/tests/unit
```

API/Worker E2E:
```bash
pytest -vv -s --tb=short apps/api/tests/e2e/test_full_stack_e2e.py
```

Playwright(학생 + 관리자 플로우):
```bash
cd apps/web
pnpm test:e2e
```

### 데이터/도메인 확장
- `problem_versions.status`: `draft | published | archived`
- `problem_versions.rubric_version`: 번들 업로드 시 증가
- `rubric_histories`: rubric 버전/sha 이력 저장
- `submissions`는 생성 시 `bundle_key_snapshot`, `bundle_sha256_snapshot`, `rubric_version_snapshot`을 고정 저장
- `mastery_snapshots`: 시점별 skill mastery 스냅샷 저장

운영 명령:
```bash
# 문제 버전 상태 변경 (admin)
curl -X PUT "http://127.0.0.1:8000/admin/problem-versions/1/status" ^
  -H "Authorization: Bearer <ADMIN_TOKEN>" ^
  -H "Content-Type: application/json" ^
  -d "{\"status\":\"published\"}"

# rubric 이력 조회 (admin)
curl "http://127.0.0.1:8000/admin/problem-versions/1/rubric-history" ^
  -H "Authorization: Bearer <ADMIN_TOKEN>"

# mastery 스냅샷 캡처 (admin)
curl -X POST "http://127.0.0.1:8000/admin/progress/snapshots/capture" ^
  -H "Authorization: Bearer <ADMIN_TOKEN>"

# 내 mastery 추세 조회 (student)
curl "http://127.0.0.1:8000/me/progress/trend?limit=20" ^
  -H "Authorization: Bearer <USER_TOKEN>"
```


### DB 마이그레이션 (Alembic)
1) `.env` 파일 만들기:
```bash
cd apps/api
copy .env.example .env
```

2) Postgres 실행:
```bash
cd ../..
docker compose -f infra/docker-compose.yml up -d postgres
```

3) 마이그레이션 파일 생성(autogenerate):
```bash
cd apps/api
. .venv/Scripts/Activate.ps1
alembic revision --autogenerate -m "init"
```

4) DB에 적용:
```bash
alembic upgrade head
```

### OpenAPI 타입 생성 (Web용)
의존성 추가 이유: FastAPI `/openapi.json` 스키마를 TypeScript 타입으로 자동 변환해 프론트/백 타입 불일치를 줄이기 위해 `openapi-typescript`를 사용합니다.

1) API 서버 실행:
```bash
cd apps/api
. .venv/Scripts/Activate.ps1
fastapi dev main.py
```

2) 새 터미널에서 타입 생성:
```bash
cd ../..
pnpm install
pnpm gen:api
```
기본 OpenAPI 주소는 `http://127.0.0.1:8000/openapi.json` 입니다.
포트를 바꿔 실행했다면 아래처럼 직접 생성할 수 있습니다:
```bash
pnpm exec openapi-typescript http://127.0.0.1:8010/openapi.json -o packages/openapi-client/src/index.ts
```

생성 위치:
- `packages/openapi-client/src/index.ts`

Web에서 import 예시:
```ts
import type { paths } from "@qa-lab/openapi-client";
```

### Infra (Postgres + Redis)
```bash
docker compose -f infra/docker-compose.yml up -d
```
상태 확인:
```bash
docker compose -f infra/docker-compose.yml ps
```
종료:
```bash
docker compose -f infra/docker-compose.yml down
```
데이터까지 삭제(주의):
```bash
docker compose -f infra/docker-compose.yml down -v
```

기본 개발용 Postgres 접속 정보:
- Host: `127.0.0.1`
- Port: `5432`
- User: `devuser`
- Password: `devpass`
- Database: `devdb`

볼륨:
- Postgres: `postgres_data`
- Redis: `redis_data`

### Docker 전체 스택 즉시 테스트 (Web+API+Worker)
로컬 `3000/8000` 포트가 이미 사용 중이면 아래처럼 포트를 바꿔 실행할 수 있습니다.

```powershell
$env:API_PORT='8010'
$env:WEB_PORT='3010'
docker compose -p qa-lab-prod --env-file infra/.env.prod -f infra/docker-compose.prod.yml up -d --build
```

실행 확인:
```bash
docker compose -p qa-lab-prod --env-file infra/.env.prod -f infra/docker-compose.prod.yml ps
```

웹 E2E 확인(도커 웹 3010 기준):
```powershell
cd apps/web
cmd /c "set PLAYWRIGHT_BASE_URL=http://127.0.0.1:3010&& pnpm test:e2e"
```

## 프로덕션 배포 준비
추가된 배포 자산:
- `apps/api/Dockerfile`
- `apps/web/Dockerfile`
- `infra/docker-compose.prod.yml`
- `infra/.env.prod.example`
- `docs/DEPLOYMENT.md`
- `docs/OPERATIONS_RUNBOOK.md`
- `scripts/deploy_prod.sh`
- `scripts/backup_prod.sh`
- `scripts/restore_prod.sh`
- `scripts/ops_healthcheck.sh`

빠른 배포 절차:
```bash
# 1) 환경파일 준비
cp infra/.env.prod.example infra/.env.prod
# 값 수정: POSTGRES_PASSWORD, JWT_SECRET_KEY, ALLOWED_ORIGINS, APP_ENV 등

# 2) 빌드 + 기동
bash scripts/deploy_prod.sh
```

운영 준비 명령:
```bash
# 상태 점검
bash scripts/ops_healthcheck.sh

# 백업
bash scripts/backup_prod.sh

# 복구(예시)
bash scripts/restore_prod.sh --input-dir backups/<timestamp>
```

직접 실행 명령:
```bash
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml build
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml up -d
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml ps
```

주의:
- `api`와 `worker`는 공개테스트/채점을 위해 Docker socket(`/var/run/docker.sock`) 접근이 필요합니다.

## shadcn 컴포넌트 추가 방법
의존성 추가 이유: 일관된 디자인 시스템 컴포넌트를 빠르게 재사용하기 위해 shadcn/ui를 사용합니다.

```bash
cd apps/web
pnpm dlx shadcn@latest add <component-name>
```

예시(Button):
```bash
cd apps/web
pnpm dlx shadcn@latest add button
```

## 개발 원칙
- 가능한 한 pnpm을 사용합니다.
- 새 의존성 추가 전에는 이유를 한 줄로 설명합니다.
- 작업 후 실행 방법(명령어)을 이 README에 업데이트합니다.

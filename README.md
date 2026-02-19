# QA Lab Monorepo

Next.js(App Router) + FastAPI + Docker Compose 기반의 모노레포입니다.

## MVP 범위 고정
- MVP 고정 문서: `docs/MVP_SCOPE.md`
- 성취도 모델 고정 문서: `docs/MASTERY_MODEL.md`
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
- Me (Bearer 필요): http://127.0.0.1:8000/me
- Docs: http://127.0.0.1:8000/docs

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
- 일반 사용자: `user@example.com` / `user1234`
- 관리자: `admin@example.com` / `admin1234`

5) 동작 확인:
- 로그인 후 새로고침해도 로그인 유지(httpOnly 쿠키)
- `GET http://localhost:3000/api/auth/me` 에 사용자 정보 반환
- `GET http://127.0.0.1:8000/me/progress` 에 skill별 mastery + 최근 제출 10개 반환
- `http://localhost:3000/admin` 접근 시:
  - 일반 사용자: 403 안내
  - 관리자: Admin API 접근 성공
- 홈 화면에서 `Run public tests` 버튼으로 공개 테스트 실행 가능
- `http://localhost:3000/dashboard` 에서 성취도 히트맵/레벨 확인 가능

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
  -d "{\"email\":\"admin@example.com\",\"password\":\"admin1234\"}"
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
  -d "{\"title\":\"Two Sum\"}"
```

3) 문제 버전 생성(statement_md 포함):
```bash
curl -X POST "http://127.0.0.1:8000/admin/problems/1/versions" ^
  -H "Authorization: Bearer <ADMIN_TOKEN>" ^
  -H "Content-Type: application/json" ^
  -d "{\"type\":\"coding\",\"difficulty\":\"easy\",\"max_score\":100,\"statement_md\":\"# 문제\\n두 수의 합을 구하세요.\",\"skills\":[{\"skill_id\":1,\"weight\":70}]}"
```

3-1) 문제 번들(zip) 업로드:
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
  -d "{\"email\":\"user@example.com\",\"password\":\"user1234\"}"
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
- 로그인 -> 문제 열기 -> `Run public tests` 클릭 -> 결과 패널의 `status/summary` 확인
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

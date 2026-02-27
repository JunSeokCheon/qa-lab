# SpartaExam Studio Monorepo

Next.js(App Router) + FastAPI + Docker Compose 기반의 시험/채점 서비스입니다.

## 한눈에 보기
- 프론트: `apps/web` (Next.js)
- 백엔드: `apps/api` (FastAPI)
- 배포: `infra/docker-compose.prod.yml`
- 자동채점 런타임 이미지: `grader-images/python/Dockerfile`
- 문서:
  - `docs/system-architecture.md`
  - `docs/user-admin-guide.md`

## 로컬 개발 시작

### 1) API 실행
```bash
cd apps/api
python -m venv .venv
. .venv/Scripts/Activate.ps1
python -m pip install -r requirements.txt
alembic upgrade head
fastapi dev main.py
```

### 2) Web 실행 (pnpm)
```bash
cd apps/web
pnpm install
pnpm dev
```

PowerShell 정책 때문에 `pnpm.ps1` 실행이 막히면 `pnpm.cmd`를 사용하세요.
```bash
pnpm.cmd --dir apps/web lint
pnpm.cmd --dir apps/web build
```

### 3) 접속 주소
- Web: `http://localhost:3000`
- API Docs: `http://127.0.0.1:8000/docs`

## 로컬에서 자주 쓰는 점검 명령
```bash
# API 마이그레이션 최신화
cd apps/api
. .venv/Scripts/Activate.ps1
alembic upgrade head

# Web lint/build
pnpm --dir apps/web lint
pnpm --dir apps/web build

# 문제 목록 카테고리 탭 확인
pnpm --dir apps/web dev
# http://localhost:3000/problems 에서 "전체" 탭 확인

# 객관식 복수 정답 확인
# 1) /admin/problems 또는 /admin/exams에서 정답 체크박스를 2개 이상 지정
# 2) /problems/{examId}에서 복수 선택 제출
# 3) /dashboard 통계/정오 판정 반영 확인

# 인증 안정성 회귀 게이트(토큰 만료/무효 + refresh 복구)
pnpm --dir apps/web test:e2e -- tests/e2e/auth-token-resilience.spec.ts
```

## Docker (로컬)
```bash
docker compose --env-file infra/.env.localtest -f infra/docker-compose.prod.yml pull
docker compose --env-file infra/.env.localtest -f infra/docker-compose.prod.yml build --pull
docker compose --env-file infra/.env.localtest -f infra/docker-compose.prod.yml up -d --remove-orphans
docker compose --env-file infra/.env.localtest -f infra/docker-compose.prod.yml ps
```

`web/api/worker`만 빠르게 갱신할 때:
```bash
docker compose --env-file infra/.env.localtest -f infra/docker-compose.prod.yml build --pull web api worker
docker compose --env-file infra/.env.localtest -f infra/docker-compose.prod.yml up -d --no-deps web api worker
docker compose --env-file infra/.env.localtest -f infra/docker-compose.prod.yml ps
```

## 운영 배포

사전 준비:
1. `infra/.env.prod` 설정 (`infra/.env.prod.example` 참고)
2. 필수 값 확인: `POSTGRES_PASSWORD`, `JWT_SECRET_KEY`, `OPENAI_API_KEY`, `APP_DOMAIN`, `ALLOWED_ORIGINS`

배포:
```bash
git fetch --all --prune
git pull --ff-only origin main
bash scripts/deploy_prod.sh --env-file infra/.env.prod
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml ps
```

배포 후 점검:
```bash
PUBLIC_BASE_URL="https://qa.example.com" bash scripts/ops_healthcheck.sh
```

## GitHub Actions
- CI: `.github/workflows/ci.yml`
- 배포: `.github/workflows/deploy-prod.yml` (`main` push 시 자동)

배포 워크플로우용 필수 시크릿:
- `PROD_SSH_KEY` (또는 `SSH_PRIVATE_KEY`, `EC2_SSH_KEY`)

## 기본 계정
- 관리자: `admin` / `admin1234`
- 사용자: `user` / `user1234`

## 주요 페이지
- 사용자 시험 목록: `/problems`
- 사용자 시험 응시: `/problems/{examId}`
- 사용자 제출 이력: `/submissions`
- 사용자 결과 대시보드: `/dashboard`
- 관리자 허브: `/admin`
- 관리자 시험 생성: `/admin/problems`
- 관리자 시험 목록/재출제: `/admin/exams`
- 관리자 채점 관리: `/admin/grading`
- 관리자 감사 로그: `/admin/audit-logs`

## 기능 메모
- 객관식은 단일/복수 정답 모두 지원합니다.
- 제출 후 재응시는 불가하며, 제출 답안 조회가 가능합니다.
- 시험 시작 시각(`starts_at`)과 제한 시간(`duration_minutes`)을 설정할 수 있습니다.
- 관리자 결과 공유 전에는 사용자 점수가 공개되지 않습니다.
- 문항별 이미지 업로드를 지원합니다.

## 자동채점 메모
- 주관식/코딩은 문항의 `answer_key_text`를 기준으로 자동 채점됩니다.
- `OPENAI_API_KEY`가 없거나 호출 실패 시 폴백 채점이 동작합니다.
- 검토가 필요한 응답은 관리자 화면에서 필터링해 후속 처리할 수 있습니다.

## 운영/점검 스크립트
```bash
# 통합 점검
node scripts/full_system_check.mjs

# 검토 필요 -> 수동 확정 플로우 점검
node scripts/review_pending_flow_check.mjs

# 백업
bash scripts/backup_prod.sh --env-file infra/.env.prod --output-dir backups
```

## 문서 열기
```bash
start docs/system-architecture.md
start docs/user-admin-guide.md
```



## Exam Draft Save (Local)
```bash
# 1) Apply API migration (adds draft-save columns)
cd apps/api
. .venv/Scripts/Activate.ps1
alembic upgrade head

# 2) Run local servers
fastapi dev main.py
pnpm --dir apps/web dev

# 3) Manual check
# - Click the draft-save button next to submit at /problems/{examId}
# - Refresh/reconnect and verify answers are restored
# - Verify exam timer keeps decreasing after draft save
```

## Exam Appeal Flow (Local)
```bash
# 1) Run local servers
cd apps/api
. .venv/Scripts/Activate.ps1
fastapi dev main.py

# 2) Run web
pnpm --dir apps/web dev

# 3) Manual check
# - Student: /dashboard -> per-question "정정 신청" 버튼으로 사유 전송
# - Admin: /admin/appeals -> 시험/학생 필터로 신청 확인
# - Admin: "재채점 요청" 또는 "완료 처리" 후 결과 공유
# - Student: /dashboard 새로고침 후 정정 상태/결과 반영 확인
```

## Objective Manual Correction (Local)
```bash
# 1) Rebuild local docker services
docker compose --env-file infra/.env.localtest -f infra/docker-compose.prod.yml up -d --build api web worker

# 2) Manual check
# - Admin: /admin/grading 상세에서 객관식 문항에도 "정답 처리/오답 처리" 버튼 노출 확인
# - Admin: 객관식 정정 처리 후 상태 배지와 점수 반영 확인
# - Student: /dashboard 결과에서 객관식 판정/집계가 정정 결과 기준으로 반영되는지 확인
```

## Exam Band CSV Export (Local)
```bash
# 1) Apply API migration (adds optional high/mid band thresholds)
cd apps/api
. .venv/Scripts/Activate.ps1
alembic upgrade head

# 2) Run API
fastapi dev main.py

# 3) Run Web (pnpm)
pnpm --dir apps/web dev
```

Manual check:
- Admin: `/admin/problems` or `/admin/exams`에서 시험 상/중 기준(선택) 입력
- Admin: 응시 제출이 모두 `GRADED` 상태인지 확인
- Admin dashboard(`/dashboard`): `상중하 CSV 다운로드` 클릭
- CSV에서 `total_questions`, `correct_answers`, `performance_band_ko` 컬럼 확인

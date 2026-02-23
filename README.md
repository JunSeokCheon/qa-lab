# QA Lab Monorepo

Next.js(App Router) + FastAPI + Docker Compose 기반 QA 서비스입니다.

## 구성
- `apps/web`: Next.js 프런트엔드
- `apps/api`: FastAPI 백엔드
- `infra/docker-compose.prod.yml`: Docker Compose 배포 구성
- `grader-images/python/Dockerfile`: 코딩 자동채점 이미지

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

### 2) Web (pnpm)
```bash
cd apps/web
pnpm install
pnpm dev
```

### 3) 접속
- Web: `http://localhost:3000`
- API Docs: `http://127.0.0.1:8000/docs`

## Docker 실행/갱신
로컬 통합 테스트 기준:
```bash
# LLM 자동채점 사용 시 infra/.env.localtest의 OPENAI_API_KEY를 먼저 설정
docker compose --env-file infra/.env.localtest -f infra/docker-compose.prod.yml pull
docker compose --env-file infra/.env.localtest -f infra/docker-compose.prod.yml build --pull
docker compose --env-file infra/.env.localtest -f infra/docker-compose.prod.yml up -d --remove-orphans
docker build -t qa-lab-grader-python -f grader-images/python/Dockerfile .
docker compose --env-file infra/.env.localtest -f infra/docker-compose.prod.yml ps
```

web/api만 빠르게 최신 반영:
```bash
docker compose --env-file infra/.env.localtest -f infra/docker-compose.prod.yml build --pull web api worker
docker compose --env-file infra/.env.localtest -f infra/docker-compose.prod.yml up -d --no-deps web api worker
docker compose --env-file infra/.env.localtest -f infra/docker-compose.prod.yml ps
```

프로덕션 기준:
```bash
# LLM 자동채점 사용 시 infra/.env.prod의 OPENAI_API_KEY를 반드시 설정
bash scripts/deploy_prod.sh --env-file infra/.env.prod
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml ps
```

## 외부 접근 배포(튜터/수강생 접속)
다른 튜터/수강생이 접속할 수 있도록 `Caddy(HTTPS)` + `web/api/worker/postgres/redis` 구성으로 배포합니다.

사전 준비:
1. 퍼블릭 서버(고정 IP) 1대 준비
2. 도메인 DNS `A` 레코드를 서버 IP로 연결 (예: `qa.example.com`)
3. 방화벽 인바운드 허용: `80/tcp`, `443/tcp`
4. 서버에 Docker + Docker Compose 설치

환경 설정:
1. `infra/.env.prod.example`를 복사해 `infra/.env.prod` 생성
2. 아래 값 반드시 설정
   - `POSTGRES_PASSWORD`, `JWT_SECRET_KEY`, `OPENAI_API_KEY`
   - `APP_DOMAIN` (예: `qa.example.com`)
   - `ALLOWED_ORIGINS` (예: `https://qa.example.com`)
   - `ACME_EMAIL` (인증서 발급용 이메일)

배포 실행:
```bash
git fetch --all --prune
git pull --ff-only origin main
bash scripts/deploy_prod.sh --env-file infra/.env.prod
```
참고: `deploy_prod.sh`는 `postgres/redis`를 먼저 기동하고 준비 상태를 확인한 뒤 `api/worker/web/caddy`를 순차 재기동합니다.

배포 후 점검:
```bash
PUBLIC_BASE_URL="https://qa.example.com" bash scripts/ops_healthcheck.sh
```

참고:
- 외부 공개는 `Caddy`(80/443)가 담당합니다.
- `web(3000)`/`api(8000)`는 `127.0.0.1`에만 바인딩되어 직접 외부 노출되지 않습니다.
- 코딩 자동채점용 `GRADER_IMAGE`는 배포 스크립트에서 자동 빌드됩니다.

## Git 최신화
```bash
git fetch --all --prune
git pull --ff-only origin main
```

## GitHub Actions CI/CD
이 저장소는 GitHub Actions로 `CI`와 `배포`를 자동 실행합니다(`main` push 기준).

- `CI` (`.github/workflows/ci.yml`)
  - 트리거: `push`, `pull_request`
  - 수행: API 문법 검사, API/worker 기동 스모크, 웹 lint/build, 통합 점검(`scripts/full_system_check.mjs`)

- `Deploy Production` (`.github/workflows/deploy-prod.yml`)
  - 활성화 상태 (`main` push 시 자동 실행 + 수동 실행 가능)
  - 동작: 운영 서버 SSH 접속 -> `git pull` -> `bash scripts/deploy_prod.sh --env-file infra/.env.prod` -> `ops_healthcheck`

- `Ops Backup` (`.github/workflows/ops-backup.yml`)
  - 현재 비활성화 상태 (`if: false`, 스케줄 실행 없음)

- `Ops Restore Drill` (`.github/workflows/ops-restore-drill.yml`)
  - 현재 비활성화 상태 (`if: false`, 스케줄 실행 없음)

배포 워크플로우 실행 전 GitHub `Secrets` 또는 `Variables`를 설정하세요.
- 필수: `PROD_SSH_KEY` (개인키, 멀티라인 그대로)
- 호환 키 이름도 지원: `SSH_PRIVATE_KEY`, `EC2_SSH_KEY`
- 선택: `PROD_HOST`(없으면 `PROD_PUBLIC_URL`에서 추론), `PROD_PORT`(기본 22), `PROD_USER`(기본 `ubuntu`), `PROD_APP_DIR`(기본 `/home/ubuntu/qa-lab`), `PROD_PUBLIC_URL`(기본 `https://spartaqa.com`)

### 로컬 개발 후 운영 반영 루틴
권장(CI 검증 + 자동 배포):
1. 로컬에서 개발/테스트 완료
2. `git add -A && git commit -m "..." && git push origin main`
3. GitHub Actions `CI`/`Deploy Production` 실행 확인
4. 배포 후 `https://spartaqa.com` 접속 확인

필요 시 GitHub Actions에서 `Deploy Production`을 수동 실행하거나 서버에서 직접 수동 배포도 가능합니다.

수동(서버에서 직접):
```bash
git fetch --all --prune
git pull --ff-only origin main
bash scripts/deploy_prod.sh --env-file infra/.env.prod
PUBLIC_BASE_URL="https://spartaqa.com" bash scripts/ops_healthcheck.sh
```

## 기본 계정
- 관리자: `admin` / `admin1234`
- 사용자: `user` / `user1234`
- 로그인 화면은 기본 아이디/비밀번호 자동 입력이 없으며, `자동 로그인` 체크 시에만 장기 세션(remember me)이 적용됩니다.

## 주요 페이지
- 사용자 시험 목록: `/problems`
- 사용자 시험 응시: `/problems/{examId}`
- 사용자 제출 이력: `/submissions`
- 관리자 허브: `/admin`
- 관리자 시험지 관리: `/admin/problems`
- 관리자 시험 목록 관리: `/admin/exams`
- 관리자 시험 대시보드: `/dashboard`
- 관리자 자동채점: `/admin/grading`
- 관리자 사용자 관리: `/admin/users`

## 관리자 대시보드 CSV/엑셀 내보내기
경로: `/dashboard` (admin 로그인)

다운로드 컬럼 형식:
- 행: 응시 수강생 이름
- 열: 문제 번호(예: `1번`, `2번`, ...)
- 값: 정답 `1`, 오답 `0`
- 학생별 우측 컬럼: `합계`, `정답률(%)`
- 하단 요약 행:
  - `합계`: 문제별 정답자 수
  - `정답률(%)`: 문제별 정답률
  - `전체 평균 점수(100점)`: 전체 응시자 평균 점수

## 자동채점(주관식/코딩) 규칙
- 객관식은 입력한 정답 번호(`correct_choice_index`)로 즉시 채점됩니다.
- 주관식/코딩은 문항의 `정답/채점 기준(answer_key_text)`을 기준으로 LLM이 0~100점 자동채점합니다.
- 주관식/코딩 자동채점은 제출 즉시 시작되지 않으며, 관리자 `/admin/grading`에서 `자동 채점 시작!` 승인 후 순차 실행됩니다.
- `answer_key_text`가 비어 있으면 자동채점 대상에서 제외되고 수동 채점이 필요합니다.
- LLM 자동채점을 사용하려면 `OPENAI_API_KEY`가 설정되어야 합니다.
- LLM 채점 버전 고정:
  - `EXAM_LLM_MODEL` (기본 `gpt-4.1-mini`)
  - `EXAM_LLM_PROMPT_VERSION` (기본 `exam_answer_key_prompt_v2_2026-02-22`)
  - `EXAM_LLM_SCHEMA_VERSION` (기본 `exam_grading_schema_v2`)
- 채점 근거 구조화:
  - `rationale.summary`, `matched_points`, `missing_points`, `deductions`, `confidence`를 저장합니다.
- LLM 호출이 실패(예: 429 quota, timeout)하면 자동으로 `answer_key_fallback_v2` 폴백 채점이 수행되어 채점이 중단되지 않습니다.
- 리소스 파일 업로드 최대 용량은 파일당 500MB입니다.
- 500MB를 초과하는 자료는 Google Drive 링크를 시험 설명/문항에 함께 첨부하는 방식을 권장합니다.

## 이의제기 재채점 플로우
- 관리자 `/dashboard`의 학생별 제출 상세에서 주관식/코딩 문항마다 `이의제기 재채점 요청`을 등록할 수 있습니다.
- 재채점 요청 시 해당 제출은 `QUEUED`로 전환되고 자동 채점 큐에 등록됩니다.
- 재채점 결과에는 모델/프롬프트/스키마 버전이 함께 남아 재현 가능한 비교가 가능합니다.

## 자동채점 정답 키 입력
- 관리자 시험 생성/재출판 화면에서 주관식 문항에 정답 키 텍스트를 입력할 수 있습니다.
- 문항 카드의 `정답/채점 기준` 섹션에서 문항별 정답을 입력할 수 있습니다.
- 객관식은 해당 섹션의 라디오 버튼으로 정답 번호를 지정합니다.
- 문항 유형을 `subjective` 또는 `coding`으로 바꾸면 텍스트 기반 정답/채점 기준 입력 칸이 표시됩니다.
- 주관식/코딩은 LLM이 정답 키 대비 의미/로직 일치도를 평가해 0~100점으로 채점합니다.
- 객관식은 기존처럼 정답 번호(`correct_choice_index`)로 채점됩니다.
- 비개발자 튜터 UX:
  - 코딩 정답 템플릿(입출력 예시 기반) 버튼 제공
  - `채점기준 도우미` 버튼으로 문항별 채점 기준 초안 자동 생성
  - 시험지 관리 화면에 문제-정답 작성 가이드 내장

## 백업/복구 운영
수동 실행:
```bash
# 백업 생성
bash scripts/backup_prod.sh --env-file infra/.env.prod --output-dir backups

# 백업 보관 정책(최신 14개만 유지)
bash scripts/prune_backups.sh --backup-root backups --keep-last 14

# 복구 리허설(임시 Postgres 컨테이너에 복구 검증)
bash scripts/backup_restore_drill.sh --env-file infra/.env.prod --output-dir backups
```

서버 크론 설치(선택):
```bash
bash scripts/install_backup_schedule.sh --app-dir "$(pwd)" --env-file infra/.env.prod --backup-root backups --keep-last 14
```

## 관리자 수동 채점
- 경로: `/dashboard` (admin 로그인)
- `학생별 제출 상세`에서 수강생의 문항별 제출 답안, 정답/오답/미채점 상태를 확인할 수 있습니다.
- 주관식/코딩 문항에는 `수동 채점` 영역이 제공됩니다.
  - 점수 직접 입력(`0~100`) 후 `점수 저장`
  - 빠른 처리: `정답 처리(100)`, `오답 처리(0)`
  - 메모 입력 후 저장 가능

## 검증 명령
```powershell
# DB 스키마 최신화
cd apps/api
alembic upgrade head

# 웹 타입/린트/빌드 확인
cd ../..
pnpm.cmd --filter web lint
pnpm.cmd --filter web build

$env:API_BASE_URL="http://127.0.0.1:8000"
$env:VIRTUAL_USERS="12"
node scripts/full_system_check.mjs

bash scripts/smoke_grader.sh
```

## 비개발자 튜터 시나리오 30명 자동 시뮬레이션
튜터가 테스트 코드를 직접 작성하지 않고 `정답/채점 기준(answer_key_text)`만 입력한다는 가정으로 시험 생성 + 30명 가상 응시 + 자동채점/강제 재채점을 수행합니다.
첨부 파일(문제 PDF/모범답안 ipynb/데이터셋 zip)을 시험 리소스로 업로드합니다.

```powershell
# 1) 기존 테스트 기록 정리
docker compose --env-file infra/.env.localtest -f infra/docker-compose.prod.yml exec -T postgres `
  psql -U qa_lab -d qa_lab -c `
  "BEGIN; DELETE FROM grade_runs; DELETE FROM grades; DELETE FROM submissions; DELETE FROM exam_answers; DELETE FROM exam_submissions; DELETE FROM exam_resources; DELETE FROM exam_questions; DELETE FROM exams; DELETE FROM problem_version_skills; DELETE FROM rubric_histories; DELETE FROM problem_versions; DELETE FROM problems; DELETE FROM users WHERE role <> 'admin'; COMMIT;"
docker compose --env-file infra/.env.localtest -f infra/docker-compose.prod.yml exec -T redis redis-cli FLUSHALL

# 2) 시험 생성 + 30명 시뮬레이션 실행
$env:API_BASE_URL="http://127.0.0.1:8000"
$env:VIRTUAL_USERS="30"
$env:DATASET_ZIP_PATH="C:/Users/tlsdy/Downloads/seoul_real_estate_dataset.zip"
$env:ASSIGNMENT_PDF_PATH="C:/Users/tlsdy/Downloads/개인 과제.pdf"
$env:ANSWER_NOTEBOOK_PATH="C:/Users/tlsdy/Downloads/베이직반_과제_모범답안.ipynb"
node scripts/nondev_tutor_exam_simulation.mjs
```

스크립트 성공 시 JSON으로 아래를 출력합니다.
- 생성된 시험 ID/문항 수/업로드 리소스 ID
- 제출/채점 상태 요약
- 점수대(구간) 분포
- 코딩 문항별 최소/최대/평균/고유 점수
- 샘플 채점 사유(reason) 및 강제 재채점 완료 여부

## 수동 QA 점검 흐름
1. `http://localhost:3000` 접속 후 `admin`, `user` 계정으로 각각 로그인합니다.
2. 관리자 `시험지 관리`/`시험 목록 관리`에서 문항 카드의 `정답/채점 기준` 영역(객관식 정답 라디오, 주관식 정답 키 입력)을 확인합니다.
3. 관리자 `대시보드`에서 시험 선택 후 `학생별 제출 상세`의 문항별 정답/오답 표시와 `수동 채점` 동작(점수 저장, 정답/오답 빠른 처리)을 확인합니다.
4. 관리자 `대시보드`에서 `CSV 다운로드`, `엑셀(.xls) 다운로드`를 실행합니다.
5. 파일에서 문제별 `1/0`, 하단 `합계/정답률`, `전체 평균 점수(100점)`을 확인합니다.
6. 사용자/관리자 화면 공통 텍스트와 헤더 컬러 통일 상태를 확인합니다.
7. 비밀번호 재설정 화면에서 하단 `/login` 복귀 문구 제거 여부를 확인합니다.

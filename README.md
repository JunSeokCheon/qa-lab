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
docker compose --env-file infra/.env.localtest -f infra/docker-compose.prod.yml pull
docker compose --env-file infra/.env.localtest -f infra/docker-compose.prod.yml build --pull
docker compose --env-file infra/.env.localtest -f infra/docker-compose.prod.yml up -d --remove-orphans
docker build -t qa-lab-grader-python -f grader-images/python/Dockerfile .
docker compose --env-file infra/.env.localtest -f infra/docker-compose.prod.yml ps
```

프로덕션 기준:
```bash
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml up -d --build
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml ps
```

## Git 최신화
```bash
git fetch --all --prune
git pull --ff-only origin main
```

## 기본 계정
- 관리자: `admin` / `admin1234`
- 사용자: `user` / `user1234`

## 주요 페이지
- 사용자 시험 목록: `/problems`
- 사용자 시험 응시: `/problems/{examId}`
- 사용자 제출 이력: `/submissions`
- 관리자 시험지 관리: `/admin/problems`
- 관리자 시험 목록 관리: `/admin/exams`
- 관리자 시험 대시보드: `/dashboard`
- 관리자 자동채점: `/admin/grading`

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

## 자동채점(코딩) 규칙
- 코딩 문항 채점은 정답 문자열 비교가 아니라 테스트 코드 실행 기반입니다.
- 시험 리소스 업로드 시 테스트 파일을 포함해야 자동채점이 가능합니다.
- 테스트 탐색 순서:
  - `tests/question_{order}`
  - 없으면 `tests/`
- 일반적으로 코딩 문제마다 관리자가 테스트 코드를 작성해야 합니다.
- 반복 문제 유형은 템플릿 테스트를 복사해서 입력/기대값만 바꿔 재사용할 수 있습니다.

## 검증 명령
```powershell
pnpm.cmd --filter web lint
pnpm.cmd --filter web build

$env:API_BASE_URL="http://127.0.0.1:8000"
$env:VIRTUAL_USERS="12"
node scripts/full_system_check.mjs

bash scripts/smoke_grader.sh
```

## 수동 QA 점검 흐름
1. `http://localhost:3000` 접속 후 `admin`, `user` 계정으로 각각 로그인합니다.
2. 관리자 `대시보드`에서 시험 선택 후 `CSV 다운로드`, `엑셀(.xls) 다운로드`를 실행합니다.
3. 파일에서 문제별 `1/0`, 하단 `합계/정답률`, `전체 평균 점수(100점)`을 확인합니다.
4. 사용자/관리자 화면 공통 텍스트와 헤더 컬러 통일 상태를 확인합니다.
5. 비밀번호 재설정 화면에서 하단 `/login` 복귀 문구 제거 여부를 확인합니다.

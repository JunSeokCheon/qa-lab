# QA Lab Monorepo

Next.js(App Router) + FastAPI + Docker Compose 기반 QA 서비스입니다.

## 구성
- `apps/web`: Next.js 프런트엔드
- `apps/api`: FastAPI 백엔드
- `infra/docker-compose.prod.yml`: Docker 배포 구성

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

## Docker 배포

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
- 시험 목록(학습자): `/problems`
- 시험 응시: `/problems/{examId}`
- 내 제출(학습자): `/submissions`
- 시험지 관리(관리자): `/admin/problems`
- 시험 목록 관리(관리자): `/admin/exams`
- 시험 통계 대시보드(관리자): `/dashboard`

## 시험 운영

### 시험지 관리 (`/admin/problems`)
- 시험 생성(객관식/주관식/코딩)
- 객관식은 1~4번 선택지 + 정답 번호 1개 지정
- 시험별 코딩 리소스(데이터 파일) 업로드

### 시험 목록 관리 (`/admin/exams`)
- 기존 시험 메타 정보 수정(제목/설명/카테고리/유형/상태)
- 기존 시험 문항 편집 후 `재출제` 버튼으로 새 시험 생성
- 재출제 시 기존 코딩 리소스 복사 옵션 제공

### 시험 대시보드 (`/dashboard`, 관리자)
- 시험 선택 드롭다운
- 문항 필터, 학생 필터
- 객관식 보기별 응답자 수/응답자 목록
- 맞힌 개수별 인원 분포
- 학생별 제출 상세

## API 요약

### 인증
- `POST /auth/login`
- `POST /auth/logout`
- `POST /auth/register`
- `POST /auth/password/forgot`
- `POST /auth/password/reset`
- `GET /me`

### 시험 (관리자)
- `POST /admin/exams`
- `GET /admin/exams`
- `GET /admin/exams/{exam_id}`
- `PUT /admin/exams/{exam_id}`
- `POST /admin/exams/{exam_id}/republish`
- `GET /admin/exams/{exam_id}/submissions`
- `GET /admin/exams/{exam_id}/resources`
- `POST /admin/exams/{exam_id}/resources`

### 시험 (사용자)
- `GET /exams`
- `GET /exams/{exam_id}`
- `POST /exams/{exam_id}/submit`
- `GET /me/exam-submissions`
- `GET /exams/{exam_id}/resources`
- `GET /exams/{exam_id}/resources/{resource_id}/download`

## 자동 채점/리소스 규칙 (Exam Coding)
- 코딩 문항이 있는 시험 제출 시 worker 큐로 자동 채점 작업이 등록됩니다.
- 시험 리소스 업로드 시:
  - `.zip`: 채점 번들 루트로 압축 해제
  - 그 외 파일: `resources/` 아래에 배치
- 테스트 탐색 순서:
  - `tests/question_{order}`
  - 없으면 `tests/`
- 코딩 문항은 정답 문자열 고정 비교가 아니라 테스트 코드 기반으로 채점합니다.

## 마이그레이션

```bash
cd apps/api
alembic upgrade head
```

이번 변경으로 추가된 마이그레이션:
- `0015_exam_correct_choice`

## 테스트

### API 단위 테스트
```bash
apps/api/.venv/Scripts/pytest.exe -q apps/api/tests/unit
```

### API E2E 테스트
```bash
apps/api/.venv/Scripts/pytest.exe -q apps/api/tests/e2e/test_full_stack_e2e.py
```

### Web 빌드 확인
```bash
pnpm --filter web build
```

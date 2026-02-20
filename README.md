# QA Lab Monorepo

Next.js(App Router) + FastAPI + Docker Compose 湲곕컲 QA ?쒕퉬?ㅼ엯?덈떎.

## 援ъ꽦
- `apps/web`: Next.js ?꾨윴?몄뿏??- `apps/api`: FastAPI 諛깆뿏??- `infra/docker-compose.prod.yml`: Docker 諛고룷 援ъ꽦

## 濡쒖뺄 ?ㅽ뻾

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

### 3) ?묒냽
- Web: `http://localhost:3000`
- API Docs: `http://127.0.0.1:8000/docs`

## Docker 諛고룷
```bash
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml up -d --build
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml ps
```

湲곕낯 ?ы듃:
- Web: `http://localhost:3000`
- API: `http://localhost:8000`

## 湲곕낯 怨꾩젙
- 愿由ъ옄: `admin` / `admin1234`
- ?ъ슜?? `user` / `user1234`

## 二쇱슂 ?붾㈃
- ?쒗뿕 紐⑸줉(?숈뒿??: `/problems`
- ?쒗뿕 ?묒떆: `/problems/{examId}`
- ???쒖텧(?숈뒿??: `/submissions`
- ?쒗뿕吏 愿由?愿由ъ옄): `/admin/problems`
- ?쒗뿕 紐⑸줉 愿由?愿由ъ옄): `/admin/exams`
- ?쒗뿕 ?듦퀎 ??쒕낫??愿由ъ옄): `/dashboard`

## ?쒗뿕 ?댁쁺

### ?쒗뿕吏 愿由?(`/admin/problems`)
- ?쒗뿕 ?앹꽦(媛앷???二쇨???肄붾뵫)
- 媛앷??앹? 1~4踰??좏깮吏 + ?뺣떟 踰덊샇 1媛?吏??- ?쒗뿕蹂?肄붾뵫 由ъ냼???곗씠???뚯씪) ?낅줈??
### ?쒗뿕 紐⑸줉 愿由?(`/admin/exams`)
- 湲곗〈 ?쒗뿕 硫뷀? ?뺣낫 ?섏젙(?쒕ぉ/?ㅻ챸/移댄뀒怨좊━/?좏삎/?곹깭)
- 湲곗〈 ?쒗뿕 臾명빆 ?몄쭛 ??`?ъ텧?? 踰꾪듉?쇰줈 ???쒗뿕 ?앹꽦
- ?ъ텧????湲곗〈 肄붾뵫 由ъ냼??蹂듭궗 ?듭뀡 ?쒓났

### ?쒗뿕 ??쒕낫??(`/dashboard`, 愿由ъ옄)
- ?쒗뿕 ?좏깮 ?쒕∼?ㅼ슫
- 臾명빆 ?꾪꽣, ?숈깮 ?꾪꽣
- 媛앷???蹂닿린蹂??묐떟?????묐떟??紐⑸줉
- 留욏엺 媛쒖닔蹂??몄썝 遺꾪룷
- ?숈깮蹂??쒖텧 ?곸꽭

## API ?붿빟

### ?몄쬆
- `POST /auth/login`
- `POST /auth/logout`
- `POST /auth/register`
- `POST /auth/password/forgot`
- `POST /auth/password/reset`
- `GET /me`

### ?쒗뿕 (愿由ъ옄)
- `POST /admin/exams`
- `GET /admin/exams`
- `GET /admin/exams/{exam_id}`
- `PUT /admin/exams/{exam_id}`
- `POST /admin/exams/{exam_id}/republish`
- `GET /admin/exams/{exam_id}/submissions`
- `GET /admin/exams/{exam_id}/resources`
- `POST /admin/exams/{exam_id}/resources`

### ?쒗뿕 (?ъ슜??
- `GET /exams`
- `GET /exams/{exam_id}`
- `POST /exams/{exam_id}/submit`
- `GET /me/exam-submissions`
- `GET /exams/{exam_id}/resources`
- `GET /exams/{exam_id}/resources/{resource_id}/download`

## ?먮룞 梨꾩젏/由ъ냼??洹쒖튃 (Exam Coding)
- 肄붾뵫 臾명빆???덈뒗 ?쒗뿕 ?쒖텧 ??worker ?먮줈 ?먮룞 梨꾩젏 ?묒뾽???깅줉?⑸땲??
- ?쒗뿕 由ъ냼???낅줈????
  - `.zip`: 梨꾩젏 踰덈뱾 猷⑦듃濡??뺤텞 ?댁젣
  - 洹????뚯씪: `resources/` ?꾨옒??諛곗튂
- ?뚯뒪???먯깋 ?쒖꽌:
  - `tests/question_{order}`
  - ?놁쑝硫?`tests/`
- 肄붾뵫 臾명빆? ?뺣떟 臾몄옄??怨좎젙 鍮꾧탳媛 ?꾨땲???뚯뒪??肄붾뱶 湲곕컲?쇰줈 梨꾩젏?⑸땲??

## 留덉씠洹몃젅?댁뀡
```bash
cd apps/api
alembic upgrade head
```

?꾩옱 留덉씠洹몃젅?댁뀡:
- `0016_exam_target_track`

## 寃利??먮룞???뚯뒪?몃뒗 ?꾩옱 ?덊룷?먯꽌 ?쒓굅?섏뿀?듬땲??  
諛고룷 ??理쒖냼 寃利앹? ?꾨옒 鍮뚮뱶濡?吏꾪뻾?⑸땲??

```bash
pnpm --filter web build
```

## 2026-02-20 ?낅뜲?댄듃 ?ㅽ뻾 ?쒖꽌
?꾨옒 ?쒖꽌濡?理쒖떊 湲곕뒫(?쒗뿕 ???諛??꾪꽣, ?쒗뿕 ??젣, ?쒗뿕 紐⑸줉 由ъ냼???낅줈?? ??쒕낫??洹몃옒????諛섏쁺?????덉뒿?덈떎.

```bash
cd apps/api
alembic upgrade head

cd ../..
pnpm --filter web build
```

?꾩옱 理쒖떊 留덉씠洹몃젅?댁뀡:
- `0016_exam_target_track`

## 2026-02-20 Git/Docker 최신화 + 통합검증 실행 명령

```bash
# 1) Git 최신화
git fetch --all --prune
git pull --ff-only

# 2) Docker 최신화 (이미지 pull + build + 재기동)
docker compose --env-file infra/.env.localtest -f infra/docker-compose.prod.yml pull
docker compose --env-file infra/.env.localtest -f infra/docker-compose.prod.yml build --pull
docker compose --env-file infra/.env.localtest -f infra/docker-compose.prod.yml up -d --remove-orphans

# 3) 채점 컨테이너 이미지 최신화
docker build -t qa-lab-grader-python -f grader-images/python/Dockerfile .
```

```powershell
# 4) 전체 통합 점검 (가상 사용자 12명, 시험 생성/복제/리소스 업로드/제출/자동채점/권한 필터)
$env:API_BASE_URL="http://127.0.0.1:8000"
$env:VIRTUAL_USERS="12"
node scripts/full_system_check.mjs

# 5) grader 스모크 테스트
bash scripts/smoke_grader.sh

# 6) 웹 빌드 검증 (PowerShell 정책 이슈 회피용 pnpm.cmd)
pnpm.cmd --filter web build
```

## 2026-02-20 신규 기능 사용 방법

### 1) 시험 생성/재출제 시 리소스 동시 업로드
- `/admin/problems` 에서 새 시험 만들기 폼 안에서 코딩 리소스를 함께 업로드
- `/admin/exams` 에서 재출제 시 `재출제 시 추가 리소스 업로드`로 새 시험에 바로 업로드

### 2) 관리자 자동 채점 메뉴
- `/admin/grading`
- 기능:
  - 시험/상태 필터
  - 코딩 문항 제출만 필터
  - 제출별 `채점 실행` / `강제 재채점`
  - 일괄 실행

### 3) 사용자 대시보드 시험 결과
- `/dashboard` (user 계정)
- 제출 시험 드롭다운 선택
- 채점 전이면 `아직 평가되지 않았습니다` 표시
- 채점 완료이면 객관식/코딩 결과 표시

### 4) 테스트 데이터 정리 명령 (가상 사용자 + load-* 시험)
```bash
docker exec infra-postgres-1 psql -U qa_lab -d qa_lab -c "DELETE FROM exams WHERE title LIKE 'load-%' OR title LIKE 'invalid-choice-%' OR title = 'test' OR title LIKE 'auto-grade-e2e-%' OR title LIKE 'upload-test-%' OR title LIKE 'republish-src-%' OR title LIKE 'republished-%' OR title LIKE 'leak-check-%'; DELETE FROM users WHERE username LIKE 'vu%';"
```


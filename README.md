# QA Lab Monorepo

Next.js(App Router) + FastAPI + Docker Compose ê¸°ë°˜ QA ì„œë¹„ìŠ¤ì…ë‹ˆë‹¤.  
í˜„ì¬ êµ¬ì¡°ëŠ” **ì‹œí—˜ì§€(Exam) ì „ìš©**ì´ë©°, ë ˆê±°ì‹œ `problems/submissions/run-public` íë¦„ì€ ì œê±°ë˜ì—ˆìŠµë‹ˆë‹¤.

## êµ¬ì„±
- `apps/web`: Next.js í”„ë¡ íŠ¸ì—”ë“œ
- `apps/api`: FastAPI ë°±ì—”ë“œ
- `docker-compose.yml`: í†µí•© ì‹¤í–‰

## ë¹ ë¥¸ ì‹œì‘ (ë¡œì»¬)

### 1) API ì‹¤í–‰
```bash
cd apps/api
python -m venv .venv
. .venv/Scripts/Activate.ps1
python -m pip install -r requirements.txt
alembic upgrade head
fastapi dev main.py
```

### 2) Web ì‹¤í–‰
```bash
cd apps/web
pnpm install
pnpm dev
```

### 3) ì ‘ì†
- Web: `http://localhost:3000`
- API Docs: `http://127.0.0.1:8000/docs`

## Docker ì‹¤í–‰
```bash
docker compose up -d --build
docker compose ps
```

ê¸°ë³¸ í¬íŠ¸:
- Web: `http://localhost:3000`
- API: `http://localhost:8000`

## ê¸°ë³¸ ê³„ì •
- ê´€ë¦¬ì: `admin` / `admin1234`
- ì‚¬ìš©ì: `user` / `user1234`

## ì£¼ìš” ì‚¬ìš©ì í™”ë©´
- ì‹œí—˜ ëª©ë¡: `/problems`
- ì‹œí—˜ ì‘ì‹œ: `/problems/{examId}`
- ë‚´ ì œì¶œ ë‚´ì—­: `/submissions`
- ê´€ë¦¬ì ì‹œí—˜ ê´€ë¦¬: `/admin/problems`

## í˜„ì¬ API (ì‹œí—˜ì§€ ì „ìš©)

### ì¸ì¦
- `POST /auth/login`
- `POST /auth/logout`
- `POST /auth/register`
- `POST /auth/password/forgot`
- `POST /auth/password/reset`
- `GET /me`

### ì‹œí—˜ì§€
- ê´€ë¦¬ì
  - `POST /admin/exams`
  - `GET /admin/exams`
  - `GET /admin/exams/{exam_id}/submissions`
- ì‚¬ìš©ì
  - `GET /exams`
  - `GET /exams/{exam_id}`
  - `POST /exams/{exam_id}/submit`
  - `GET /me/exam-submissions`

### ê¸°íƒ€ ìš´ì˜
- `GET /health`
- `GET /health/db`
- `GET /health/redis`
- `GET /admin/health`
- `GET /admin/ops/summary`
- `POST /admin/watchdog/requeue-stale`
- `GET /admin/audit-logs`

## í…ŒìŠ¤íŠ¸

### API ë‹¨ìœ„ í…ŒìŠ¤íŠ¸
```bash
apps/api/.venv/Scripts/pytest.exe -q apps/api/tests/unit
```

### API E2E í…ŒìŠ¤íŠ¸
```bash
apps/api/.venv/Scripts/pytest.exe -q apps/api/tests/e2e/test_full_stack_e2e.py
```

### Web ë¹Œë“œ
```bash
pnpm --filter web build
```

### Web E2E (Playwright)
```bash
cd apps/web
pnpm test:e2e
```

## ì°¸ê³ 
- ì‹œí—˜ì§€ ì¹´í…Œê³ ë¦¬ëŠ” `problem-folders`ë¥¼ ì‚¬ìš©í•©ë‹ˆë‹¤.
- í”„ë¡ íŠ¸ëŠ” `/api/*` Next Route Handlerë¥¼ í†µí•´ FastAPIì™€ í†µì‹ í•©ë‹ˆë‹¤.

## Runtime Env Notes
- Web server-side API calls use `FASTAPI_INTERNAL_URL` first, then `FASTAPI_BASE_URL`.
- Local run (PowerShell):
```powershell
$env:FASTAPI_INTERNAL_URL="http://127.0.0.1:8000"
cd apps/web
pnpm dev
```

## È¸¿ø°¡ÀÔ/·Î±×ÀÎ ÀÔ·Â°ª
- È¸¿ø°¡ÀÔ: ¾ÆÀÌµğ, ÀÌ¸§, Æ®·¢, ºñ¹Ğ¹øÈ£, ºñ¹Ğ¹øÈ£ È®ÀÎ
- ·Î±×ÀÎ: ¾ÆÀÌµğ, ºñ¹Ğ¹øÈ£
- Æ®·¢ ¼±ÅÃ ¿É¼Ç: `µ¥ÀÌÅÍ ºĞ¼® 11±â`, `QAQC 4±â`

## ¸¶ÀÌ±×·¹ÀÌ¼Ç ¹İ¿µ
±âÁ¸ DB¸¦ »ç¿ëÇÏ´Â °æ¿ì ¾Æ·¡ ¸í·ÉÀ¸·Î ÃÖ½Å ½ºÅ°¸¶/µ¥ÀÌÅÍ Á¤¸®¸¦ ¹İ¿µÇÏ¼¼¿ä.
```bash
cd apps/api
alembic upgrade head
```

## Exam Resources (2026-02-20)
- Admin can upload files per exam at `/admin/problems`.
- Students can download uploaded files at `/problems/{examId}`.
- Objective analytics now show per-choice counts and responder names.

### New API endpoints
- GET /admin/exams/{exam_id}/resources
- POST /admin/exams/{exam_id}/resources
- GET /exams/{exam_id}/resources
- GET /exams/{exam_id}/resources/{resource_id}/download

### New API env vars
- EXAM_RESOURCE_ROOT (default: ./var/bundles/exam-resources)
- EXAM_RESOURCE_MAX_SIZE_BYTES (default: 20971520)

# MVP Scope (Frozen)

작성일: 2026-02-19  
목표: 데이터 분석 부트캠프 수강생용 QA Lab의 첫 출시 범위를 고정한다.

## 1) MVP 목표
- 학생이 문제를 열고 코드를 제출하면 자동 채점 결과를 확인할 수 있다.
- 학생이 제출 전 `Run public tests`로 공개 테스트를 빠르게 확인할 수 있다.
- 관리자(강사/운영자)가 문제/버전/번들을 관리하고 재채점할 수 있다.
- 학생 성취도(스킬 기반 mastery)를 대시보드에서 확인할 수 있다.

## 2) MVP 포함 범위 (In)
- 인증/권한: JWT 로그인, 쿠키 세션 유지, RBAC(admin/student)
- 문제은행:
  - Skill, Problem, ProblemVersion
  - 번들 Zip 업로드/저장/안전 추출(Zip Slip 방어)
- 채점:
  - 제출 생성/조회
  - Redis(RQ) 비동기 처리
  - Docker 기반 grader 실행(보안 옵션 적용)
  - grade/grade_runs 저장 및 재채점 이력
- 학생 기능:
  - 문제 조회(목록/상세)
  - Submit
  - Run public tests
  - 내 제출 목록
  - /me/progress 성취도 조회 + 대시보드 표시
- 품질:
  - GitHub Actions에서 API E2E + Playwright E2E 통과
  - smoke test로 grader 실행 검증

## 3) MVP 제외 범위 (Out)
- 멀티 코스/멀티 테넌트
- 결제/수강권/조직 관리
- 실시간 협업 편집기
- LLM 기반 자동 피드백 고도화
- 복수 언어 grader(우선 Python 1개)
- 대규모 트래픽용 오토스케일/멀티 리전

## 4) 출시 판정 기준 (Definition of Done)
- CI 기본 파이프라인이 연속 3회 green
- 관리자 시나리오:
  - 문제 생성 -> 버전 생성 -> 번들 업로드 -> 제출 채점 성공
- 학생 시나리오:
  - 로그인 -> 문제 열기 -> Run public tests 성공
  - 로그인 -> 제출 -> QUEUED/RUNNING/GRADED 전환 및 점수 확인
- 보안 필수:
  - grader `--network none`, `--read-only`, `--cap-drop ALL` 등 적용
  - hidden 테스트 상세 노출 금지

## 5) 변경 통제 규칙 (Scope Freeze Rule)
- MVP 기간에는 신규 기능 추가를 금지한다.
- 예외는 아래 2가지로 제한:
  - 릴리스 차단 버그
  - 보안 리스크
- 신규 아이디어는 `Post-MVP Backlog`에만 기록하고 MVP 종료 후 반영한다.

## 6) Post-MVP Backlog (초안)
- 과목/코호트 단위 운영 기능
- 문제 추천/개인화 학습 경로
- 채점 언어 확장(Python 외)
- 관측성 대시보드 고도화(Tracing, SLA)
- 운영자용 분석 리포트(주간/월간)

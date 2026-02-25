# MVP Scope (Frozen)

작성일: 2026-02-19  
목표: QA Lab 첫 릴리스 범위를 고정합니다.

## MVP 목표
- 학생이 문제를 열고 코드를 제출하면 채점 결과를 확인할 수 있어야 합니다.
- 제출 전 `Run public tests`로 공개 테스트를 확인할 수 있어야 합니다.
- 관리자가 문제/버전/번들을 관리하고 재채점할 수 있어야 합니다.
- 학생은 대시보드에서 스킬 기반 성취도(mastery)를 볼 수 있어야 합니다.

## MVP 포함 범위 (In)
- 인증/권한: JWT 로그인, 쿠키 세션, RBAC(admin/student)
- 문제은행: Skill, Problem, ProblemVersion, 번들 Zip 업로드/안전 추출
- 채점: 제출 생성/조회, Redis(RQ) 비동기 처리, Docker grader 실행, grade/grade_runs 저장
- 학생 기능: 문제 조회, Submit, Run public tests, 내 제출 목록, `/me/progress`
- 품질: GitHub Actions에서 API E2E + Playwright E2E + smoke 테스트

## MVP 제외 범위 (Out)
- 멀티 코스/멀티 테넌트
- 결제/수강권/조직 관리
- 실시간 협업 편집기
- 고도화된 자동 피드백
- 복수 언어 grader(우선 Python 1개)
- 오토스케일/멀티 리전

## 출시 판정 기준 (DoD)
- CI 파이프라인 3회 연속 green
- 관리자 시나리오: 문제 생성 -> 버전 생성 -> 번들 업로드 -> 채점 성공
- 학생 시나리오: 로그인 -> Run public tests -> 제출 -> 점수 확인
- 보안 필수 설정: grader 네트워크 차단/읽기전용/권한 최소화 적용

## 변경 통제 규칙
MVP 기간에는 신규 기능을 추가하지 않습니다.

예외는 아래 2가지뿐입니다.
- 릴리스 차단 버그
- 보안 리스크

새 아이디어는 `Post-MVP Backlog`에 기록하고 MVP 종료 후 진행합니다.

## Post-MVP Backlog (초안)
- 코호트/과목 단위 운영 기능
- 개인화 추천/학습 경로
- 채점 언어 확장
- 관측성 대시보드 고도화
- 운영자용 분석 리포트

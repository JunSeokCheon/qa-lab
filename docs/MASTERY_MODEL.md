# Mastery Model (Frozen)

작성일: 2026-02-19  
적용 API: `GET /me/progress`

## 1) 핵심 정의
- skill mastery는 학생의 제출 채점 결과를 skill weight로 가중합해 계산한다.
- 계산은 학생 단위(user)로 누적된다.
- 점수는 `grades`(최신 점수) 기준을 사용한다.

## 2) 계산식
- `earned_points += grade.score * weight`
- `possible_points += grade.max_score * weight`
- `mastery = (earned_points / possible_points) * 100`
- `possible_points == 0` 이면 `mastery = 0`
- 응답의 mastery는 소수점 둘째 자리 반올림(`round(..., 2)`)

## 3) 데이터 소스
- `submissions` (학생 제출)
- `grades` (제출의 최신 점수)
- `problem_version_skills` (문제 버전별 skill 가중치)
- `skills` (스킬 메타데이터)

## 4) 응답 규칙
- 모든 skill을 반환한다. 제출 이력이 없는 skill도 `0점`으로 포함된다.
- `skills` 배열은 mastery 내림차순으로 정렬한다.
- `recent_submissions`는 최신 10개를 반환한다.

## 5) 변경 통제
- 계산식/반올림/정렬 규칙 변경은 MVP 기간 중 금지한다.
- 변경 필요 시:
1. `docs/MASTERY_MODEL.md` 업데이트
2. `apps/api/tests/e2e/test_full_stack_e2e.py`의 mastery 시나리오 갱신
3. README 실행/검증 절차 갱신

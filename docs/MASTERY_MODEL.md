# Mastery Model (Frozen)

작성일: 2026-02-19  
적용 API: `GET /me/progress`

## 핵심 정의
- mastery는 제출 점수를 skill weight로 가중합해 계산합니다.
- 계산 단위는 사용자(user) 기준 누적입니다.
- 점수 소스는 `grades`의 최신 점수를 사용합니다.

## 계산식
- `earned_points += grade.score * weight`
- `possible_points += grade.max_score * weight`
- `mastery = (earned_points / possible_points) * 100`
- `possible_points == 0`이면 `mastery = 0`
- 응답 mastery는 소수점 둘째 자리 반올림(`round(..., 2)`)

## 데이터 소스
- `submissions`
- `grades`
- `problem_version_skills`
- `skills`

## 응답 규칙
- 모든 skill을 반환합니다.
- 제출 이력이 없는 skill도 `0점`으로 포함합니다.
- `skills` 배열은 mastery 내림차순 정렬합니다.
- `recent_submissions`는 최신 10개를 반환합니다.

## 변경 통제
MVP 기간에는 계산식/반올림/정렬 규칙을 바꾸지 않습니다.

규칙 변경이 필요하면 아래 3가지를 같이 반영합니다.
1. `docs/MASTERY_MODEL.md` 업데이트
2. `apps/api/tests/e2e/test_full_stack_e2e.py` mastery 시나리오 업데이트
3. `README.md` 실행/검증 절차 업데이트

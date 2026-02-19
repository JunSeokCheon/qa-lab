# Design System Guide (MVP)

작성일: 2026-02-19

## 목표
- 학습 제품에 맞는 명확한 시각 계층을 제공한다.
- 페이지마다 다른 스타일이 생기지 않도록 토큰/컴포넌트를 재사용한다.

## 토큰
- 전역 토큰 파일: `apps/web/app/globals.css`
- 핵심 토큰:
  - 색상: `--primary`, `--surface`, `--surface-muted`, `--hero`
  - 반경: `--radius`
  - 상태: `--destructive`, `--muted-foreground`

## 공통 레이아웃 클래스
- `.qa-shell`: 페이지 컨테이너
- `.qa-card`: 기본 카드/패널
- `.qa-kicker`: 섹션 라벨(상단 작은 타이포)

## 공통 UI 컴포넌트
- 버튼: `apps/web/components/ui/button.tsx`
- 인풋: `apps/web/components/ui/input.tsx`
- 텍스트영역: `apps/web/components/ui/textarea.tsx`

## 화면 규칙
- 페이지는 `qa-shell`로 감싸고 주요 블록은 `qa-card`를 사용한다.
- 입력 폼은 공통 `Input`, `Textarea`, `Button`을 우선 사용한다.
- 상태 메시지:
  - 에러: `text-destructive`
  - 보조 설명: `text-muted-foreground`

## 변경 규칙
- 새 UI 컴포넌트 추가 전:
  - 기존 `ui/*`로 해결 가능한지 먼저 검토
  - 새 컴포넌트가 필요한 이유를 한 줄로 기록
- 색상/라운드 등 디자인 토큰 변경 시:
  - `globals.css` 토큰만 변경하고 개별 페이지 하드코딩은 피한다.

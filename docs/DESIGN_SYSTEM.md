# Design System Guide (MVP)

작성일: 2026-02-19

## 목적
- 페이지마다 스타일이 달라지지 않도록 기본 규칙을 고정합니다.
- 토큰과 공용 컴포넌트 중심으로 UI를 유지합니다.

## 디자인 토큰
- 위치: `apps/web/app/globals.css`
- 주요 토큰:
  - 색상: `--primary`, `--surface`, `--surface-muted`, `--hero`
  - 반경: `--radius`
  - 상태: `--destructive`, `--muted-foreground`

## 공통 레이아웃 클래스
- `.qa-shell`: 페이지 컨테이너
- `.qa-card`: 카드/패널
- `.qa-kicker`: 섹션 상단 작은 라벨

## 공용 UI 컴포넌트
- 버튼: `apps/web/components/ui/button.tsx`
- 입력: `apps/web/components/ui/input.tsx`
- 텍스트영역: `apps/web/components/ui/textarea.tsx`

## 사용 규칙
- 페이지 바깥은 `qa-shell`, 주요 블록은 `qa-card`를 기본으로 사용
- 입력폼은 가급적 `ui/*` 컴포넌트를 우선 사용
- 상태 텍스트:
  - 에러: `text-destructive`
  - 보조 설명: `text-muted-foreground`

## 변경 규칙
- 새 컴포넌트를 만들기 전, 기존 `ui/*`로 해결 가능한지 먼저 확인
- 새 컴포넌트가 필요하면 이유를 한 줄로 기록
- 색상/반경 등 전역 스타일 변경은 `globals.css` 토큰에서 처리

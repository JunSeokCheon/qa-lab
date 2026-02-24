"use client";

import { useMemo, useState } from "react";

import { formatDateTimeKST } from "@/lib/datetime";

type QuestionResult = {
  question_id: number;
  question_order: number;
  question_type: string;
  prompt_preview: string;
  verdict: "correct" | "incorrect" | "pending" | "review_pending";
  skill_keywords: string[];
};

type ExamResult = {
  submission_id: number;
  exam_id: number;
  exam_title: string;
  exam_kind: string;
  status: string;
  submitted_at: string;
  objective_total: number;
  objective_answered: number;
  objective_correct: number;
  objective_pending: number;
  objective_incorrect: number;
  subjective_total: number;
  subjective_correct: number;
  subjective_incorrect: number;
  subjective_pending: number;
  coding_total: number;
  coding_graded: number;
  coding_failed: number;
  coding_pending: number;
  coding_correct: number;
  coding_incorrect: number;
  coding_review_pending: number;
  coding_score: number | null;
  coding_max_score: number | null;
  has_subjective: boolean;
  grading_ready: boolean;
  results_published: boolean;
  results_published_at: string | null;
  overall_total: number;
  overall_correct: number;
  overall_incorrect: number;
  overall_pending: number;
  strong_skill_keywords: string[];
  weak_skill_keywords: string[];
  question_results: QuestionResult[];
};

function examKindLabel(kind: string): string {
  if (kind === "quiz") return "퀴즈";
  if (kind === "assessment") return "성취도 평가";
  return kind;
}

function statusLabel(status: string): string {
  if (status === "QUEUED") return "채점 대기";
  if (status === "RUNNING") return "채점 중";
  if (status === "GRADED") return "채점 완료";
  if (status === "FAILED") return "채점 실패";
  if (status === "SUBMITTED") return "제출 완료";
  return status;
}

function questionTypeLabel(type: string): string {
  if (type === "multiple_choice") return "객관식";
  if (type === "subjective") return "주관식";
  if (type === "coding") return "코딩";
  return type;
}

function verdictBadgeStyle(verdict: QuestionResult["verdict"]): string {
  if (verdict === "correct") return "bg-emerald-100 text-emerald-800";
  if (verdict === "incorrect") return "bg-rose-100 text-rose-800";
  if (verdict === "review_pending") return "bg-amber-100 text-amber-800";
  return "bg-muted text-muted-foreground";
}

function verdictLabel(verdict: QuestionResult["verdict"]): string {
  if (verdict === "correct") return "정답";
  if (verdict === "incorrect") return "오답";
  if (verdict === "review_pending") return "검토 필요";
  return "미채점";
}

function ratioText(correct: number, total: number): string {
  if (total <= 0) return "0.0";
  return ((correct / total) * 100).toFixed(1);
}

export function UserExamResultDashboard({ results }: { results: ExamResult[] }) {
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<number | null>(results[0]?.submission_id ?? null);

  const selected = useMemo(
    () => results.find((item) => item.submission_id === selectedSubmissionId) ?? null,
    [results, selectedSubmissionId]
  );

  if (results.length === 0) {
    return (
      <section className="qa-card">
        <h2 className="text-xl font-semibold">시험 결과</h2>
        <p className="mt-3 text-sm text-muted-foreground">아직 제출한 시험이 없습니다.</p>
      </section>
    );
  }

  return (
    <section className="qa-card space-y-4">
      <h2 className="text-xl font-semibold">시험 결과</h2>
      <select
        className="h-11 w-full rounded-xl border border-border/70 bg-background/80 px-3 text-sm"
        value={selectedSubmissionId ?? ""}
        onChange={(event) => {
          const next = Number(event.target.value);
          setSelectedSubmissionId(Number.isFinite(next) ? next : null);
        }}
      >
        {results.map((item) => (
          <option key={item.submission_id} value={item.submission_id}>
            {item.exam_title} ({examKindLabel(item.exam_kind)})
          </option>
        ))}
      </select>

      {selected ? (
        <article className="rounded-2xl border border-border/70 bg-surface p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">{selected.exam_title}</p>
            <p className="text-xs text-muted-foreground">{formatDateTimeKST(selected.submitted_at)}</p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">상태: {statusLabel(selected.status)}</p>

          {!selected.grading_ready ? (
            <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-800">
              {selected.status === "GRADED" && !selected.results_published
                ? "채점은 완료되었지만 관리자가 아직 결과를 공유하지 않았습니다."
                : "아직 채점 중입니다. 관리자 채점 완료 후 결과가 표시됩니다."}
            </div>
          ) : (
            <>
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border border-border/70 bg-background p-3">
                  <p className="text-xs text-muted-foreground">객관식</p>
                  <p className="mt-1 text-lg font-semibold">
                    {selected.objective_correct} / {selected.objective_total}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    오답 {selected.objective_incorrect}, 미채점 {selected.objective_pending} | 정답률{" "}
                    {ratioText(selected.objective_correct, selected.objective_total)}%
                  </p>
                </div>

                <div className="rounded-xl border border-border/70 bg-background p-3">
                  <p className="text-xs text-muted-foreground">주관식</p>
                  <p className="mt-1 text-lg font-semibold">
                    {selected.subjective_correct} / {selected.subjective_total}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    오답 {selected.subjective_incorrect}, 미채점 {selected.subjective_pending} | 정답률{" "}
                    {ratioText(selected.subjective_correct, selected.subjective_total)}%
                  </p>
                </div>

                <div className="rounded-xl border border-border/70 bg-background p-3">
                  <p className="text-xs text-muted-foreground">코딩</p>
                  <p className="mt-1 text-lg font-semibold">
                    {selected.coding_correct} / {selected.coding_total}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    오답 {selected.coding_incorrect}, 미채점 {selected.coding_pending + selected.coding_review_pending} |
                    정답률 {ratioText(selected.coding_correct, selected.coding_total)}%
                  </p>
                </div>

                <div className="rounded-xl border border-border/70 bg-background p-3">
                  <p className="text-xs text-muted-foreground">전체 문항</p>
                  <p className="mt-1 text-lg font-semibold">
                    {selected.overall_correct} / {selected.overall_total}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    오답 {selected.overall_incorrect}, 미채점 {selected.overall_pending} | 정답률{" "}
                    {ratioText(selected.overall_correct, selected.overall_total)}%
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-border/70 bg-background p-3">
                <p className="font-medium">문항별 정답 여부</p>
                <div className="mt-2 space-y-2">
                  {selected.question_results.length === 0 ? (
                    <p className="text-xs text-muted-foreground">문항 결과 데이터가 없습니다.</p>
                  ) : (
                    selected.question_results
                      .slice()
                      .sort((a, b) => a.question_order - b.question_order)
                      .map((question) => (
                        <div
                          key={`${selected.submission_id}:${question.question_id}`}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-surface-muted px-3 py-2"
                        >
                          <p className="min-w-0 flex-1 text-xs font-medium text-foreground">
                            {question.question_order}번 ({questionTypeLabel(question.question_type)})
                          </p>
                          <span
                            className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${verdictBadgeStyle(question.verdict)}`}
                          >
                            {verdictLabel(question.verdict)}
                          </span>
                        </div>
                      ))
                  )}
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-border/70 bg-background p-3">
                <p className="font-medium">이 시험 기준 강점/보완 영역</p>
                <div className="mt-2 grid gap-3 md:grid-cols-2">
                  <div>
                    <p className="text-xs text-muted-foreground">강한 영역</p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {selected.strong_skill_keywords.length > 0 ? (
                        selected.strong_skill_keywords.map((keyword) => (
                          <span
                            key={`strong-${selected.submission_id}-${keyword}`}
                            className="inline-flex rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-medium text-emerald-800"
                          >
                            {keyword}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground">아직 강점 키워드가 충분하지 않습니다.</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">보완이 필요한 영역</p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {selected.weak_skill_keywords.length > 0 ? (
                        selected.weak_skill_keywords.map((keyword) => (
                          <span
                            key={`weak-${selected.submission_id}-${keyword}`}
                            className="inline-flex rounded-full bg-rose-100 px-2 py-1 text-[11px] font-medium text-rose-800"
                          >
                            {keyword}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground">현재 보완 키워드는 없습니다.</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </article>
      ) : null}
    </section>
  );
}

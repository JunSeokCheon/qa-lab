"use client";

import { useMemo, useState } from "react";

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
  coding_total: number;
  coding_graded: number;
  coding_failed: number;
  coding_pending: number;
  coding_score: number | null;
  coding_max_score: number | null;
  has_subjective: boolean;
  grading_ready: boolean;
  results_published: boolean;
  results_published_at: string | null;
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

  const objectiveAccuracy =
    selected && selected.objective_total > 0
      ? ((selected.objective_correct / selected.objective_total) * 100).toFixed(1)
      : "0.0";

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
            #{item.submission_id} {item.exam_title} ({examKindLabel(item.exam_kind)})
          </option>
        ))}
      </select>

      {selected ? (
        <article className="rounded-2xl border border-border/70 bg-surface p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">{selected.exam_title}</p>
            <p className="text-xs text-muted-foreground">{new Date(selected.submitted_at).toLocaleString()}</p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">상태: {statusLabel(selected.status)}</p>

          {!selected.grading_ready ? (
            <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-800">
              {selected.status === "GRADED" && !selected.results_published
                ? "채점은 완료되었지만, 관리자가 아직 결과를 공유하지 않았습니다."
                : "아직 평가되지 않았습니다. 관리자 자동 채점이 완료되면 결과가 표시됩니다."}
            </div>
          ) : (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-border/70 bg-background p-3">
                <p className="text-xs text-muted-foreground">객관식</p>
                <p className="mt-1 text-lg font-semibold">
                  {selected.objective_correct} / {selected.objective_total}
                </p>
                <p className="text-xs text-muted-foreground">정답률 {objectiveAccuracy}%</p>
              </div>

              <div className="rounded-xl border border-border/70 bg-background p-3">
                <p className="text-xs text-muted-foreground">코딩 자동채점</p>
                {selected.coding_total === 0 ? (
                  <p className="mt-1 text-sm">코딩 문항 없음</p>
                ) : (
                  <>
                    <p className="mt-1 text-lg font-semibold">
                      {selected.coding_score ?? 0} / {selected.coding_max_score ?? 0}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      완료 {selected.coding_graded}, 실패 {selected.coding_failed}, 대기 {selected.coding_pending}
                    </p>
                  </>
                )}
              </div>
            </div>
          )}

          {selected.has_subjective ? (
            <p className="mt-3 text-xs text-muted-foreground">
              주관식 문항은 자동 채점이 아니므로 별도 검토가 필요할 수 있습니다.
            </p>
          ) : null}
        </article>
      ) : null}
    </section>
  );
}

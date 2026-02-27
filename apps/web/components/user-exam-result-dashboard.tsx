"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { formatDateTimeKST } from "@/lib/datetime";

type QuestionResult = {
  question_id: number;
  question_order: number;
  question_type: string;
  prompt_preview: string;
  verdict: "correct" | "incorrect" | "pending" | "review_pending";
  skill_keywords: string[];
  appeal_pending: boolean;
  appeal_count: number;
  latest_appeal_reason: string | null;
  latest_appeal_requested_at: string | null;
  latest_appeal_requested_by_user_id: number | null;
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

type AppealSubmitResponse = {
  submission_id?: number;
  exam_id?: number;
  question_id?: number;
  appeal_pending?: boolean;
  appeal_count?: number;
  requested_at?: string;
  message?: string;
  detail?: string;
};

type AppealModalState = {
  submissionId: number;
  question: QuestionResult;
};

function examKindLabel(kind: string): string {
  if (kind === "quiz") return "퀴즈";
  if (kind === "assessment") return "과제평가";
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

function extractInlineCodeSnippets(text: string): string[] {
  const snippets: string[] = [];
  const matches = text.matchAll(/`([^`]+)`/g);
  for (const match of matches) {
    const snippet = match[1]?.trim();
    if (!snippet) continue;
    snippets.push(snippet);
  }
  return snippets;
}

function stripInlineCodeMarks(text: string): string {
  return text.replace(/`([^`]+)`/g, "$1").replace(/\s+/g, " ").trim();
}

export function UserExamResultDashboard({ results }: { results: ExamResult[] }) {
  const [items, setItems] = useState(results);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<number | null>(results[0]?.submission_id ?? null);
  const [appealModal, setAppealModal] = useState<AppealModalState | null>(null);
  const [appealReason, setAppealReason] = useState("");
  const [appealRunning, setAppealRunning] = useState(false);
  const [appealError, setAppealError] = useState("");
  const [appealMessage, setAppealMessage] = useState("");

  const selected = useMemo(
    () => items.find((item) => item.submission_id === selectedSubmissionId) ?? null,
    [items, selectedSubmissionId],
  );

  const openAppealModal = (submissionId: number, question: QuestionResult) => {
    setAppealError("");
    setAppealMessage("");
    setAppealReason(question.latest_appeal_reason ?? "");
    setAppealModal({ submissionId, question });
  };

  const submitAppeal = async () => {
    if (!appealModal) return;

    setAppealRunning(true);
    setAppealError("");
    setAppealMessage("");

    try {
      const response = await fetch(`/api/me/exam-submissions/${appealModal.submissionId}/appeals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question_id: appealModal.question.question_id,
          reason: appealReason.trim() || null,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as AppealSubmitResponse;
      if (!response.ok) {
        setAppealError(payload.detail ?? payload.message ?? "정정 신청 전송에 실패했습니다.");
        return;
      }

      const submissionId = Number(payload.submission_id ?? appealModal.submissionId);
      const questionId = Number(payload.question_id ?? appealModal.question.question_id);
      const requestedAt = payload.requested_at ?? new Date().toISOString();

      setItems((prev) =>
        prev.map((exam) => {
          if (exam.submission_id !== submissionId) return exam;
          return {
            ...exam,
            question_results: exam.question_results.map((question) => {
              if (question.question_id !== questionId) return question;
              return {
                ...question,
                appeal_pending: payload.appeal_pending ?? true,
                appeal_count: payload.appeal_count ?? question.appeal_count + 1,
                latest_appeal_reason: appealReason.trim() || null,
                latest_appeal_requested_at: requestedAt,
              };
            }),
          };
        }),
      );

      setAppealMessage(payload.message ?? "정정 신청이 접수되었습니다.");
      setAppealModal(null);
      setAppealReason("");
    } catch {
      setAppealError("정정 신청 전송 중 오류가 발생했습니다.");
    } finally {
      setAppealRunning(false);
    }
  };

  if (items.length === 0) {
    return (
      <section className="qa-card">
        <h2 className="text-xl font-semibold">시험 결과</h2>
        <p className="mt-3 text-sm text-muted-foreground">아직 제출한 시험이 없습니다.</p>
      </section>
    );
  }

  return (
    <>
      <section className="qa-card space-y-4">
        <h2 className="text-xl font-semibold">시험 결과</h2>
        {appealError ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{appealError}</p> : null}
        {appealMessage ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{appealMessage}</p> : null}
        <select
          className="h-11 w-full rounded-xl border border-border/70 bg-background/80 px-3 text-sm"
          value={selectedSubmissionId ?? ""}
          onChange={(event) => {
            const next = Number(event.target.value);
            setSelectedSubmissionId(Number.isFinite(next) ? next : null);
          }}
        >
          {items.map((item) => (
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
                      오답 {selected.objective_incorrect}, 미채점 {selected.objective_pending} | 정답률 {" "}
                      {ratioText(selected.objective_correct, selected.objective_total)}%
                    </p>
                  </div>

                  <div className="rounded-xl border border-border/70 bg-background p-3">
                    <p className="text-xs text-muted-foreground">주관식</p>
                    <p className="mt-1 text-lg font-semibold">
                      {selected.subjective_correct} / {selected.subjective_total}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      오답 {selected.subjective_incorrect}, 미채점 {selected.subjective_pending} | 정답률 {" "}
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
                      오답 {selected.overall_incorrect}, 미채점 {selected.overall_pending} | 정답률 {" "}
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
                            className="rounded-lg border border-border/70 bg-surface-muted px-3 py-2"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="min-w-0 flex-1 text-xs font-medium text-foreground">
                                {question.question_order}번 ({questionTypeLabel(question.question_type)})
                              </p>
                              <div className="flex items-center gap-2">
                                <span
                                  className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${verdictBadgeStyle(question.verdict)}`}
                                >
                                  {verdictLabel(question.verdict)}
                                </span>
                                {question.appeal_pending ? (
                                  <span className="inline-flex shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                                    정정 처리중
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                              <p className="text-[11px] text-muted-foreground">
                                {question.latest_appeal_requested_at
                                  ? `최근 정정 신청: ${formatDateTimeKST(question.latest_appeal_requested_at)}`
                                  : "정정 신청 이력이 없습니다."}
                              </p>
                              <Button
                                type="button"
                                variant="outline"
                                className="h-7 px-2 text-[11px]"
                                onClick={() => openAppealModal(selected.submission_id, question)}
                                disabled={question.appeal_pending}
                              >
                                {question.appeal_pending ? "처리중" : "정정 신청"}
                              </Button>
                            </div>
                          </div>
                        ))
                    )}
                  </div>
                </div>

                <div className="mt-4 rounded-xl border border-border/70 bg-background p-3">
                  <p className="font-medium">시험 기준 강점/보완 영역</p>
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

      {appealModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-lg rounded-2xl border border-border/70 bg-card p-5 shadow-xl">
            <h3 className="text-lg font-semibold">정정 신청</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {appealModal.question.question_order}번 문항 ({questionTypeLabel(appealModal.question.question_type)})
            </p>
            {appealModal.question.question_type === "coding" ? (
              <div className="mt-1 space-y-2 rounded-md bg-surface-muted p-2">
                <p className="text-xs text-muted-foreground">
                  {stripInlineCodeMarks(appealModal.question.prompt_preview)}
                </p>
                <pre className="max-h-40 overflow-auto rounded-md border border-border/70 bg-background px-3 py-2 font-mono text-[12px] leading-5">
                  <code>
                    {extractInlineCodeSnippets(appealModal.question.prompt_preview)[0] ??
                      appealModal.question.prompt_preview}
                  </code>
                </pre>
              </div>
            ) : (
              <p className="mt-1 rounded-md bg-surface-muted p-2 text-xs text-muted-foreground">
                {appealModal.question.prompt_preview}
              </p>
            )}
            <label className="mt-3 block text-sm font-medium">정정 사유 (선택)</label>
            <textarea
              className="mt-1 min-h-28 w-full rounded-xl border border-border/70 bg-background/80 p-3 text-sm"
              value={appealReason}
              onChange={(event) => setAppealReason(event.target.value)}
              maxLength={1000}
              placeholder="예: 채점 기준과 다른 근거가 있다고 생각되는 부분을 작성해 주세요."
              disabled={appealRunning}
            />
            <p className="mt-1 text-right text-[11px] text-muted-foreground">{appealReason.length}/1000</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (appealRunning) return;
                  setAppealModal(null);
                }}
                disabled={appealRunning}
              >
                취소
              </Button>
              <Button type="button" onClick={() => void submitAppeal()} disabled={appealRunning}>
                {appealRunning ? "전송 중..." : "정정 신청 보내기"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}


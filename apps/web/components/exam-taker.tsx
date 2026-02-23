"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type QuestionItem = {
  id: number;
  order_index: number;
  type: string;
  prompt_md: string;
  required: boolean;
  choices: string[] | null;
};

type AnswerState = {
  answer_text?: string;
  selected_choice_index?: number;
};

export type MyExamSubmissionAnswer = {
  question_id: number;
  question_order: number;
  question_type: string;
  prompt_md: string;
  choices: string[] | null;
  correct_choice_index: number | null;
  answer_key_text: string | null;
  answer_text: string | null;
  selected_choice_index: number | null;
  grading_status: string | null;
  grading_score: number | null;
  grading_max_score: number | null;
  grading_feedback_json: Record<string, unknown> | null;
  graded_at: string | null;
};

export type MyExamSubmissionDetail = {
  submission_id: number;
  exam_id: number;
  exam_title: string;
  status: string;
  submitted_at: string;
  results_published: boolean;
  results_published_at: string | null;
  answers: MyExamSubmissionAnswer[];
};

function formatTimer(totalSeconds: number): string {
  const safeSeconds = Math.max(0, totalSeconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function statusLabel(status: string): string {
  if (status === "GRADED") return "채점 완료";
  if (status === "QUEUED") return "채점 대기";
  if (status === "RUNNING") return "채점 진행 중";
  if (status === "FAILED") return "채점 실패";
  if (status === "SUBMITTED") return "제출 완료";
  return status;
}

function selectedChoiceText(answer: MyExamSubmissionAnswer): string {
  if (answer.selected_choice_index === null) return "(미응답)";
  const choices = answer.choices ?? [];
  const index = answer.selected_choice_index;
  const choiceText = choices[index] ?? "(선택지 없음)";
  return `${index + 1}번 - ${choiceText}`;
}

function correctChoiceText(answer: MyExamSubmissionAnswer): string {
  if (answer.correct_choice_index === null) return "(정답 미설정)";
  const choices = answer.choices ?? [];
  const index = answer.correct_choice_index;
  const choiceText = choices[index] ?? "(선택지 없음)";
  return `${index + 1}번 - ${choiceText}`;
}

export function ExamTaker({
  examId,
  questions,
  submitted,
  durationMinutes,
  initialRemainingSeconds,
  initialSubmission,
}: {
  examId: number;
  questions: QuestionItem[];
  submitted: boolean;
  durationMinutes: number | null;
  initialRemainingSeconds: number | null;
  initialSubmission: MyExamSubmissionDetail | null;
}) {
  const [answers, setAnswers] = useState<Record<number, AnswerState>>({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(submitted ? "이미 제출한 시험입니다." : "");
  const [loading, setLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(submitted);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [submissionDetail, setSubmissionDetail] = useState<MyExamSubmissionDetail | null>(initialSubmission);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(
    typeof initialRemainingSeconds === "number" ? Math.max(0, initialRemainingSeconds) : null
  );

  const requiredCount = useMemo(() => questions.filter((question) => question.required).length, [questions]);
  const isTimeLimited = durationMinutes !== null && remainingSeconds !== null;
  const isExpired = isTimeLimited && remainingSeconds <= 0 && !isSubmitted;

  useEffect(() => {
    if (!isTimeLimited || isSubmitted) return;
    if ((remainingSeconds ?? 0) <= 0) return;

    const timer = window.setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev === null || prev <= 1) return 0;
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isSubmitted, isTimeLimited, remainingSeconds]);

  const displayError = isExpired ? "시험 시간이 종료되었습니다. 제출이 제한됩니다." : error;

  const setTextAnswer = (questionId: number, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: { ...prev[questionId], answer_text: value } }));
  };

  const setChoiceAnswer = (questionId: number, value: number) => {
    setAnswers((prev) => ({ ...prev, [questionId]: { ...prev[questionId], selected_choice_index: value } }));
  };

  const fetchMySubmissionDetail = async () => {
    const response = await fetch(`/api/exams/${examId}/my-submission`, { cache: "no-store" });
    const body = (await response.json().catch(() => ({}))) as MyExamSubmissionDetail & {
      detail?: string;
      message?: string;
    };
    if (!response.ok || !body.submission_id) {
      return body.detail ?? body.message ?? "제출 상세를 불러오지 못했습니다.";
    }
    setSubmissionDetail(body);
    return null;
  };

  const submitExam = async () => {
    if (isSubmitted || isExpired) return;
    setLoading(true);
    setError("");
    setSuccess("");
    setShowSubmitConfirm(false);

    const payload = {
      answers: questions.map((question) => ({
        question_id: question.id,
        answer_text: answers[question.id]?.answer_text?.trim() || undefined,
        selected_choice_index: answers[question.id]?.selected_choice_index,
      })),
    };

    const response = await fetch(`/api/exams/${examId}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await response.json().catch(() => ({}))) as { detail?: string; message?: string };
    if (!response.ok) {
      setError(body.detail ?? body.message ?? "시험 제출에 실패했습니다.");
      setLoading(false);
      return;
    }

    setSuccess("시험이 제출되었습니다.");
    setIsSubmitted(true);
    const detailError = await fetchMySubmissionDetail();
    if (detailError) {
      setError(detailError);
    }
    setLoading(false);
  };

  return (
    <section className="qa-card space-y-4">
      <div className="rounded-xl bg-surface-muted p-3 text-xs text-muted-foreground">
        <p>필수 문항: {requiredCount}개</p>
        <p>제출 후에는 수정할 수 없습니다.</p>
        <p>시험 시간: {durationMinutes === null ? "제한 없음" : `${durationMinutes}분`}</p>
        {isTimeLimited ? (
          <p className={isExpired ? "font-semibold text-destructive" : "font-semibold text-primary"}>
            남은 시간: {formatTimer(remainingSeconds ?? 0)}
          </p>
        ) : null}
      </div>

      {isSubmitted && submissionDetail ? (
        <article className="space-y-3 rounded-2xl border border-border/70 bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">내 제출 답안</h2>
            <p className="text-xs text-muted-foreground">{new Date(submissionDetail.submitted_at).toLocaleString()}</p>
          </div>
          <p className="text-xs text-muted-foreground">
            제출 상태: {statusLabel(submissionDetail.status)}
            {submissionDetail.results_published
              ? ` | 점수 공개됨${submissionDetail.results_published_at ? ` (${new Date(submissionDetail.results_published_at).toLocaleString()})` : ""}`
              : " | 점수 비공개(관리자 공유 대기)"}
          </p>
          <div className="space-y-3">
            {submissionDetail.answers.map((answer) => (
              <article key={answer.question_id} className="rounded-xl border border-border/70 bg-background p-3 text-sm">
                <p className="font-semibold">
                  {answer.question_order}. {answer.prompt_md}
                </p>
                {answer.question_type === "multiple_choice" ? (
                  <div className="mt-2 space-y-2 text-xs">
                    <p>
                      <span className="font-medium">내 답안:</span> {selectedChoiceText(answer)}
                    </p>
                    <p>
                      <span className="font-medium">정답:</span> {correctChoiceText(answer)}
                    </p>
                  </div>
                ) : (
                  <div className="mt-2 space-y-2 text-xs">
                    <div>
                      <p className="font-medium">내 제출 답안</p>
                      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-surface-muted p-2">
                        {answer.answer_text?.trim() ? answer.answer_text : "(미응답)"}
                      </pre>
                    </div>
                    <div>
                      <p className="font-medium">정답 기준</p>
                      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-surface-muted p-2">
                        {answer.answer_key_text?.trim() ? answer.answer_key_text : "(정답 기준 없음)"}
                      </pre>
                    </div>
                    <p>
                      <span className="font-medium">채점 상태:</span> {statusLabel(answer.grading_status ?? "SUBMITTED")}
                    </p>
                    {submissionDetail.results_published && answer.grading_score !== null && answer.grading_max_score !== null ? (
                      <p>
                        <span className="font-medium">점수:</span> {answer.grading_score} / {answer.grading_max_score}
                      </p>
                    ) : null}
                  </div>
                )}
              </article>
            ))}
          </div>
        </article>
      ) : null}

      {!isSubmitted ? (
        <>
          {questions.map((question) => (
            <article key={question.id} className="rounded-2xl border border-border/70 bg-surface p-4">
              <p className="text-sm font-semibold">
                {question.order_index}. {question.prompt_md} {question.required ? "*" : ""}
              </p>

              {question.type === "multiple_choice" ? (
                <div className="mt-3 space-y-2">
                  {(question.choices ?? []).map((choice, index) => (
                    <label key={`${question.id}-${index}`} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name={`question-${question.id}`}
                        checked={answers[question.id]?.selected_choice_index === index}
                        onChange={() => setChoiceAnswer(question.id, index)}
                        disabled={loading || isExpired}
                      />
                      <span>{choice}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <Textarea
                  className="mt-3 min-h-28"
                  value={answers[question.id]?.answer_text ?? ""}
                  onChange={(event) => setTextAnswer(question.id, event.target.value)}
                  placeholder={question.type === "coding" ? "코드 또는 풀이를 입력하세요." : "답안을 입력하세요."}
                  disabled={loading || isExpired}
                />
              )}
            </article>
          ))}

          {displayError ? <p className="text-sm text-destructive">{displayError}</p> : null}
          {success ? <p className="text-sm text-emerald-700">{success}</p> : null}
          <Button type="button" onClick={() => setShowSubmitConfirm(true)} disabled={loading || isExpired}>
            {loading ? "제출 중..." : "시험 제출"}
          </Button>
        </>
      ) : null}

      {showSubmitConfirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-border/70 bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold">시험 제출 확인</h3>
            <p className="mt-2 text-sm text-muted-foreground">시험지를 제출하시겠습니까?</p>
            <p className="mt-1 text-xs text-muted-foreground">제출하면 다시 응시할 수 없습니다.</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowSubmitConfirm(false)} disabled={loading}>
                취소
              </Button>
              <Button type="button" onClick={() => void submitExam()} disabled={loading}>
                최종 제출
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

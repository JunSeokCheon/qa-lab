"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";

import { MarkdownContent } from "@/components/markdown-content";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTimeKST } from "@/lib/datetime";

type QuestionItem = {
  id: number;
  order_index: number;
  type: string;
  prompt_md: string;
  required: boolean;
  multiple_select?: boolean;
  choices: string[] | null;
  image_resource_id: number | null;
  image_resource_ids?: number[];
};

type AnswerState = {
  answer_text?: string;
  selected_choice_indexes?: number[];
};

export type MyExamSubmissionAnswer = {
  question_id: number;
  question_order: number;
  question_type: string;
  prompt_md: string;
  choices: string[] | null;
  image_resource_id: number | null;
  image_resource_ids?: number[];
  correct_choice_index: number | null;
  correct_choice_indexes: number[];
  answer_key_text: string | null;
  answer_text: string | null;
  selected_choice_index: number | null;
  selected_choice_indexes: number[];
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

function questionTypeLabel(type: string): string {
  if (type === "multiple_choice") return "객관식";
  if (type === "subjective") return "주관식";
  if (type === "coding") return "코딩";
  return type;
}

function normalizeChoiceIndexes(rawIndexes: number[] | undefined | null): number[] {
  if (!Array.isArray(rawIndexes)) return [];
  const unique = Array.from(new Set(rawIndexes.filter((value) => Number.isInteger(value))));
  return unique.sort((a, b) => a - b);
}

function selectedChoiceText(answer: MyExamSubmissionAnswer): string {
  const selectedIndexes = normalizeChoiceIndexes(
    answer.selected_choice_indexes.length > 0
      ? answer.selected_choice_indexes
      : answer.selected_choice_index === null
        ? []
        : [answer.selected_choice_index]
  );
  if (selectedIndexes.length === 0) return "(미응답)";
  const choices = answer.choices ?? [];
  return selectedIndexes
    .map((index) => `${index + 1}번 - ${choices[index] ?? "(선택지 없음)"}`)
    .join(", ");
}

function correctChoiceText(answer: MyExamSubmissionAnswer): string {
  const correctIndexes = normalizeChoiceIndexes(
    answer.correct_choice_indexes.length > 0
      ? answer.correct_choice_indexes
      : answer.correct_choice_index === null
        ? []
        : [answer.correct_choice_index]
  );
  if (correctIndexes.length === 0) return "(정답 미설정)";
  const choices = answer.choices ?? [];
  return correctIndexes
    .map((index) => `${index + 1}번 - ${choices[index] ?? "(선택지 없음)"}`)
    .join(", ");
}

function questionImageUrl(examId: number, imageResourceId: number | null | undefined): string | null {
  if (typeof imageResourceId !== "number") return null;
  return `/api/exams/${examId}/resources/${imageResourceId}/download?inline=1`;
}

function questionImageUrls(
  examId: number,
  imageResourceIds: number[] | undefined,
  imageResourceId: number | null | undefined
): string[] {
  const normalizedIds = Array.isArray(imageResourceIds) ? imageResourceIds : [];
  const urls = normalizedIds
    .filter((resourceId) => Number.isInteger(resourceId))
    .map((resourceId) => questionImageUrl(examId, resourceId))
    .filter((url): url is string => typeof url === "string");
  if (urls.length > 0) return urls;
  const fallback = questionImageUrl(examId, imageResourceId);
  return fallback ? [fallback] : [];
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
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<number, AnswerState>>({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(submitted ? "이미 제출한 시험입니다." : "");
  const [loading, setLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(submitted);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [answerEditorQuestionId, setAnswerEditorQuestionId] = useState<number | null>(null);
  const [submissionDetail] = useState<MyExamSubmissionDetail | null>(initialSubmission);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(
    typeof initialRemainingSeconds === "number" ? Math.max(0, initialRemainingSeconds) : null
  );
  const finalSubmitButtonRef = useRef<HTMLButtonElement | null>(null);
  const answerEditorQuestion = questions.find((question) => question.id === answerEditorQuestionId) ?? null;

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

  useEffect(() => {
    if (isSubmitted) return;

    const refreshSession = () =>
      fetch("/api/auth/refresh", {
        method: "POST",
        cache: "no-store",
      }).catch(() => null);

    const interval = window.setInterval(() => {
      void refreshSession();
    }, 5 * 60 * 1000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshSession();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    void refreshSession();

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [isSubmitted]);

  useEffect(() => {
    if (!showSubmitConfirm && !answerEditorQuestion) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [showSubmitConfirm, answerEditorQuestion]);

  useEffect(() => {
    if (!showSubmitConfirm) return;
    window.scrollTo({ top: 0, behavior: "smooth" });
    const timer = window.setTimeout(() => finalSubmitButtonRef.current?.focus(), 120);
    return () => window.clearTimeout(timer);
  }, [showSubmitConfirm]);

  const displayError = isExpired ? "시험 시간이 종료되었습니다. 제출이 제한됩니다." : error;

  const setTextAnswer = (questionId: number, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: { ...prev[questionId], answer_text: value } }));
  };

  const toggleChoiceAnswer = (questionId: number, value: number, multipleSelect: boolean) => {
    setAnswers((prev) => {
      const currentIndexes = normalizeChoiceIndexes(prev[questionId]?.selected_choice_indexes);
      const nextIndexes = multipleSelect
        ? currentIndexes.includes(value)
          ? currentIndexes.filter((index) => index !== value)
          : normalizeChoiceIndexes([...currentIndexes, value])
        : [value];
      return {
        ...prev,
        [questionId]: {
          ...prev[questionId],
          selected_choice_indexes: nextIndexes,
        },
      };
    });
  };

  const openAnswerEditor = (questionId: number) => {
    setAnswerEditorQuestionId(questionId);
  };

  const submitExam = async () => {
    if (isSubmitted || isExpired) return;
    setLoading(true);
    setError("");
    setSuccess("");
    setShowSubmitConfirm(false);

    const payload = {
      answers: questions.map((question) => ({
        selected_choice_indexes: normalizeChoiceIndexes(answers[question.id]?.selected_choice_indexes),
        question_id: question.id,
        answer_text: answers[question.id]?.answer_text?.trim() || undefined,
        selected_choice_index: normalizeChoiceIndexes(answers[question.id]?.selected_choice_indexes)[0],
      })),
    };

    await fetch("/api/auth/refresh", {
      method: "POST",
      cache: "no-store",
    }).catch(() => null);

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

    setSuccess("시험이 제출되었습니다. 시험 목록으로 이동합니다.");
    setIsSubmitted(true);
    setAnswerEditorQuestionId(null);
    setLoading(false);
    router.push("/problems");
    router.refresh();
  };

  return (
    <section className="qa-card space-y-4">
      <div className="rounded-xl bg-surface-muted p-3 text-xs text-muted-foreground">
        <p>필수 문항: {requiredCount}개</p>
        <p>제출 후에는 수정할 수 없습니다.</p>
        {durationMinutes !== null ? <p>시험 시간: {durationMinutes}분</p> : null}
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
            <p className="text-xs text-muted-foreground">{formatDateTimeKST(submissionDetail.submitted_at)}</p>
          </div>
          <p className="text-xs text-muted-foreground">
            제출 상태: {statusLabel(submissionDetail.status)}
            {submissionDetail.results_published
              ? ` | 점수 공개됨${submissionDetail.results_published_at ? ` (${formatDateTimeKST(submissionDetail.results_published_at)})` : ""}`
              : " | 점수 비공개(관리자 공유 대기)"}
          </p>
          <div className="space-y-3">
            {submissionDetail.answers.map((answer) => (
              <article key={answer.question_id} className="rounded-xl border border-border/70 bg-background p-3 text-sm">
                <div className="font-semibold">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span>{answer.question_order}.</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                      {questionTypeLabel(answer.question_type)}
                    </span>
                  </div>
                  {questionImageUrls(examId, answer.image_resource_ids, answer.image_resource_id).map((imageUrl, imageIndex) => (
                    <div
                      key={`${answer.question_id}-${imageUrl}-${imageIndex}`}
                      className="mb-2 overflow-hidden rounded-xl border border-border/70 bg-surface-muted/30"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={imageUrl}
                        alt={`문항 ${answer.question_order} 이미지 ${imageIndex + 1}`}
                        loading="lazy"
                        className="h-auto max-h-[30rem] w-full object-contain bg-background"
                      />
                    </div>
                  ))}
                  <MarkdownContent content={answer.prompt_md} />
                </div>
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
          {questions.map((question) => {
            const selectedChoiceIndexes = normalizeChoiceIndexes(answers[question.id]?.selected_choice_indexes);
            return (
              <article key={question.id} className="rounded-2xl border border-border/70 bg-surface p-4">
              <div className="text-sm font-semibold">
                <div className="mb-1 flex items-center gap-2">
                  <span>{question.order_index}.</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                    {questionTypeLabel(question.type)}
                  </span>
                  {question.required ? (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                      필수
                    </span>
                  ) : null}
                </div>
                {questionImageUrls(examId, question.image_resource_ids, question.image_resource_id).map(
                  (imageUrl, imageIndex) => (
                    <div
                      key={`${question.id}-${imageUrl}-${imageIndex}`}
                      className="mb-2 overflow-hidden rounded-xl border border-border/70 bg-surface-muted/30"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={imageUrl}
                        alt={`문항 ${question.order_index} 이미지 ${imageIndex + 1}`}
                        loading="lazy"
                        className="h-auto max-h-[30rem] w-full object-contain bg-background"
                      />
                    </div>
                  )
                )}
                <MarkdownContent content={question.prompt_md} />
              </div>

              {question.type === "multiple_choice" ? (
                <div className="mt-3 space-y-2">
                  {question.multiple_select ? (
                    <p className="text-xs text-muted-foreground">복수 정답 문항입니다. 정답이라고 생각하는 선택지를 모두 고르세요.</p>
                  ) : null}
                  {(question.choices ?? []).map((choice, index) => (
                    <label key={`${question.id}-${index}`} className="flex items-center gap-2 text-sm">
                      <input
                        type={question.multiple_select ? "checkbox" : "radio"}
                        name={`question-${question.id}`}
                        checked={selectedChoiceIndexes.includes(index)}
                        onChange={() => toggleChoiceAnswer(question.id, index, Boolean(question.multiple_select))}
                        disabled={loading || isExpired}
                      />
                      <span>{choice}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="mt-3 rounded-xl border border-border/70 bg-surface-muted p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">긴 답안은 큰 입력창에서 작성해 주세요.</p>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-8 px-3 text-xs"
                      onClick={() => openAnswerEditor(question.id)}
                      disabled={loading || isExpired}
                    >
                      정답 입력
                    </Button>
                  </div>
                  <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-background p-2 text-xs leading-5">
                    {(answers[question.id]?.answer_text ?? "").trim() || "(아직 입력한 답안이 없습니다.)"}
                  </pre>
                </div>
              )}
              </article>
            );
          })}

          {displayError ? <p className="text-sm text-destructive">{displayError}</p> : null}
          {success ? <p className="text-sm text-emerald-700">{success}</p> : null}
          <Button type="button" onClick={() => setShowSubmitConfirm(true)} disabled={loading || isExpired}>
            {loading ? "제출 중..." : "시험 제출"}
          </Button>
        </>
      ) : null}

      {typeof document !== "undefined"
        ? createPortal(
            <>
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
              <Button ref={finalSubmitButtonRef} type="button" onClick={() => void submitExam()} disabled={loading}>
                최종 제출
              </Button>
            </div>
          </div>
        </div>
              ) : null}

              {answerEditorQuestion ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-5xl overflow-hidden rounded-3xl border border-border/70 bg-white shadow-2xl">
            <div className="border-b border-border/70 px-5 py-4">
              <h3 className="text-lg font-semibold">문항 {answerEditorQuestion.order_index} 답안 입력</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {answerEditorQuestion.type === "coding"
                  ? "코딩 답안을 길게 입력하거나 수정할 수 있습니다."
                  : "주관식 답안을 길게 입력하거나 수정할 수 있습니다."}
              </p>
            </div>
            <div className="p-5">
              <Textarea
                className={`min-h-[55vh] ${
                  answerEditorQuestion.type === "coding" ? "font-mono text-xs leading-5" : "text-sm leading-6"
                }`}
                value={answers[answerEditorQuestion.id]?.answer_text ?? ""}
                onChange={(event) => setTextAnswer(answerEditorQuestion.id, event.target.value)}
                placeholder={answerEditorQuestion.type === "coding" ? "코드 또는 풀이를 입력하세요." : "답안을 입력하세요."}
                disabled={loading || isExpired}
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-border/70 bg-muted/30 px-5 py-4">
              <Button type="button" variant="outline" onClick={() => setAnswerEditorQuestionId(null)} disabled={loading}>
                닫기
              </Button>
            </div>
          </div>
        </div>
              ) : null}
            </>,
            document.body
          )
        : null}
    </section>
  );
}

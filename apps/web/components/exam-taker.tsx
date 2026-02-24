"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

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
  if (answer.selected_choice_index === null) return "(誘몄쓳??";
  const choices = answer.choices ?? [];
  const index = answer.selected_choice_index;
  const choiceText = choices[index] ?? "(?좏깮吏 ?놁쓬)";
  return `${index + 1}踰?- ${choiceText}`;
}

function correctChoiceText(answer: MyExamSubmissionAnswer): string {
  if (answer.correct_choice_index === null) return "(?뺣떟 誘몄꽕??";
  const choices = answer.choices ?? [];
  const index = answer.correct_choice_index;
  const choiceText = choices[index] ?? "(?좏깮吏 ?놁쓬)";
  return `${index + 1}踰?- ${choiceText}`;
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
  const [success, setSuccess] = useState(submitted ? "?대? ?쒖텧???쒗뿕?낅땲??" : "");
  const [loading, setLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(submitted);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [answerEditor, setAnswerEditor] = useState<{ questionId: number; draft: string } | null>(null);
  const [submissionDetail] = useState<MyExamSubmissionDetail | null>(initialSubmission);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(
    typeof initialRemainingSeconds === "number" ? Math.max(0, initialRemainingSeconds) : null
  );
  const finalSubmitButtonRef = useRef<HTMLButtonElement | null>(null);

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
    if (!showSubmitConfirm) return;
    window.setTimeout(() => {
      finalSubmitButtonRef.current?.focus();
      finalSubmitButtonRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);
  }, [showSubmitConfirm]);

  const displayError = isExpired ? "?쒗뿕 ?쒓컙??醫낅즺?섏뿀?듬땲?? ?쒖텧???쒗븳?⑸땲??" : error;

  const setTextAnswer = (questionId: number, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: { ...prev[questionId], answer_text: value } }));
  };

  const setChoiceAnswer = (questionId: number, value: number) => {
    setAnswers((prev) => ({ ...prev, [questionId]: { ...prev[questionId], selected_choice_index: value } }));
  };

  const openAnswerEditor = (question: QuestionItem) => {
    setAnswerEditor({
      questionId: question.id,
      draft: answers[question.id]?.answer_text ?? "",
    });
  };

  const saveAnswerEditor = () => {
    if (!answerEditor) return;
    setTextAnswer(answerEditor.questionId, answerEditor.draft);
    setAnswerEditor(null);
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
      setError(body.detail ?? body.message ?? "?쒗뿕 ?쒖텧???ㅽ뙣?덉뒿?덈떎.");
      setLoading(false);
      return;
    }

    setSuccess("?쒗뿕???쒖텧?섏뿀?듬땲??");
    setIsSubmitted(true);
    router.replace("/problems");
    router.refresh();
    setLoading(false);
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
            <h2 className="text-base font-semibold">???쒖텧 ?듭븞</h2>
            <p className="text-xs text-muted-foreground">{formatDateTimeKST(submissionDetail.submitted_at)}</p>
          </div>
          <p className="text-xs text-muted-foreground">
            제출 상태: {statusLabel(submissionDetail.status)}
            {submissionDetail.results_published
              ? ` | 점수 공개${submissionDetail.results_published_at ? ` (${formatDateTimeKST(submissionDetail.results_published_at)})` : ""}`
              : " | 점수 비공개 (관리자 공유 대기)"}
          </p>
          <div className="space-y-3">
            {submissionDetail.answers.map((answer) => (
              <article key={answer.question_id} className="rounded-xl border border-border/70 bg-background p-3 text-sm">
                <div className="font-semibold">
                  <span>{answer.question_order}. </span>
                  <MarkdownContent content={answer.prompt_md} />
                </div>
                {answer.question_type === "multiple_choice" ? (
                  <div className="mt-2 space-y-2 text-xs">
                    <p>
                      <span className="font-medium">???듭븞:</span> {selectedChoiceText(answer)}
                    </p>
                    <p>
                      <span className="font-medium">?뺣떟:</span> {correctChoiceText(answer)}
                    </p>
                  </div>
                ) : (
                  <div className="mt-2 space-y-2 text-xs">
                    <div>
                      <p className="font-medium">???쒖텧 ?듭븞</p>
                      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-surface-muted p-2">
                        {answer.answer_text?.trim() ? answer.answer_text : "(誘몄쓳??"}
                      </pre>
                    </div>
                    <div>
                      <p className="font-medium">?뺣떟 湲곗?</p>
                      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-surface-muted p-2">
                        {answer.answer_key_text?.trim() ? answer.answer_key_text : "(?뺣떟 湲곗? ?놁쓬)"}
                      </pre>
                    </div>
                    <p>
                      <span className="font-medium">梨꾩젏 ?곹깭:</span> {statusLabel(answer.grading_status ?? "SUBMITTED")}
                    </p>
                    {submissionDetail.results_published && answer.grading_score !== null && answer.grading_max_score !== null ? (
                      <p>
                        <span className="font-medium">?먯닔:</span> {answer.grading_score} / {answer.grading_max_score}
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
              <div className="text-sm font-semibold">
                <span>{question.order_index}. </span>
                <MarkdownContent content={question.prompt_md} />
                {question.required ? <span className="ml-1">*</span> : null}
              </div>

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
                <div className="mt-3 space-y-2">
                  <div className="rounded-xl border border-border/70 bg-background/80 p-2">
                    <p className="text-[11px] font-medium text-muted-foreground">현재 입력된 답안</p>
                    <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap rounded bg-surface-muted p-2 text-xs">
                      {answers[question.id]?.answer_text?.trim()
                        ? answers[question.id]?.answer_text
                        : "(아직 작성된 답안이 없습니다)"}
                    </pre>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 px-3 text-xs"
                    onClick={() => openAnswerEditor(question)}
                    disabled={loading || isExpired}
                  >
                    큰 화면으로 답안 작성
                  </Button>
                </div>
              )}
            </article>
          ))}

          {displayError ? <p className="text-sm text-destructive">{displayError}</p> : null}
          {success ? <p className="text-sm text-emerald-700">{success}</p> : null}
          <Button type="button" onClick={() => setShowSubmitConfirm(true)} disabled={loading || isExpired}>
            {loading ? "?쒖텧 以?.." : "?쒗뿕 ?쒖텧"}
          </Button>
        </>
      ) : null}

      {showSubmitConfirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-border/70 bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold">?쒗뿕 ?쒖텧 ?뺤씤</h3>
            <p className="mt-2 text-sm text-muted-foreground">?쒗뿕吏瑜??쒖텧?섏떆寃좎뒿?덇퉴?</p>
            <p className="mt-1 text-xs text-muted-foreground">?쒖텧?섎㈃ ?ㅼ떆 ?묒떆?????놁뒿?덈떎.</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowSubmitConfirm(false)} disabled={loading}>
                痍⑥냼
              </Button>
              <Button type="button" onClick={() => void submitExam()} disabled={loading} ref={finalSubmitButtonRef}>
                理쒖쥌 ?쒖텧
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {answerEditor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-4xl rounded-2xl border border-border/70 bg-card p-5 shadow-xl">
            <h3 className="text-lg font-semibold">답안 작성</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              긴 코드/서술형 답안을 큰 입력창에서 작성한 뒤 저장하세요.
            </p>
            <Textarea
              className="mt-3 min-h-[55vh] text-xs leading-6"
              value={answerEditor.draft}
              onChange={(event) => setAnswerEditor((prev) => (prev ? { ...prev, draft: event.target.value } : prev))}
              placeholder="답안을 입력하세요."
              disabled={loading || isExpired}
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setAnswerEditor(null)} disabled={loading || isExpired}>
                취소
              </Button>
              <Button type="button" onClick={saveAnswerEditor} disabled={loading || isExpired}>
                저장
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

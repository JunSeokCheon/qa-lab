"use client";

import { useMemo, useState } from "react";

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

export function ExamTaker({
  examId,
  questions,
  submitted,
}: {
  examId: number;
  questions: QuestionItem[];
  submitted: boolean;
}) {
  const [answers, setAnswers] = useState<Record<number, AnswerState>>({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(submitted ? "이미 제출한 시험입니다." : "");
  const [loading, setLoading] = useState(false);

  const requiredCount = useMemo(() => questions.filter((question) => question.required).length, [questions]);

  const setTextAnswer = (questionId: number, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: { ...prev[questionId], answer_text: value } }));
  };

  const setChoiceAnswer = (questionId: number, value: number) => {
    setAnswers((prev) => ({ ...prev, [questionId]: { ...prev[questionId], selected_choice_index: value } }));
  };

  const onSubmit = async () => {
    if (submitted) return;
    setLoading(true);
    setError("");
    setSuccess("");

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

    setSuccess("시험이 제출되었습니다. 채점은 관리자 검토 후 진행됩니다.");
    setLoading(false);
  };

  return (
    <section className="qa-card space-y-4">
      <div className="rounded-xl bg-surface-muted p-3 text-xs text-muted-foreground">
        <p>필수 문항: {requiredCount}개</p>
        <p>제출 후에는 수정할 수 없습니다.</p>
      </div>

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
                    disabled={submitted || loading}
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
              disabled={submitted || loading}
            />
          )}
        </article>
      ))}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-700">{success}</p> : null}
      <Button type="button" onClick={onSubmit} disabled={submitted || loading}>
        {loading ? "제출 중..." : "시험 제출"}
      </Button>
    </section>
  );
}

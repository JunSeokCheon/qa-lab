"use client";

import { useState, type FormEvent } from "react";

import { BackButton } from "@/components/back-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Folder = { id: number; path: string };
type ExamSummary = {
  id: number;
  title: string;
  exam_kind: string;
  question_count: number;
  folder_path: string | null;
  status: string;
};
type ExamSubmission = {
  submission_id: number;
  exam_id: number;
  exam_title: string;
  user_id: number;
  username: string;
  status: string;
  submitted_at: string;
  answers: Array<{
    question_id: number;
    question_order: number;
    question_type: string;
    prompt_md: string;
    answer_text: string | null;
    selected_choice_index: number | null;
  }>;
};

type QuestionType = "multiple_choice" | "subjective" | "coding";

type DraftQuestion = {
  key: number;
  type: QuestionType;
  prompt_md: string;
  required: boolean;
  choicesText: string;
};

function examKindLabel(kind: string): string {
  if (kind === "quiz") return "퀴즈";
  if (kind === "assessment") return "성취도 평가";
  return kind;
}

export function AdminExamBuilder({
  initialFolders,
  initialExams,
}: {
  initialFolders: Folder[];
  initialExams: ExamSummary[];
}) {
  const [folders] = useState(initialFolders);
  const [exams, setExams] = useState(initialExams);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [folderId, setFolderId] = useState(initialFolders[0] ? String(initialFolders[0].id) : "");
  const [examKind, setExamKind] = useState<"quiz" | "assessment">("quiz");
  const [questions, setQuestions] = useState<DraftQuestion[]>([
    { key: 1, type: "multiple_choice", prompt_md: "", required: true, choicesText: "선택지 1\n선택지 2" },
  ]);
  const [activeExamId, setActiveExamId] = useState<number | null>(null);
  const [submissionRows, setSubmissionRows] = useState<ExamSubmission[]>([]);

  const updateQuestion = (key: number, patch: Partial<DraftQuestion>) => {
    setQuestions((prev) => prev.map((question) => (question.key === key ? { ...question, ...patch } : question)));
  };

  const addQuestion = () => {
    setQuestions((prev) => [
      ...prev,
      { key: Date.now(), type: "subjective", prompt_md: "", required: true, choicesText: "" },
    ]);
  };

  const removeQuestion = (key: number) => {
    setQuestions((prev) => (prev.length > 1 ? prev.filter((question) => question.key !== key) : prev));
  };

  const refreshExams = async () => {
    const response = await fetch("/api/admin/exams", { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    const payload = (await response.json().catch(() => [])) as ExamSummary[];
    setExams(payload);
  };

  const loadSubmissions = async (examId: number) => {
    setError("");
    const response = await fetch(`/api/admin/exams/${examId}/submissions`, { cache: "no-store" });
    const payload = (await response.json().catch(() => [])) as ExamSubmission[] | { detail?: string; message?: string };
    if (!response.ok) {
      const messagePayload = payload as { detail?: string; message?: string };
      setError(messagePayload.detail ?? messagePayload.message ?? "제출 결과를 불러오지 못했습니다.");
      return;
    }
    setActiveExamId(examId);
    setSubmissionRows(payload as ExamSubmission[]);
  };

  const onCreateExam = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    const normalizedQuestions = questions.map((question) => {
      const choices =
        question.type === "multiple_choice"
          ? question.choicesText
              .split("\n")
              .map((value) => value.trim())
              .filter(Boolean)
          : null;
      return {
        type: question.type,
        prompt_md: question.prompt_md,
        required: question.required,
        choices,
      };
    });

    const response = await fetch("/api/admin/exams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        description: description || null,
        folder_id: folderId ? Number(folderId) : null,
        exam_kind: examKind,
        status: "published",
        questions: normalizedQuestions,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as { id?: number; detail?: string; message?: string };
    if (!response.ok || !payload.id) {
      setError(payload.detail ?? payload.message ?? "시험 생성에 실패했습니다.");
      setLoading(false);
      return;
    }

    setMessage(`시험이 생성되었습니다. (시험 ID: ${payload.id})`);
    setTitle("");
    setDescription("");
    setQuestions([{ key: Date.now(), type: "multiple_choice", prompt_md: "", required: true, choicesText: "선택지 1\n선택지 2" }]);
    await refreshExams();
    setLoading(false);
  };

  return (
    <main className="qa-shell space-y-6">
      <section className="qa-card">
        <BackButton fallbackHref="/admin" />
        <p className="qa-kicker">관리자</p>
        <h1 className="mt-2 text-3xl font-bold">시험지 관리</h1>
        <p className="mt-2 text-sm text-muted-foreground">구글 폼처럼 시험지와 문항을 한 번에 만들고 제출 결과를 확인합니다.</p>
      </section>

      {error ? <p className="qa-card text-sm text-destructive">{error}</p> : null}
      {message ? <p className="qa-card text-sm text-emerald-700">{message}</p> : null}

      <form className="qa-card space-y-4" onSubmit={onCreateExam}>
        <h2 className="text-lg font-semibold">시험지 생성</h2>
        <Input placeholder="시험 제목 (예: 파이썬 퀴즈)" value={title} onChange={(event) => setTitle(event.target.value)} required />
        <Textarea
          className="min-h-20"
          placeholder="설명 (선택)"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <div className="grid gap-3 md:grid-cols-2">
          <select
            className="h-11 w-full rounded-xl border border-border/70 bg-background/80 px-3 text-sm"
            value={folderId}
            onChange={(event) => setFolderId(event.target.value)}
          >
            <option value="">카테고리 선택 (선택)</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.path}
              </option>
            ))}
          </select>
          <select
            className="h-11 w-full rounded-xl border border-border/70 bg-background/80 px-3 text-sm"
            value={examKind}
            onChange={(event) => setExamKind(event.target.value as "quiz" | "assessment")}
          >
            <option value="quiz">퀴즈</option>
            <option value="assessment">성취도 평가</option>
          </select>
        </div>

        <div className="space-y-3">
          {questions.map((question, index) => (
            <article key={question.key} className="rounded-2xl border border-border/70 p-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">문항 {index + 1}</h3>
                <Button type="button" variant="outline" onClick={() => removeQuestion(question.key)}>
                  문항 삭제
                </Button>
              </div>
              <select
                className="h-11 w-full rounded-xl border border-border/70 bg-background/80 px-3 text-sm"
                value={question.type}
                onChange={(event) => updateQuestion(question.key, { type: event.target.value as QuestionType })}
              >
                <option value="multiple_choice">객관식</option>
                <option value="subjective">주관식</option>
                <option value="coding">코드 작성</option>
              </select>
              <Textarea
                className="mt-2 min-h-20"
                placeholder="문항 내용을 입력하세요."
                value={question.prompt_md}
                onChange={(event) => updateQuestion(question.key, { prompt_md: event.target.value })}
                required
              />
              {question.type === "multiple_choice" ? (
                <Textarea
                  className="mt-2 min-h-20"
                  placeholder={"선택지 1\n선택지 2\n선택지 3"}
                  value={question.choicesText}
                  onChange={(event) => updateQuestion(question.key, { choicesText: event.target.value })}
                />
              ) : null}
              <label className="mt-2 flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={question.required}
                  onChange={(event) => updateQuestion(question.key, { required: event.target.checked })}
                />
                필수 문항
              </label>
            </article>
          ))}
          <Button type="button" variant="outline" onClick={addQuestion}>
            문항 추가
          </Button>
        </div>

        <Button disabled={loading}>{loading ? "생성 중..." : "시험지 생성"}</Button>
      </form>

      <section className="qa-card space-y-3">
        <h2 className="text-lg font-semibold">생성된 시험</h2>
        {exams.length === 0 ? (
          <p className="text-sm text-muted-foreground">아직 생성된 시험이 없습니다.</p>
        ) : (
          <div className="grid gap-2">
            {exams.map((exam) => (
              <article key={exam.id} className="rounded-xl border border-border/70 bg-surface p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">
                    {exam.title} ({examKindLabel(exam.exam_kind)}) - {exam.question_count}문항
                  </p>
                  <Button type="button" variant="outline" onClick={() => void loadSubmissions(exam.id)}>
                    제출 보기
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {exam.folder_path ?? "미분류"} | 상태: {exam.status}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>

      {activeExamId ? (
        <section className="qa-card space-y-3">
          <h2 className="text-lg font-semibold">시험 #{activeExamId} 제출 결과</h2>
          {submissionRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">아직 제출이 없습니다.</p>
          ) : (
            <div className="space-y-2">
              {submissionRows.map((row) => (
                <article key={row.submission_id} className="rounded-xl border border-border/70 bg-surface p-3">
                  <p className="text-sm font-semibold">
                    {row.username} ({new Date(row.submitted_at).toLocaleString()})
                  </p>
                  <div className="mt-2 space-y-2">
                    {row.answers.map((answer) => (
                      <div key={`${row.submission_id}-${answer.question_id}`} className="rounded-lg bg-surface-muted p-2 text-xs">
                        <p>
                          {answer.question_order}. {answer.prompt_md}
                        </p>
                        <p className="mt-1 text-muted-foreground">
                          {answer.question_type === "multiple_choice"
                            ? `선택: ${answer.selected_choice_index === null ? "-" : answer.selected_choice_index + 1}번`
                            : `응답: ${answer.answer_text ?? "-"}`}
                        </p>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </main>
  );
}

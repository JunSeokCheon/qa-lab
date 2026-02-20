"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import { BackButton } from "@/components/back-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Folder = { id: number; path: string };
type ExamSummary = {
  id: number;
  title: string;
  description: string | null;
  folder_id: number | null;
  folder_path: string | null;
  exam_kind: string;
  status: string;
  question_count: number;
};
type QuestionType = "multiple_choice" | "subjective" | "coding";
type ExamQuestionDetail = {
  id: number;
  order_index: number;
  type: QuestionType;
  prompt_md: string;
  required: boolean;
  choices: string[] | null;
  correct_choice_index: number | null;
};
type ExamDetail = {
  id: number;
  title: string;
  description: string | null;
  folder_id: number | null;
  exam_kind: string;
  status: string;
  questions: ExamQuestionDetail[];
};
type DraftQuestion = {
  key: number;
  type: QuestionType;
  prompt_md: string;
  required: boolean;
  choices: string[];
  correctChoiceIndex: number;
};

function examKindLabel(kind: string): string {
  if (kind === "quiz") return "퀴즈";
  if (kind === "assessment") return "성취도 평가";
  return kind;
}

function toDraftQuestion(question: ExamQuestionDetail): DraftQuestion {
  const choices = question.type === "multiple_choice" ? [...(question.choices ?? [])] : ["", "", "", ""];
  while (choices.length < 4) choices.push("");
  return {
    key: question.id,
    type: question.type,
    prompt_md: question.prompt_md,
    required: question.required,
    choices: choices.slice(0, 4),
    correctChoiceIndex: question.correct_choice_index ?? 0,
  };
}

function newDraftQuestion(type: QuestionType): DraftQuestion {
  return {
    key: Date.now() + Math.floor(Math.random() * 1000),
    type,
    prompt_md: "",
    required: true,
    choices: ["", "", "", ""],
    correctChoiceIndex: 0,
  };
}

export function AdminExamListManager({
  initialFolders,
  initialExams,
}: {
  initialFolders: Folder[];
  initialExams: ExamSummary[];
}) {
  const [folders] = useState(initialFolders);
  const [exams, setExams] = useState(initialExams);
  const [selectedExamId, setSelectedExamId] = useState<number | null>(initialExams[0]?.id ?? null);

  const selectedExam = useMemo(
    () => exams.find((exam) => exam.id === selectedExamId) ?? null,
    [exams, selectedExamId]
  );

  const [detailLoading, setDetailLoading] = useState(false);
  const [savingMeta, setSavingMeta] = useState(false);
  const [republishing, setRepublishing] = useState(false);
  const [copyResources, setCopyResources] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [folderId, setFolderId] = useState("");
  const [examKind, setExamKind] = useState<"quiz" | "assessment">("quiz");
  const [status, setStatus] = useState<"draft" | "published">("published");
  const [questions, setQuestions] = useState<DraftQuestion[]>([]);

  useEffect(() => {
    if (!selectedExamId) return;
    setDetailLoading(true);
    setError("");
    void (async () => {
      const response = await fetch(`/api/admin/exams/${selectedExamId}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as ExamDetail & {
        detail?: string;
        message?: string;
      };
      if (!response.ok) {
        setError(payload.detail ?? payload.message ?? "시험 상세를 불러오지 못했습니다.");
        setDetailLoading(false);
        return;
      }

      setTitle(payload.title);
      setDescription(payload.description ?? "");
      setFolderId(payload.folder_id ? String(payload.folder_id) : "");
      setExamKind((payload.exam_kind as "quiz" | "assessment") ?? "quiz");
      setStatus((payload.status as "draft" | "published") ?? "published");
      setQuestions(payload.questions.map(toDraftQuestion));
      setDetailLoading(false);
    })();
  }, [selectedExamId]);

  const updateQuestion = (key: number, patch: Partial<DraftQuestion>) => {
    setQuestions((prev) => prev.map((question) => (question.key === key ? { ...question, ...patch } : question)));
  };

  const updateChoice = (key: number, index: number, value: string) => {
    setQuestions((prev) =>
      prev.map((question) => {
        if (question.key !== key) return question;
        const nextChoices = [...question.choices];
        nextChoices[index] = value;
        return { ...question, choices: nextChoices };
      })
    );
  };

  const addQuestion = (type: QuestionType) => {
    setQuestions((prev) => [...prev, newDraftQuestion(type)]);
  };

  const removeQuestion = (key: number) => {
    setQuestions((prev) => (prev.length > 1 ? prev.filter((question) => question.key !== key) : prev));
  };

  const onSaveMeta = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedExam) return;

    setError("");
    setMessage("");
    setSavingMeta(true);
    const response = await fetch(`/api/admin/exams/${selectedExam.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        description: description.trim() ? description.trim() : null,
        folder_id: folderId ? Number(folderId) : null,
        exam_kind: examKind,
        status,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      id?: number;
      title?: string;
      description?: string | null;
      folder_id?: number | null;
      folder_path?: string | null;
      exam_kind?: string;
      status?: string;
      question_count?: number;
      detail?: string;
      message?: string;
    };
    if (!response.ok || !payload.id) {
      setError(payload.detail ?? payload.message ?? "시험 메타 저장에 실패했습니다.");
      setSavingMeta(false);
      return;
    }

    setExams((prev) =>
      prev.map((row) =>
        row.id === selectedExam.id
          ? {
              ...row,
              title: payload.title ?? row.title,
              description: payload.description ?? null,
              folder_id: payload.folder_id ?? null,
              folder_path: payload.folder_path ?? row.folder_path,
              exam_kind: payload.exam_kind ?? row.exam_kind,
              status: payload.status ?? row.status,
              question_count: payload.question_count ?? row.question_count,
            }
          : row
      )
    );
    setMessage("시험 메타 정보를 저장했습니다.");
    setSavingMeta(false);
  };

  const onRepublish = async () => {
    if (!selectedExam) return;

    setError("");
    setMessage("");
    if (!title.trim()) {
      setError("시험 제목을 입력해 주세요.");
      return;
    }
    if (questions.length === 0) {
      setError("최소 1개 문항이 필요합니다.");
      return;
    }

    const normalizedQuestions = [];
    for (const question of questions) {
      if (!question.prompt_md.trim()) {
        setError("모든 문항 내용을 입력해 주세요.");
        return;
      }
      if (question.type === "multiple_choice") {
        const trimmedChoices = question.choices.map((choice) => choice.trim());
        if (trimmedChoices.some((choice) => !choice)) {
          setError("객관식은 1~4번 선택지 내용을 모두 입력해야 합니다.");
          return;
        }
        normalizedQuestions.push({
          type: "multiple_choice",
          prompt_md: question.prompt_md.trim(),
          required: question.required,
          choices: trimmedChoices,
          correct_choice_index: question.correctChoiceIndex,
        });
      } else {
        normalizedQuestions.push({
          type: question.type,
          prompt_md: question.prompt_md.trim(),
          required: question.required,
          choices: null,
          correct_choice_index: null,
        });
      }
    }

    setRepublishing(true);
    const response = await fetch(`/api/admin/exams/${selectedExam.id}/republish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        description: description.trim() ? description.trim() : null,
        folder_id: folderId ? Number(folderId) : null,
        exam_kind: examKind,
        status: "published",
        questions: normalizedQuestions,
        copy_resources: copyResources,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      id?: number;
      title?: string;
      description?: string | null;
      folder_id?: number | null;
      folder_path?: string | null;
      exam_kind?: string;
      status?: string;
      question_count?: number;
      detail?: string;
      message?: string;
    };
    if (!response.ok || !payload.id) {
      setError(payload.detail ?? payload.message ?? "재출제에 실패했습니다.");
      setRepublishing(false);
      return;
    }

    const newSummary: ExamSummary = {
      id: payload.id,
      title: payload.title ?? title.trim(),
      description: payload.description ?? (description.trim() ? description.trim() : null),
      folder_id: payload.folder_id ?? (folderId ? Number(folderId) : null),
      folder_path: payload.folder_path ?? null,
      exam_kind: payload.exam_kind ?? examKind,
      status: payload.status ?? "published",
      question_count: payload.question_count ?? questions.length,
    };
    setExams((prev) => [newSummary, ...prev]);
    setSelectedExamId(newSummary.id);
    setStatus("published");
    setMessage(`문항 수정본으로 새 시험을 출제했습니다. (새 ID: ${newSummary.id})`);
    setRepublishing(false);
  };

  return (
    <main className="qa-shell space-y-6">
      <section className="qa-card">
        <BackButton fallbackHref="/admin" />
        <p className="qa-kicker mt-4">관리자</p>
        <h1 className="mt-2 text-3xl font-bold">시험 목록</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          생성된 시험을 선택하고 메타 정보를 수정하거나 문항 편집 후 재출제할 수 있습니다.
        </p>
      </section>

      {error ? <p className="qa-card text-sm text-destructive">{error}</p> : null}
      {message ? <p className="qa-card text-sm text-emerald-700">{message}</p> : null}

      {exams.length === 0 ? (
        <section className="qa-card">
          <p className="text-sm text-muted-foreground">생성된 시험이 없습니다.</p>
          <a href="/admin/problems" className="mt-2 inline-block text-sm underline">
            시험지 만들기
          </a>
        </section>
      ) : (
        <section className="grid gap-4 md:grid-cols-[320px_1fr]">
          <article className="qa-card space-y-2">
            {exams.map((exam) => (
              <button
                key={exam.id}
                type="button"
                className={`w-full rounded-xl border px-3 py-2 text-left text-sm ${
                  exam.id === selectedExamId
                    ? "border-primary bg-primary/10"
                    : "border-border/70 bg-surface hover:bg-surface-muted"
                }`}
                onClick={() => {
                  setSelectedExamId(exam.id);
                  setError("");
                  setMessage("");
                }}
              >
                <p className="font-semibold">
                  #{exam.id} {exam.title}
                </p>
                <p className="text-xs text-muted-foreground">
                  {examKindLabel(exam.exam_kind)} | {exam.question_count}문항 | {exam.status}
                </p>
              </button>
            ))}
          </article>

          <section className="space-y-4">
            {detailLoading ? (
              <article className="qa-card">
                <p className="text-sm text-muted-foreground">시험 상세 불러오는 중...</p>
              </article>
            ) : (
              <>
                <form className="qa-card space-y-4" onSubmit={onSaveMeta}>
                  <h2 className="text-lg font-semibold">기본 정보 수정</h2>
                  <Input value={title} onChange={(event) => setTitle(event.target.value)} required />
                  <Textarea
                    className="min-h-24"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="설명 (선택)"
                  />
                  <div className="grid gap-3 md:grid-cols-2">
                    <select
                      className="h-11 w-full rounded-xl border border-border/70 bg-background/80 px-3 text-sm"
                      value={folderId}
                      onChange={(event) => setFolderId(event.target.value)}
                    >
                      <option value="">카테고리 없음</option>
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
                  <select
                    className="h-11 w-full rounded-xl border border-border/70 bg-background/80 px-3 text-sm"
                    value={status}
                    onChange={(event) => setStatus(event.target.value as "draft" | "published")}
                  >
                    <option value="published">공개 (published)</option>
                    <option value="draft">비공개 (draft)</option>
                  </select>
                  <Button disabled={savingMeta}>{savingMeta ? "저장 중..." : "메타 저장"}</Button>
                </form>

                <article className="qa-card space-y-4">
                  <h2 className="text-lg font-semibold">문항 수정 후 재출제</h2>
                  <p className="text-xs text-muted-foreground">
                    기존 시험 제출 데이터는 보존되고, 수정본은 새 시험 ID로 생성됩니다.
                  </p>

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
                          onChange={(event) =>
                            updateQuestion(question.key, { type: event.target.value as QuestionType })
                          }
                        >
                          <option value="multiple_choice">객관식</option>
                          <option value="subjective">주관식</option>
                          <option value="coding">코딩</option>
                        </select>
                        <Textarea
                          className="mt-2 min-h-24"
                          value={question.prompt_md}
                          onChange={(event) => updateQuestion(question.key, { prompt_md: event.target.value })}
                          placeholder="문항 내용"
                        />
                        {question.type === "multiple_choice" ? (
                          <div className="mt-3 space-y-2">
                            {question.choices.map((choice, choiceIndex) => (
                              <label key={`${question.key}-${choiceIndex}`} className="flex items-center gap-2 text-sm">
                                <input
                                  type="radio"
                                  name={`correct-choice-${question.key}`}
                                  checked={question.correctChoiceIndex === choiceIndex}
                                  onChange={() =>
                                    updateQuestion(question.key, { correctChoiceIndex: choiceIndex })
                                  }
                                />
                                <span className="w-10 text-muted-foreground">{choiceIndex + 1}번</span>
                                <Input
                                  value={choice}
                                  onChange={(event) =>
                                    updateChoice(question.key, choiceIndex, event.target.value)
                                  }
                                  placeholder={`${choiceIndex + 1}번 선택지`}
                                />
                              </label>
                            ))}
                          </div>
                        ) : null}
                        {question.type === "coding" ? (
                          <p className="mt-3 text-xs text-muted-foreground">
                            코딩 문항 정답은 문자열 고정값이 아니라 테스트 코드 결과로 판정됩니다.
                          </p>
                        ) : null}
                        <label className="mt-3 flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={question.required}
                            onChange={(event) =>
                              updateQuestion(question.key, { required: event.target.checked })
                            }
                          />
                          필수 문항
                        </label>
                      </article>
                    ))}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" onClick={() => addQuestion("multiple_choice")}>
                      객관식 추가
                    </Button>
                    <Button type="button" variant="outline" onClick={() => addQuestion("subjective")}>
                      주관식 추가
                    </Button>
                    <Button type="button" variant="outline" onClick={() => addQuestion("coding")}>
                      코딩 추가
                    </Button>
                  </div>

                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={copyResources}
                      onChange={(event) => setCopyResources(event.target.checked)}
                    />
                    원본 시험의 코딩 리소스도 함께 복사
                  </label>

                  <Button type="button" onClick={() => void onRepublish()} disabled={republishing}>
                    {republishing ? "재출제 중..." : "수정본 재출제 (새 시험 생성)"}
                  </Button>
                </article>
              </>
            )}
          </section>
        </section>
      )}
    </main>
  );
}

"use client";

import { useEffect, useState, type FormEvent } from "react";

import { BackButton } from "@/components/back-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Folder = { id: number; path: string };
type ExamSummary = {
  id: number;
  title: string;
  description: string | null;
  exam_kind: string;
  question_count: number;
  folder_path: string | null;
  status: string;
};
type ExamResource = {
  id: number;
  file_name: string;
  content_type: string | null;
  size_bytes: number;
  created_at: string;
};

type QuestionType = "multiple_choice" | "subjective" | "coding";

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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function newQuestion(key: number, type: QuestionType): DraftQuestion {
  return {
    key,
    type,
    prompt_md: "",
    required: true,
    choices: ["", "", "", ""],
    correctChoiceIndex: 0,
  };
}

export function AdminExamBuilder({
  initialFolders,
  initialExams,
}: {
  initialFolders: Folder[];
  initialExams: ExamSummary[];
}) {
  const [folders, setFolders] = useState(initialFolders);
  const [exams, setExams] = useState(initialExams);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [folderId, setFolderId] = useState(initialFolders[0] ? String(initialFolders[0].id) : "");
  const [examKind, setExamKind] = useState<"quiz" | "assessment">("quiz");
  const [questions, setQuestions] = useState<DraftQuestion[]>([newQuestion(1, "multiple_choice")]);

  const [resourceExamId, setResourceExamId] = useState<number | null>(initialExams[0]?.id ?? null);
  const [resourceRows, setResourceRows] = useState<ExamResource[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  useEffect(() => {
    if (folders.length > 0) return;
    void (async () => {
      const response = await fetch("/api/admin/problem-folders", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json().catch(() => [])) as Folder[];
      if (payload.length === 0) return;
      setFolders(payload);
      setFolderId(String(payload[0].id));
    })();
  }, [folders.length]);

  useEffect(() => {
    if (resourceExamId !== null) return;
    if (exams.length === 0) return;
    setResourceExamId(exams[0].id);
  }, [exams, resourceExamId]);

  const updateQuestion = (key: number, patch: Partial<DraftQuestion>) => {
    setQuestions((prev) => prev.map((question) => (question.key === key ? { ...question, ...patch } : question)));
  };

  const updateChoice = (key: number, choiceIndex: number, value: string) => {
    setQuestions((prev) =>
      prev.map((question) => {
        if (question.key !== key) return question;
        const nextChoices = [...question.choices];
        nextChoices[choiceIndex] = value;
        return { ...question, choices: nextChoices };
      })
    );
  };

  const addQuestion = (type: QuestionType) => {
    setQuestions((prev) => [...prev, newQuestion(Date.now(), type)]);
  };

  const removeQuestion = (key: number) => {
    setQuestions((prev) => (prev.length > 1 ? prev.filter((question) => question.key !== key) : prev));
  };

  const refreshExams = async () => {
    const response = await fetch("/api/admin/exams", { cache: "no-store" });
    if (!response.ok) return;
    const payload = (await response.json().catch(() => [])) as ExamSummary[];
    setExams(payload);
    if (payload.length > 0 && resourceExamId === null) {
      setResourceExamId(payload[0].id);
    }
  };

  const loadResources = async (examId: number) => {
    const response = await fetch(`/api/admin/exams/${examId}/resources`, { cache: "no-store" });
    const payload = (await response.json().catch(() => [])) as ExamResource[] | { detail?: string; message?: string };
    if (!response.ok) {
      const messagePayload = payload as { detail?: string; message?: string };
      throw new Error(messagePayload.detail ?? messagePayload.message ?? "리소스 목록을 불러오지 못했습니다.");
    }
    setResourceRows(payload as ExamResource[]);
  };

  useEffect(() => {
    if (resourceExamId === null) {
      setResourceRows([]);
      return;
    }
    void loadResources(resourceExamId).catch((reason) => {
      setResourceRows([]);
      if (reason instanceof Error) {
        setError(reason.message);
        return;
      }
      setError("리소스 목록을 불러오지 못했습니다.");
    });
  }, [resourceExamId]);

  const onCreateExam = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    if (!title.trim()) {
      setError("시험 제목을 입력해 주세요.");
      setLoading(false);
      return;
    }

    const normalizedQuestions = [];
    for (const question of questions) {
      if (!question.prompt_md.trim()) {
        setError("모든 문항의 내용을 입력해 주세요.");
        setLoading(false);
        return;
      }
      if (question.type === "multiple_choice") {
        const trimmedChoices = question.choices.map((choice) => choice.trim());
        if (trimmedChoices.some((choice) => choice.length === 0)) {
          setError("객관식 문항은 1~4번 선택지 내용을 모두 입력해야 합니다.");
          setLoading(false);
          return;
        }
        normalizedQuestions.push({
          type: question.type,
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

    const response = await fetch("/api/admin/exams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        description: description.trim() ? description.trim() : null,
        folder_id: folderId ? Number(folderId) : null,
        exam_kind: examKind,
        status: "published",
        questions: normalizedQuestions,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as { id?: number; detail?: string; message?: string };
    if (!response.ok || !payload.id) {
      setError(payload.detail ?? payload.message ?? "시험지 생성에 실패했습니다.");
      setLoading(false);
      return;
    }

    setMessage(`시험을 생성했습니다. (시험 ID: ${payload.id})`);
    setTitle("");
    setDescription("");
    setQuestions([newQuestion(Date.now(), "multiple_choice")]);
    await refreshExams();
    setLoading(false);
  };

  const onUploadResource = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");
    if (resourceExamId === null) {
      setError("리소스를 업로드할 시험을 먼저 선택해 주세요.");
      return;
    }
    if (!uploadFile) {
      setError("업로드할 파일을 선택해 주세요.");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", uploadFile, uploadFile.name);

      const response = await fetch(`/api/admin/exams/${resourceExamId}/resources`, {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json().catch(() => ({}))) as { detail?: string; message?: string };
      if (!response.ok) {
        setError(payload.detail ?? payload.message ?? "파일 업로드에 실패했습니다.");
        return;
      }

      setUploadFile(null);
      await loadResources(resourceExamId);
      setMessage("코딩 문제 리소스를 업로드했습니다.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <main className="qa-shell space-y-6">
      <section className="qa-card">
        <BackButton fallbackHref="/admin" />
        <p className="qa-kicker mt-4">관리자</p>
        <h1 className="mt-2 text-3xl font-bold">시험지 관리</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          시험 문항 생성과 코딩 문제 리소스 업로드를 이 화면에서 관리합니다.
        </p>
      </section>

      {error ? <p className="qa-card text-sm text-destructive">{error}</p> : null}
      {message ? <p className="qa-card text-sm text-emerald-700">{message}</p> : null}

      <form className="qa-card space-y-4" onSubmit={onCreateExam}>
        <h2 className="text-lg font-semibold">새 시험 만들기</h2>
        <Input placeholder="시험 제목" value={title} onChange={(event) => setTitle(event.target.value)} required />
        <Textarea
          className="min-h-24"
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
                <option value="coding">코딩</option>
              </select>
              <Textarea
                className="mt-2 min-h-24"
                placeholder="문항 내용을 입력해 주세요."
                value={question.prompt_md}
                onChange={(event) => updateQuestion(question.key, { prompt_md: event.target.value })}
                required
              />
              {question.type === "multiple_choice" ? (
                <div className="mt-3 space-y-2">
                  {question.choices.map((choice, choiceIndex) => (
                    <label key={`${question.key}-${choiceIndex}`} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name={`correct-choice-${question.key}`}
                        checked={question.correctChoiceIndex === choiceIndex}
                        onChange={() => updateQuestion(question.key, { correctChoiceIndex: choiceIndex })}
                      />
                      <span className="w-10 text-muted-foreground">{choiceIndex + 1}번</span>
                      <Input
                        placeholder={`${choiceIndex + 1}번 선택지 내용`}
                        value={choice}
                        onChange={(event) => updateChoice(question.key, choiceIndex, event.target.value)}
                      />
                    </label>
                  ))}
                  <p className="text-xs text-muted-foreground">정답 번호는 라디오 버튼으로 1개만 선택됩니다.</p>
                </div>
              ) : null}
              <label className="mt-3 flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={question.required}
                  onChange={(event) => updateQuestion(question.key, { required: event.target.checked })}
                />
                필수 문항
              </label>
            </article>
          ))}
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
        </div>

        <Button disabled={loading}>{loading ? "생성 중..." : "시험지 생성"}</Button>
      </form>

      <section className="qa-card space-y-3">
        <h2 className="text-lg font-semibold">코딩 문제 리소스</h2>
        <p className="text-xs text-muted-foreground">
          코딩 문항 채점에 필요한 데이터 파일(zip, csv 등)을 시험 단위로 업로드합니다.
        </p>
        {exams.length === 0 ? (
          <p className="text-sm text-muted-foreground">먼저 시험을 생성해 주세요.</p>
        ) : (
          <>
            <select
              className="h-11 w-full rounded-xl border border-border/70 bg-background/80 px-3 text-sm"
              value={resourceExamId ?? ""}
              onChange={(event) => {
                const nextId = Number(event.target.value);
                setResourceExamId(Number.isFinite(nextId) ? nextId : null);
              }}
            >
              {exams.map((exam) => (
                <option key={exam.id} value={exam.id}>
                  #{exam.id} {exam.title} ({examKindLabel(exam.exam_kind)})
                </option>
              ))}
            </select>
            <form className="flex flex-col gap-3 md:flex-row md:items-center" onSubmit={onUploadResource}>
              <input
                type="file"
                className="text-sm"
                onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
              />
              <Button type="submit" disabled={uploading}>
                {uploading ? "업로드 중..." : "리소스 업로드"}
              </Button>
            </form>
            {resourceRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">업로드된 리소스가 없습니다.</p>
            ) : (
              <div className="space-y-2">
                {resourceRows.map((resource) => (
                  <article key={resource.id} className="rounded-xl border border-border/70 bg-surface p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{resource.file_name}</p>
                      <a
                        className="text-primary underline"
                        href={`/api/exams/${resourceExamId}/resources/${resource.id}/download`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        다운로드
                      </a>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {resource.content_type ?? "application/octet-stream"} | {formatBytes(resource.size_bytes)} |{" "}
                      {new Date(resource.created_at).toLocaleString()}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <section className="qa-card flex flex-wrap gap-2 text-sm">
        <a href="/admin/exams" className="underline">
          시험 목록 관리로 이동
        </a>
        <a href="/dashboard" className="underline">
          대시보드로 이동
        </a>
      </section>
    </main>
  );
}

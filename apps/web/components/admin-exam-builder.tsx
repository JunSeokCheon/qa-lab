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
  exam_kind: string;
  question_count: number;
  folder_path: string | null;
  status: string;
};
type ExamSubmissionAnswer = {
  question_id: number;
  question_order: number;
  question_type: string;
  prompt_md: string;
  choices: string[] | null;
  answer_text: string | null;
  selected_choice_index: number | null;
  grading_status: string | null;
  grading_score: number | null;
  grading_max_score: number | null;
  grading_feedback_json: Record<string, unknown> | null;
  grading_logs: string | null;
  graded_at: string | null;
};
type ExamSubmission = {
  submission_id: number;
  exam_id: number;
  exam_title: string;
  user_id: number;
  username: string;
  status: string;
  submitted_at: string;
  answers: ExamSubmissionAnswer[];
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
};

type ChoiceStat = {
  questionId: number;
  questionOrder: number;
  prompt: string;
  choices: string[];
  counts: number[];
  respondents: string[][];
  unansweredUsers: string[];
  totalResponses: number;
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

function newMultipleChoiceQuestion(key: number): DraftQuestion {
  return {
    key,
    type: "multiple_choice",
    prompt_md: "",
    required: true,
    choices: ["", "", "", ""],
  };
}

function newSubjectiveQuestion(key: number): DraftQuestion {
  return {
    key,
    type: "subjective",
    prompt_md: "",
    required: true,
    choices: ["", "", "", ""],
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [folderId, setFolderId] = useState(initialFolders[0] ? String(initialFolders[0].id) : "");
  const [examKind, setExamKind] = useState<"quiz" | "assessment">("quiz");
  const [questions, setQuestions] = useState<DraftQuestion[]>([newMultipleChoiceQuestion(1)]);

  const [activeExamId, setActiveExamId] = useState<number | null>(null);
  const [submissionRows, setSubmissionRows] = useState<ExamSubmission[]>([]);

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

  const addQuestion = () => {
    setQuestions((prev) => [...prev, newSubjectiveQuestion(Date.now())]);
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

  const loadSubmissions = async (examId: number) => {
    const response = await fetch(`/api/admin/exams/${examId}/submissions`, { cache: "no-store" });
    const payload = (await response.json().catch(() => [])) as ExamSubmission[] | { detail?: string; message?: string };
    if (!response.ok) {
      const messagePayload = payload as { detail?: string; message?: string };
      throw new Error(messagePayload.detail ?? messagePayload.message ?? "제출 결과를 불러오지 못했습니다.");
    }
    setSubmissionRows(payload as ExamSubmission[]);
  };

  const loadResources = async (examId: number) => {
    const response = await fetch(`/api/admin/exams/${examId}/resources`, { cache: "no-store" });
    const payload = (await response.json().catch(() => [])) as ExamResource[] | { detail?: string; message?: string };
    if (!response.ok) {
      const messagePayload = payload as { detail?: string; message?: string };
      throw new Error(messagePayload.detail ?? messagePayload.message ?? "코딩 문제 리소스를 불러오지 못했습니다.");
    }
    setResourceRows(payload as ExamResource[]);
  };

  const openExamDetail = async (examId: number) => {
    setError("");
    setMessage("");
    setActiveExamId(examId);
    try {
      await loadSubmissions(examId);
    } catch (reason) {
      setSubmissionRows([]);
      if (reason instanceof Error) {
        setError(reason.message);
        return;
      }
      setError("시험 제출 상세를 불러오지 못했습니다.");
    }
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
      setError("코딩 문제 리소스를 불러오지 못했습니다.");
    });
  }, [resourceExamId]);

  const onCreateExam = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    const normalizedQuestions = [];
    for (const question of questions) {
      if (question.type === "multiple_choice") {
        const trimmedChoices = question.choices.map((choice) => choice.trim());
        if (trimmedChoices.some((choice) => choice.length === 0)) {
          setError("객관식은 1~4번 선택지 내용을 모두 입력해 주세요.");
          setLoading(false);
          return;
        }
        normalizedQuestions.push({
          type: question.type,
          prompt_md: question.prompt_md,
          required: question.required,
          choices: trimmedChoices,
        });
      } else {
        normalizedQuestions.push({
          type: question.type,
          prompt_md: question.prompt_md,
          required: question.required,
          choices: null,
        });
      }
    }

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
    setQuestions([newMultipleChoiceQuestion(Date.now())]);
    await refreshExams();
    setLoading(false);
  };

  const onUploadResource = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (resourceExamId === null) {
      setError("리소스를 업로드할 시험을 먼저 선택해 주세요.");
      return;
    }
    if (!uploadFile) {
      setError("업로드할 파일을 선택해 주세요.");
      return;
    }

    setError("");
    setMessage("");
    setUploading(true);
    const formData = new FormData();
    formData.append("file", uploadFile, uploadFile.name);

    const response = await fetch(`/api/admin/exams/${resourceExamId}/resources`, {
      method: "POST",
      body: formData,
    });
    const payload = (await response.json().catch(() => ({}))) as { detail?: string; message?: string };
    if (!response.ok) {
      setError(payload.detail ?? payload.message ?? "파일 업로드에 실패했습니다.");
      setUploading(false);
      return;
    }

    setUploadFile(null);
    await loadResources(resourceExamId);
    setMessage("코딩 문제 리소스를 업로드했습니다.");
    setUploading(false);
  };

  const choiceStats = useMemo(() => {
    const byQuestion = new Map<number, ChoiceStat>();

    for (const row of submissionRows) {
      for (const answer of row.answers) {
        if (answer.question_type !== "multiple_choice") continue;

        const existing = byQuestion.get(answer.question_id);
        const choiceSource = answer.choices ?? [];
        if (!existing) {
          const choices = [...choiceSource];
          const counts = choices.map(() => 0);
          const respondents = choices.map(() => [] as string[]);
          byQuestion.set(answer.question_id, {
            questionId: answer.question_id,
            questionOrder: answer.question_order,
            prompt: answer.prompt_md,
            choices,
            counts,
            respondents,
            unansweredUsers: [],
            totalResponses: 0,
          });
        }

        const stat = byQuestion.get(answer.question_id);
        if (!stat) continue;

        const selected = answer.selected_choice_index;
        if (selected === null || selected < 0 || selected >= stat.choices.length) {
          stat.unansweredUsers.push(row.username);
          continue;
        }

        stat.counts[selected] += 1;
        stat.respondents[selected].push(row.username);
        stat.totalResponses += 1;
      }
    }

    return [...byQuestion.values()].sort((a, b) => a.questionOrder - b.questionOrder);
  }, [submissionRows]);

  return (
    <main className="qa-shell space-y-6">
      <section className="qa-card">
        <BackButton fallbackHref="/admin" />
        <p className="qa-kicker mt-3">관리자</p>
        <h1 className="mt-2 text-3xl font-bold">시험지 관리</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          코딩 문항에서 사용할 데이터셋/파일(리소스)과 시험 문항을 함께 관리합니다.
        </p>
      </section>

      {error ? <p className="qa-card text-sm text-destructive">{error}</p> : null}
      {message ? <p className="qa-card text-sm text-emerald-700">{message}</p> : null}

      <form className="qa-card space-y-4" onSubmit={onCreateExam}>
        <h2 className="text-lg font-semibold">새 시험 만들기</h2>
        <Input placeholder="시험 제목" value={title} onChange={(event) => setTitle(event.target.value)} required />
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
                <option value="coding">코딩</option>
              </select>
              <Textarea
                className="mt-2 min-h-20"
                placeholder="문항 내용을 입력해 주세요."
                value={question.prompt_md}
                onChange={(event) => updateQuestion(question.key, { prompt_md: event.target.value })}
                required
              />
              {question.type === "multiple_choice" ? (
                <div className="mt-2 space-y-2">
                  {question.choices.map((choice, choiceIndex) => (
                    <div key={`${question.key}-${choiceIndex}`} className="flex items-center gap-2">
                      <span className="w-10 text-sm text-muted-foreground">{choiceIndex + 1}번</span>
                      <Input
                        placeholder={`${choiceIndex + 1}번 선택지 내용`}
                        value={choice}
                        onChange={(event) => updateChoice(question.key, choiceIndex, event.target.value)}
                      />
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">응시자는 객관식 문항당 하나의 선택지만 고를 수 있습니다.</p>
                </div>
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
        <h2 className="text-lg font-semibold">코딩 문제 리소스(데이터셋/파일)</h2>
        <p className="text-xs text-muted-foreground">
          코딩 문항 풀이에 필요한 파일을 업로드하세요. 응시자는 문제 화면에서 다운로드해 사용할 수 있습니다.
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
                  #{exam.id} {exam.title}
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
                  <Button type="button" variant="outline" onClick={() => void openExamDetail(exam.id)}>
                    제출/통계 보기
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
        <>
          <section className="qa-card space-y-3">
            <h2 className="text-lg font-semibold">시험 #{activeExamId} 객관식 통계</h2>
            {choiceStats.length === 0 ? (
              <p className="text-sm text-muted-foreground">객관식 응답이 아직 없습니다.</p>
            ) : (
              <div className="space-y-3">
                {choiceStats.map((stat) => (
                  <article key={stat.questionId} className="rounded-xl border border-border/70 bg-surface p-3">
                    <p className="text-sm font-semibold">
                      {stat.questionOrder}. {stat.prompt}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">응답 수: {stat.totalResponses}</p>
                    <div className="mt-2 space-y-2">
                      {stat.choices.map((choice, index) => (
                        <div key={`${stat.questionId}-${index}`} className="rounded-lg bg-surface-muted p-2 text-xs">
                          <p>
                            {index + 1}번 선택지: {choice}
                          </p>
                          <p className="mt-1 text-muted-foreground">응답자 수: {stat.counts[index]}명</p>
                          <p className="mt-1 text-muted-foreground">
                            응답 학생: {stat.respondents[index].length ? stat.respondents[index].join(", ") : "-"}
                          </p>
                        </div>
                      ))}
                      {stat.unansweredUsers.length > 0 ? (
                        <div className="rounded-lg bg-surface-muted p-2 text-xs text-muted-foreground">
                          미응답 학생: {stat.unansweredUsers.join(", ")}
                        </div>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="qa-card space-y-3">
            <h2 className="text-lg font-semibold">시험 #{activeExamId} 학생별 제출 상세</h2>
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
                          {answer.question_type === "coding" ? (
                            <>
                              <p className="mt-1 text-muted-foreground">
                                채점 상태: {answer.grading_status ?? "PENDING"}{" "}
                                {answer.grading_score !== null && answer.grading_max_score !== null
                                  ? `(${answer.grading_score}/${answer.grading_max_score})`
                                  : ""}
                              </p>
                              {answer.grading_status === "FAILED" && answer.grading_logs ? (
                                <p className="mt-1 whitespace-pre-wrap text-[11px] text-destructive">
                                  {answer.grading_logs.slice(0, 300)}
                                </p>
                              ) : null}
                            </>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}

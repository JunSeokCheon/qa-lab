"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { BackButton } from "@/components/back-button";
import { MarkdownContent } from "@/components/markdown-content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTimeKST } from "@/lib/datetime";

type Folder = { id: number; path: string };
type ExamSummary = {
  id: number;
  title: string;
  description: string | null;
  folder_id: number | null;
  folder_path: string | null;
  exam_kind: string;
  target_track_name: string | null;
  status: string;
  duration_minutes: number | null;
  results_published: boolean;
  results_published_at: string | null;
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
  answer_key_text: string | null;
};

type ExamDetail = {
  id: number;
  title: string;
  description: string | null;
  folder_id: number | null;
  exam_kind: string;
  target_track_name: string | null;
  status: string;
  duration_minutes: number | null;
  results_published: boolean;
  results_published_at: string | null;
  questions: ExamQuestionDetail[];
};

type DraftQuestion = {
  key: number;
  type: QuestionType;
  prompt_md: string;
  required: boolean;
  choices: string[];
  correctChoiceIndex: number;
  answerKeyText: string;
};

type ExamResource = {
  id: number;
  file_name: string;
  content_type: string | null;
  size_bytes: number;
  created_at: string;
};

const TRACK_OPTIONS = ["데이터 분석 11기", "QAQC 4기"] as const;

function examKindLabel(kind: string): string {
  if (kind === "quiz") return "?댁쫰";
  if (kind === "assessment") return "?깆랬???됯?";
  return kind;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
    answerKeyText: question.answer_key_text ?? "",
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
    answerKeyText: "",
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
  const [deleting, setDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [answerKeyEditor, setAnswerKeyEditor] = useState<{
    questionKey: number;
    questionLabel: string;
    value: string;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [folderId, setFolderId] = useState("");
  const [examKind, setExamKind] = useState<"quiz" | "assessment">("quiz");
  const [targetTrackName, setTargetTrackName] = useState<string>(TRACK_OPTIONS[0]);
  const [durationMinutes, setDurationMinutes] = useState("60");
  const [noTimeLimit, setNoTimeLimit] = useState(false);
  const [status, setStatus] = useState<"draft" | "published">("published");
  const [questions, setQuestions] = useState<DraftQuestion[]>([]);
  const [copyResources, setCopyResources] = useState(true);

  const [resourceRows, setResourceRows] = useState<ExamResource[]>([]);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [republishResourceFiles, setRepublishResourceFiles] = useState<File[]>([]);
  const republishFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!deleteDialogOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !deleting) {
        setDeleteDialogOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteDialogOpen, deleting]);

  useEffect(() => {
    if (!answerKeyEditor) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAnswerKeyEditor(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [answerKeyEditor]);

  const loadResources = async (examId: number) => {
    const response = await fetch(`/api/admin/exams/${examId}/resources`, { cache: "no-store" });
    const payload = (await response.json().catch(() => [])) as ExamResource[] | { detail?: string; message?: string };
    if (!response.ok) {
      const messagePayload = payload as { detail?: string; message?: string };
      throw new Error(messagePayload.detail ?? messagePayload.message ?? "由ъ냼??紐⑸줉??遺덈윭?ㅼ? 紐삵뻽?듬땲??");
    }
    setResourceRows(payload as ExamResource[]);
  };

  useEffect(() => {
    if (!selectedExamId) {
      setQuestions([]);
      setResourceRows([]);
      return;
    }
    setDetailLoading(true);
    setError("");
    void (async () => {
      const [detailResponse, resourcesResponse] = await Promise.all([
        fetch(`/api/admin/exams/${selectedExamId}`, { cache: "no-store" }),
        fetch(`/api/admin/exams/${selectedExamId}/resources`, { cache: "no-store" }),
      ]);

      const detailPayload = (await detailResponse.json().catch(() => ({}))) as ExamDetail & {
        detail?: string;
        message?: string;
      };
      if (!detailResponse.ok) {
        setError(detailPayload.detail ?? detailPayload.message ?? "?쒗뿕 ?곸꽭瑜?遺덈윭?ㅼ? 紐삵뻽?듬땲??");
        setDetailLoading(false);
        return;
      }

      const resourcesPayload = (await resourcesResponse.json().catch(() => [])) as
        | ExamResource[]
        | { detail?: string; message?: string };
      if (!resourcesResponse.ok) {
        const resourceError = resourcesPayload as { detail?: string; message?: string };
        setError(resourceError.detail ?? resourceError.message ?? "由ъ냼??紐⑸줉??遺덈윭?ㅼ? 紐삵뻽?듬땲??");
        setResourceRows([]);
      } else {
        setResourceRows(resourcesPayload as ExamResource[]);
      }

      setTitle(detailPayload.title);
      setDescription(detailPayload.description ?? "");
      setFolderId(detailPayload.folder_id ? String(detailPayload.folder_id) : "");
      setExamKind((detailPayload.exam_kind as "quiz" | "assessment") ?? "quiz");
      setTargetTrackName(detailPayload.target_track_name ?? TRACK_OPTIONS[0]);
      setDurationMinutes(String(detailPayload.duration_minutes ?? 60));
      setNoTimeLimit(detailPayload.duration_minutes === null);
      setStatus((detailPayload.status as "draft" | "published") ?? "published");
      setQuestions(detailPayload.questions.map(toDraftQuestion));
      setUploadFile(null);
      setRepublishResourceFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (republishFileInputRef.current) republishFileInputRef.current.value = "";
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

  const openAnswerKeyEditor = (question: DraftQuestion, questionIndex: number) => {
    setAnswerKeyEditor({
      questionKey: question.key,
      questionLabel: `${questionIndex + 1}踰?臾명빆`,
      value: question.answerKeyText,
    });
  };

  const saveAnswerKeyEditor = () => {
    if (!answerKeyEditor) return;
    updateQuestion(answerKeyEditor.questionKey, { answerKeyText: answerKeyEditor.value });
    setAnswerKeyEditor(null);
  };

  const uploadResourceFilesToExam = async (examId: number, files: File[]) => {
    if (files.length === 0) return { uploaded: 0, failed: [] as string[] };
    const failed: string[] = [];
    let uploaded = 0;
    for (const file of files) {
      try {
        const formData = new FormData();
        formData.append("file", file, file.name);
        const response = await fetch(`/api/admin/exams/${examId}/resources`, {
          method: "POST",
          body: formData,
        });
        if (!response.ok) {
          failed.push(file.name);
        } else {
          uploaded += 1;
        }
      } catch {
        failed.push(file.name);
      }
    }
    return { uploaded, failed };
  };

  const onSaveMeta = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedExam) return;

    setError("");
    setMessage("");
    setSavingMeta(true);
    let parsedDuration: number | null = null;
    if (!noTimeLimit) {
      parsedDuration = Number.parseInt(durationMinutes.trim(), 10);
      if (!Number.isInteger(parsedDuration) || parsedDuration < 1 || parsedDuration > 1440) {
        setError("?쒗뿕 ?쒓컙? 1遺??댁긽 1440遺??댄븯濡??낅젰??二쇱꽭??");
        setSavingMeta(false);
        return;
      }
    }
    const response = await fetch(`/api/admin/exams/${selectedExam.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        description: description.trim() ? description.trim() : null,
        folder_id: folderId ? Number(folderId) : null,
        exam_kind: examKind,
        target_track_name: targetTrackName,
        duration_minutes: parsedDuration,
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
      target_track_name?: string | null;
      duration_minutes?: number | null;
      results_published?: boolean;
      results_published_at?: string | null;
      status?: string;
      question_count?: number;
      detail?: string;
      message?: string;
    };

    if (!response.ok || !payload.id) {
      setError(payload.detail ?? payload.message ?? "?쒗뿕 硫뷀? ?뺣낫 ?섏젙???ㅽ뙣?덉뒿?덈떎.");
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
              target_track_name: payload.target_track_name ?? row.target_track_name,
              duration_minutes: payload.duration_minutes !== undefined ? payload.duration_minutes : row.duration_minutes,
              results_published: payload.results_published ?? row.results_published,
              results_published_at: payload.results_published_at ?? row.results_published_at,
              status: payload.status ?? row.status,
              question_count: payload.question_count ?? row.question_count,
            }
          : row
      )
    );
    setMessage("?쒗뿕 湲곕낯 ?뺣낫瑜???ν뻽?듬땲??");
    setSavingMeta(false);
  };

  const onRepublish = async () => {
    if (!selectedExam) return;

    setError("");
    setMessage("");
    if (!title.trim()) {
      setError("?쒗뿕 ?쒕ぉ???낅젰??二쇱꽭??");
      return;
    }
    if (!targetTrackName) {
      setError("?묒떆 ???諛섏쓣 ?좏깮??二쇱꽭??");
      return;
    }
    let parsedDuration: number | null = null;
    if (!noTimeLimit) {
      parsedDuration = Number.parseInt(durationMinutes.trim(), 10);
      if (!Number.isInteger(parsedDuration) || parsedDuration < 1 || parsedDuration > 1440) {
        setError("?쒗뿕 ?쒓컙? 1遺??댁긽 1440遺??댄븯濡??낅젰??二쇱꽭??");
        return;
      }
    }
    if (questions.length === 0) {
      setError("理쒖냼 1媛?臾명빆???꾩슂?⑸땲??");
      return;
    }

    const normalizedQuestions = [];
    for (const question of questions) {
      if (!question.prompt_md.trim()) {
        setError("紐⑤뱺 臾명빆 ?댁슜???낅젰??二쇱꽭??");
        return;
      }
      if (question.type === "multiple_choice") {
        const trimmedChoices = question.choices.map((choice) => choice.trim());
        if (trimmedChoices.some((choice) => !choice)) {
          setError("媛앷????좏깮吏 4媛쒕? 紐⑤몢 ?낅젰??二쇱꽭??");
          return;
        }
        normalizedQuestions.push({
          type: "multiple_choice",
          prompt_md: question.prompt_md.trim(),
          required: question.required,
          choices: trimmedChoices,
          correct_choice_index: question.correctChoiceIndex,
          answer_key_text: null,
        });
      } else {
        normalizedQuestions.push({
          type: question.type,
          prompt_md: question.prompt_md.trim(),
          required: question.required,
          choices: null,
          correct_choice_index: null,
          answer_key_text: question.answerKeyText.trim() || null,
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
        target_track_name: targetTrackName,
        duration_minutes: parsedDuration,
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
      target_track_name?: string | null;
      duration_minutes?: number | null;
      results_published?: boolean;
      results_published_at?: string | null;
      status?: string;
      question_count?: number;
      detail?: string;
      message?: string;
    };
    if (!response.ok || !payload.id) {
      setError(payload.detail ?? payload.message ?? "?ъ텧?쒖뿉 ?ㅽ뙣?덉뒿?덈떎.");
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
      target_track_name: payload.target_track_name ?? targetTrackName,
      duration_minutes: payload.duration_minutes !== undefined ? payload.duration_minutes : parsedDuration,
      results_published: payload.results_published ?? false,
      results_published_at: payload.results_published_at ?? null,
      status: payload.status ?? "published",
      question_count: payload.question_count ?? questions.length,
    };

    const resourceUpload = await uploadResourceFilesToExam(newSummary.id, republishResourceFiles);
    const uploadSummary =
      resourceUpload.uploaded > 0
        ? `, 추가 리소스 ${resourceUpload.uploaded}개 업로드`
        : ", 추가 리소스 업로드 없음";

    setExams((prev) => [newSummary, ...prev]);
    setSelectedExamId(newSummary.id);
    setStatus("published");
    setRepublishResourceFiles([]);
    if (republishFileInputRef.current) republishFileInputRef.current.value = "";
    if (resourceUpload.failed.length > 0) {
      setError(`???쒗뿕? ?앹꽦?먯?留??쇰? 由ъ냼???낅줈?쒖뿉 ?ㅽ뙣?덉뒿?덈떎: ${resourceUpload.failed.join(", ")}`);
    }
    setMessage(`?섏젙蹂몄쑝濡????쒗뿕???앹꽦?덉뒿?덈떎. (ID: ${newSummary.id}${uploadSummary})`);
    setRepublishing(false);
  };

  const onDeleteExam = async () => {
    if (!selectedExam) return;

    setDeleting(true);
    setError("");
    setMessage("");
    const response = await fetch(`/api/admin/exams/${selectedExam.id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { detail?: string; message?: string };
      setError(payload.detail ?? payload.message ?? "?쒗뿕 ??젣???ㅽ뙣?덉뒿?덈떎.");
      setDeleting(false);
      return;
    }

    const next = exams.filter((exam) => exam.id !== selectedExam.id);
    setExams(next);
    setSelectedExamId(next[0]?.id ?? null);
    setDeleteDialogOpen(false);
    setMessage("?쒗뿕????젣?덉뒿?덈떎.");
    setDeleting(false);
  };

  const uploadResource = async () => {
    if (!selectedExam) return;
    if (!uploadFile) {
      setError("?낅줈?쒗븷 ?뚯씪???좏깮??二쇱꽭??");
      return;
    }
    setUploading(true);
    setError("");
    setMessage("");
    try {
      const formData = new FormData();
      formData.append("file", uploadFile, uploadFile.name);
      const response = await fetch(`/api/admin/exams/${selectedExam.id}/resources`, {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json().catch(() => ({}))) as { detail?: string; message?: string };
      if (!response.ok) {
        setError(payload.detail ?? payload.message ?? "由ъ냼???낅줈?쒖뿉 ?ㅽ뙣?덉뒿?덈떎.");
        return;
      }
      await loadResources(selectedExam.id);
      setUploadFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setMessage("由ъ냼?ㅻ? ?낅줈?쒗뻽?듬땲??");
    } finally {
      setUploading(false);
    }
  };

  return (
    <main className="qa-shell space-y-6">
      <section className="qa-card bg-hero text-hero-foreground">
        <BackButton fallbackHref="/" tone="hero" />
        <p className="qa-kicker mt-4 text-hero-foreground/80">愿由ъ옄</p>
        <h1 className="mt-2 text-3xl font-bold">시험 목록 관리</h1>
        <p className="mt-3 text-sm text-hero-foreground/90">
          ?쒗뿕 湲곕낯 ?뺣낫 ?섏젙, 臾명빆 ?몄쭛 ?ъ텧?? 由ъ냼??愿由? ?쒗뿕 ??젣瑜??섑뻾?⑸땲??
        </p>
      </section>

      {error ? <p className="qa-card text-sm text-destructive">{error}</p> : null}
      {message ? <p className="qa-card text-sm text-emerald-700">{message}</p> : null}

      {exams.length === 0 ? (
        <section className="qa-card">
          <p className="text-sm text-muted-foreground">?앹꽦???쒗뿕???놁뒿?덈떎.</p>
          <a href="/admin/problems" className="mt-2 inline-block text-sm underline">
            ?쒗뿕吏 留뚮뱾湲?          </a>
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
                  {exam.title}
                </p>
                <p className="text-xs text-muted-foreground">
                  {examKindLabel(exam.exam_kind)} | {exam.question_count}문항 | {exam.target_track_name ?? "미지정"} |{" "}
                  {exam.duration_minutes === null ? "시간 제한 없음" : `${exam.duration_minutes}분`} |{" "}
                  {exam.results_published ? "결과 공유 중" : "결과 미공개"}
                </p>
              </button>
            ))}
          </article>

          <section className="space-y-4">
            {detailLoading ? (
              <article className="qa-card">
                <p className="text-sm text-muted-foreground">?쒗뿕 ?곸꽭瑜?遺덈윭?ㅻ뒗 以묒엯?덈떎...</p>
              </article>
            ) : (
              <>
                <form className="qa-card space-y-4" onSubmit={onSaveMeta}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-lg font-semibold">湲곕낯 ?뺣낫 ?섏젙</h2>
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => setDeleteDialogOpen(true)}
                      disabled={deleting || !selectedExam}
                    >
                      {deleting ? "??젣 以?.." : "?쒗뿕 ??젣"}
                    </Button>
                  </div>

                  <Input value={title} onChange={(event) => setTitle(event.target.value)} required />
                  <Textarea
                    className="min-h-24"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="?ㅻ챸 (?좏깮)"
                  />

                  <div className="grid gap-3 md:grid-cols-2">
                    <select
                      className="h-11 w-full rounded-xl border border-border/70 bg-background/80 px-3 text-sm"
                      value={folderId}
                      onChange={(event) => setFolderId(event.target.value)}
                    >
                      <option value="">移댄뀒怨좊━ ?놁쓬</option>
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
                      <option value="quiz">?댁쫰</option>
                      <option value="assessment">?깆랬???됯?</option>
                    </select>
                  </div>

                  <select
                    className="h-11 w-full rounded-xl border border-border/70 bg-background/80 px-3 text-sm"
                    value={targetTrackName}
                    onChange={(event) => setTargetTrackName(event.target.value)}
                  >
                    {TRACK_OPTIONS.map((track) => (
                      <option key={track} value={track}>
                        ?묒떆 ??? {track}
                      </option>
                    ))}
                  </select>

                  <div className="space-y-2 rounded-xl border border-border/70 bg-surface-muted p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium">?쒗뿕 ?쒓컙 (遺?</p>
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={noTimeLimit}
                          onChange={(event) => setNoTimeLimit(event.target.checked)}
                        />
                        ?쒓컙 ?쒗븳 ?놁쓬
                      </label>
                    </div>
                    <Input
                      type="number"
                      min={1}
                      max={1440}
                      value={durationMinutes}
                      onChange={(event) => setDurationMinutes(event.target.value)}
                      placeholder="?? 60"
                      disabled={noTimeLimit}
                    />
                  </div>

                  <select
                    className="h-11 w-full rounded-xl border border-border/70 bg-background/80 px-3 text-sm"
                    value={status}
                    onChange={(event) => setStatus(event.target.value as "draft" | "published")}
                  >
                    <option value="published">怨듦컻 (published)</option>
                    <option value="draft">鍮꾧났媛?(draft)</option>
                  </select>

                  <Button disabled={savingMeta}>{savingMeta ? "저장 중..." : "메타 저장"}</Button>
                </form>

                <article className="qa-card space-y-4">
                  <h2 className="text-lg font-semibold">선택 시험 리소스 업로드</h2>
                  <p className="text-xs text-muted-foreground">
                    ?꾩옱 ?좏깮???쒗뿕???뚯씪??異붽? ?낅줈?쒗빀?덈떎.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    ?뚯씪??理쒕? 500MB源뚯? ?낅줈?쒗븷 ???덉뒿?덈떎. ?????먮즺??Google Drive 留곹겕瑜??쒗뿕 ?ㅻ챸/臾명빆???④퍡 ?④꺼 二쇱꽭??
                  </p>
                  <div className="rounded-2xl border border-border/70 bg-surface p-4">
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
                    />
                    <div className="flex flex-col gap-3 md:flex-row md:items-center">
                      <Button
                        type="button"
                        variant="outline"
                        className="border-2"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                      >
                        ?뚯씪 ?좏깮
                      </Button>
                      <Button type="button" onClick={() => void uploadResource()} disabled={uploading || !uploadFile}>
                        {uploading ? "업로드 중..." : "리소스 업로드"}
                      </Button>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      ?좏깮 ?뚯씪: <span className="font-medium">{uploadFile?.name ?? "(?놁쓬)"}</span>
                    </p>
                  </div>

                  {resourceRows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">?낅줈?쒕맂 由ъ냼?ㅺ? ?놁뒿?덈떎.</p>
                  ) : (
                    <div className="space-y-2">
                      {resourceRows.map((resource) => (
                        <article key={resource.id} className="rounded-xl border border-border/70 bg-surface p-3 text-sm">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="font-medium">{resource.file_name}</p>
                            <a
                              className="text-primary underline"
                              href={`/api/exams/${selectedExamId}/resources/${resource.id}/download`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              ?ㅼ슫濡쒕뱶
                            </a>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {resource.content_type ?? "application/octet-stream"} | {formatBytes(resource.size_bytes)} |{" "}
                            {formatDateTimeKST(resource.created_at)}
                          </p>
                        </article>
                      ))}
                    </div>
                  )}
                </article>

                <article className="qa-card space-y-4">
                  <h2 className="text-lg font-semibold">문항 수정 및 재출제</h2>
                  <p className="text-xs text-muted-foreground">
                    湲곗〈 ?쒗뿕 ?쒖텧 ?곗씠?곕뒗 ?좎??섍퀬, ?섏젙蹂몄? ???쒗뿕 ID濡??앹꽦?⑸땲??
                  </p>

                  <div className="space-y-3">
                    {questions.map((question, index) => (
                      <article key={question.key} className="rounded-2xl border border-border/70 p-4">
                        <div className="mb-2 flex items-center justify-between">
                          <h3 className="text-sm font-semibold">臾명빆 {index + 1}</h3>
                          <Button type="button" variant="outline" onClick={() => removeQuestion(question.key)}>
                            臾명빆 ??젣
                          </Button>
                        </div>

                        <select
                          className="h-11 w-full rounded-xl border border-border/70 bg-background/80 px-3 text-sm"
                          value={question.type}
                          onChange={(event) => updateQuestion(question.key, { type: event.target.value as QuestionType })}
                        >
                          <option value="multiple_choice">객관식</option>
                          <option value="subjective">주관식</option>
                          <option value="coding">肄붾뵫</option>
                        </select>

                        <Textarea
                          className="mt-2 min-h-48"
                          value={question.prompt_md}
                          onChange={(event) => updateQuestion(question.key, { prompt_md: event.target.value })}
                          placeholder="臾명빆 ?댁슜"
                        />
                        <div className="mt-2 rounded-xl border border-border/70 bg-background/70 p-3">
                          <p className="text-[11px] font-semibold text-muted-foreground">臾명빆 誘몃━蹂닿린</p>
                          <MarkdownContent className="mt-2" content={question.prompt_md} />
                        </div>

                        <div className="mt-3 rounded-xl border border-border/70 bg-surface-muted p-3">
                          <p className="text-xs font-semibold">?뺣떟/梨꾩젏 湲곗?</p>
                          {question.type === "multiple_choice" ? (
                            <div className="mt-2 space-y-2">
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
                                    value={choice}
                                    onChange={(event) => updateChoice(question.key, choiceIndex, event.target.value)}
                                    placeholder={`${choiceIndex + 1}踰??좏깮吏`}
                                  />
                                </label>
                              ))}
                              <p className="text-xs text-muted-foreground">
                                ?꾩옱 ?뺣떟: {question.correctChoiceIndex + 1}踰?(?쇰뵒??踰꾪듉?쇰줈 蹂寃?
                              </p>
                            </div>
                          ) : (
                            <div className="mt-2 space-y-2">
                              <div className="rounded-xl border border-border/70 bg-background/80 p-2">
                                <p className="text-[11px] font-medium text-muted-foreground">현재 정답/채점 기준</p>
                                <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap rounded bg-surface-muted p-2 text-xs">
                                  {question.answerKeyText?.trim() ? question.answerKeyText : "(아직 입력되지 않았습니다)"}
                                </pre>
                              </div>
                              <Button
                                type="button"
                                variant="outline"
                                className="h-9 px-3 text-xs"
                                onClick={() => openAnswerKeyEditor(question, index)}
                              >
                                큰 화면에서 정답/채점 기준 입력
                              </Button>
                              <p className="text-xs text-muted-foreground">
                                {question.type === "subjective"
                                  ? "주관식은 정답/채점 기준을 입력하면 LLM이 제출 답안을 비교해 자동채점합니다."
                                  : "코딩은 정답 코드/채점 기준을 입력하면 LLM이 제출 코드를 비교해 자동채점합니다."}
                              </p>
                            </div>
                          )}
                        </div>

                        <label className="mt-3 flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={question.required}
                            onChange={(event) => updateQuestion(question.key, { required: event.target.checked })}
                          />
                          ?꾩닔 臾명빆
                        </label>
                      </article>
                    ))}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" onClick={() => addQuestion("multiple_choice")}>
                      媛앷???異붽?
                    </Button>
                    <Button type="button" variant="outline" onClick={() => addQuestion("subjective")}>
                      二쇨???異붽?
                    </Button>
                    <Button type="button" variant="outline" onClick={() => addQuestion("coding")}>
                      肄붾뵫 異붽?
                    </Button>
                  </div>

                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={copyResources}
                      onChange={(event) => setCopyResources(event.target.checked)}
                    />
                    ?먮낯 ?쒗뿕 由ъ냼??蹂듭궗
                  </label>

                  <div className="rounded-2xl border border-border/70 bg-surface p-4">
                    <p className="text-sm font-semibold">재출제 시 추가 리소스 업로드</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      ?ъ텧???????쒗뿕??諛붾줈 ?낅줈?쒕맗?덈떎. (?щ윭 ?뚯씪 ?좏깮 媛??
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      ?뚯씪??理쒕? 500MB源뚯? ?낅줈?쒗븷 ???덉뒿?덈떎.
                    </p>
                    <input
                      ref={republishFileInputRef}
                      type="file"
                      multiple
                      className="mt-3"
                      onChange={(event) => {
                        const files = event.target.files ? Array.from(event.target.files) : [];
                        setRepublishResourceFiles(files);
                      }}
                    />
                    <p className="mt-2 text-xs text-muted-foreground">
                      ?좏깮 ?뚯씪:{" "}
                      {republishResourceFiles.length > 0
                        ? republishResourceFiles.map((file) => file.name).join(", ")
                        : "(?놁쓬)"}
                    </p>
                  </div>

                  <Button type="button" onClick={() => void onRepublish()} disabled={republishing}>
                    {republishing ? "?ъ텧??以?.." : "?섏젙蹂??ъ텧??(???쒗뿕 ?앹꽦)"}
                  </Button>
                </article>
              </>
            )}
          </section>
        </section>
      )}

      {answerKeyEditor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-5xl rounded-2xl border border-border/70 bg-card p-5 shadow-xl">
            <h3 className="text-lg font-semibold">{answerKeyEditor.questionLabel} 정답/채점 기준 입력</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              길이가 긴 주관식/코딩 정답은 큰 입력창에서 작성한 뒤 저장하세요.
            </p>
            <Textarea
              className="mt-3 min-h-[55vh] text-xs leading-6"
              value={answerKeyEditor.value}
              onChange={(event) =>
                setAnswerKeyEditor((prev) => (prev ? { ...prev, value: event.target.value } : prev))
              }
              placeholder="정답/채점 기준을 입력하세요."
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setAnswerKeyEditor(null)}>
                취소
              </Button>
              <Button type="button" onClick={saveAnswerKeyEditor}>
                저장
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteDialogOpen && selectedExam ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]">
          <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-primary/40 bg-white shadow-2xl">
            <div className="bg-gradient-to-r from-primary to-[#d80028] px-5 py-4 text-white">
              <p className="text-xs font-semibold uppercase tracking-[0.14em]">二쇱쓽</p>
              <h3 className="mt-1 text-lg font-bold">?쒗뿕 ??젣 ?뺤씤</h3>
            </div>
            <div className="space-y-3 p-5 text-sm text-foreground">
              <p className="rounded-xl border border-primary/20 bg-secondary/50 p-3">
                <span className="font-semibold">{selectedExam.title}</span>
              </p>
              <p>??젣 ?꾩뿉??臾명빆/由ъ냼???쒖텧 湲곕줉??蹂듦뎄?????놁뒿?덈떎. ?뺣쭚 ??젣?섏떆寃좎뒿?덇퉴?</p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border/70 bg-muted/30 px-5 py-4">
              <Button type="button" variant="outline" onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>
                痍⑥냼
              </Button>
              <Button type="button" variant="destructive" onClick={() => void onDeleteExam()} disabled={deleting}>
                {deleting ? "??젣 以?.." : "?곴뎄 ??젣"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

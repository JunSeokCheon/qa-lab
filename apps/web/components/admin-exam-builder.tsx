"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";

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
  exam_kind: string;
  question_count: number;
  folder_path: string | null;
  target_track_name: string | null;
  status: string;
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

const TRACK_OPTIONS = ["데이터 분석 11기", "QAQC 4기"] as const;

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
  const [folders, setFolders] = useState(initialFolders);
  const [exams, setExams] = useState(initialExams);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploadingResources, setUploadingResources] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [folderId, setFolderId] = useState(initialFolders[0] ? String(initialFolders[0].id) : "");
  const [examKind, setExamKind] = useState<"quiz" | "assessment">("quiz");
  const [targetTrackName, setTargetTrackName] = useState<string>(TRACK_OPTIONS[0]);
  const [questions, setQuestions] = useState<DraftQuestion[]>([newQuestion(1, "multiple_choice")]);
  const [resourceFiles, setResourceFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  const hasCodingQuestion = useMemo(() => questions.some((question) => question.type === "coding"), [questions]);

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
    setQuestions((prev) => [...prev, newQuestion(Date.now() + Math.floor(Math.random() * 1000), type)]);
  };

  const removeQuestion = (key: number) => {
    setQuestions((prev) => (prev.length > 1 ? prev.filter((question) => question.key !== key) : prev));
  };

  const refreshExams = async () => {
    const response = await fetch("/api/admin/exams", { cache: "no-store" });
    if (!response.ok) return;
    const payload = (await response.json().catch(() => [])) as ExamSummary[];
    setExams(payload);
  };

  const uploadResourceFilesToExam = async (examId: number, files: File[]) => {
    if (files.length === 0) {
      return { uploaded: 0, failed: [] as string[] };
    }

    setUploadingResources(true);
    const failed: string[] = [];
    let uploaded = 0;
    try {
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
            continue;
          }
          uploaded += 1;
        } catch {
          failed.push(file.name);
        }
      }
      return { uploaded, failed };
    } finally {
      setUploadingResources(false);
    }
  };

  const onResourceFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFiles = event.target.files ? Array.from(event.target.files) : [];
    setResourceFiles(nextFiles);
  };

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
    if (!targetTrackName) {
      setError("응시 대상 반을 선택해 주세요.");
      setLoading(false);
      return;
    }

    const normalizedQuestions = [];
    for (const question of questions) {
      if (!question.prompt_md.trim()) {
        setError("모든 문항 내용을 입력해 주세요.");
        setLoading(false);
        return;
      }
      if (question.type === "multiple_choice") {
        const trimmedChoices = question.choices.map((choice) => choice.trim());
        if (trimmedChoices.some((choice) => choice.length === 0)) {
          setError("객관식 선택지 4개를 모두 입력해 주세요.");
          setLoading(false);
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

    const response = await fetch("/api/admin/exams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        description: description.trim() ? description.trim() : null,
        folder_id: folderId ? Number(folderId) : null,
        exam_kind: examKind,
        target_track_name: targetTrackName,
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

    const uploadResult = await uploadResourceFilesToExam(payload.id, resourceFiles);
    if (uploadResult.failed.length > 0) {
      setError(`시험은 생성되었지만 일부 리소스 업로드에 실패했습니다: ${uploadResult.failed.join(", ")}`);
    }

    const uploadMessage =
      uploadResult.uploaded > 0 ? `, 리소스 ${uploadResult.uploaded}개 업로드 완료` : ", 업로드된 리소스 없음";
    setMessage(`시험이 생성되었습니다. (ID: ${payload.id}${uploadMessage})`);
    setTitle("");
    setDescription("");
    setTargetTrackName(TRACK_OPTIONS[0]);
    setQuestions([newQuestion(Date.now(), "multiple_choice")]);
    setResourceFiles([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    await refreshExams();
    setLoading(false);
  };

  return (
    <main className="qa-shell space-y-6">
      <section className="qa-card">
        <BackButton fallbackHref="/admin" />
        <p className="qa-kicker mt-4">관리자</p>
        <h1 className="mt-2 text-3xl font-bold">시험지 관리</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          새 시험 생성 시 코딩 리소스 파일도 함께 업로드할 수 있습니다.
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

        <select
          className="h-11 w-full rounded-xl border border-border/70 bg-background/80 px-3 text-sm"
          value={targetTrackName}
          onChange={(event) => setTargetTrackName(event.target.value)}
        >
          {TRACK_OPTIONS.map((track) => (
            <option key={track} value={track}>
              응시 대상: {track}
            </option>
          ))}
        </select>

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
                  <p className="text-xs text-muted-foreground">정답 번호는 1개만 선택 가능합니다.</p>
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

        <div className="rounded-2xl border border-border/70 bg-surface p-4">
          <p className="text-sm font-semibold">코딩 문제 리소스 업로드 (새 시험과 함께)</p>
          <p className="mt-1 text-xs text-muted-foreground">
            코딩 문항이 있을 때 권장합니다. 여러 파일 선택 가능, zip 파일도 업로드할 수 있습니다.
          </p>
          <input ref={fileInputRef} type="file" multiple className="mt-3" onChange={onResourceFileChange} />
          <p className="mt-2 text-xs text-muted-foreground">
            선택 파일:{" "}
            {resourceFiles.length > 0 ? resourceFiles.map((file) => file.name).join(", ") : "(없음)"}
          </p>
          {!hasCodingQuestion && resourceFiles.length > 0 ? (
            <p className="mt-1 text-xs text-amber-700">
              현재 문항에 코딩 문제가 없습니다. 그래도 리소스는 업로드됩니다.
            </p>
          ) : null}
        </div>

        <Button disabled={loading || uploadingResources}>
          {loading || uploadingResources ? "생성 중..." : "시험 생성"}
        </Button>
      </form>

      <section className="qa-card space-y-2">
        <h2 className="text-lg font-semibold">최근 시험</h2>
        {exams.length === 0 ? (
          <p className="text-sm text-muted-foreground">아직 생성된 시험이 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {exams.slice(0, 8).map((exam) => (
              <article key={exam.id} className="rounded-xl border border-border/70 bg-surface p-3 text-sm">
                <p className="font-medium">
                  #{exam.id} {exam.title}
                </p>
                <p className="text-xs text-muted-foreground">
                  {examKindLabel(exam.exam_kind)} | {exam.question_count}문항 | {exam.target_track_name ?? "미지정"}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

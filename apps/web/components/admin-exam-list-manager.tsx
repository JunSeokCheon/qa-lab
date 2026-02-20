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

function examKindLabel(kind: string): string {
  if (kind === "quiz") return "퀴즈";
  if (kind === "assessment") return "성취도 평가";
  return kind;
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const selectedExam = useMemo(
    () => exams.find((exam) => exam.id === selectedExamId) ?? null,
    [exams, selectedExamId]
  );

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [folderId, setFolderId] = useState("");
  const [examKind, setExamKind] = useState<"quiz" | "assessment">("quiz");
  const [status, setStatus] = useState<"draft" | "published">("published");

  useEffect(() => {
    if (!selectedExam) return;
    setTitle(selectedExam.title);
    setDescription(selectedExam.description ?? "");
    setFolderId(selectedExam.folder_id ? String(selectedExam.folder_id) : "");
    setExamKind((selectedExam.exam_kind as "quiz" | "assessment") ?? "quiz");
    setStatus((selectedExam.status as "draft" | "published") ?? "published");
  }, [selectedExam]);

  const onSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedExam) return;

    setError("");
    setMessage("");
    setSaving(true);
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
      detail?: string;
      message?: string;
      id?: number;
      title?: string;
      description?: string | null;
      folder_id?: number | null;
      folder_path?: string | null;
      exam_kind?: string;
      status?: string;
      question_count?: number;
    };
    if (!response.ok || !payload.id) {
      setError(payload.detail ?? payload.message ?? "시험 수정에 실패했습니다.");
      setSaving(false);
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
              folder_path: payload.folder_path ?? null,
              exam_kind: payload.exam_kind ?? row.exam_kind,
              status: payload.status ?? row.status,
              question_count: payload.question_count ?? row.question_count,
            }
          : row
      )
    );
    setMessage("시험 정보를 수정했습니다.");
    setSaving(false);
  };

  return (
    <main className="qa-shell space-y-6">
      <section className="qa-card">
        <BackButton fallbackHref="/admin" />
        <p className="qa-kicker mt-4">관리자</p>
        <h1 className="mt-2 text-3xl font-bold">시험 목록</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          생성된 시험을 선택해서 제목, 카테고리, 상태를 변경합니다.
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
                onClick={() => setSelectedExamId(exam.id)}
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

          <form className="qa-card space-y-4" onSubmit={onSave}>
            {!selectedExam ? (
              <p className="text-sm text-muted-foreground">좌측에서 시험을 선택해 주세요.</p>
            ) : (
              <>
                <h2 className="text-lg font-semibold">시험 #{selectedExam.id} 수정</h2>
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
                  <option value="published">공개(published)</option>
                  <option value="draft">비공개(draft)</option>
                </select>
                <Button disabled={saving}>{saving ? "저장 중..." : "저장"}</Button>
                <p className="text-xs text-muted-foreground">
                  상세 통계/제출 분석은 <a href="/dashboard" className="underline">대시보드</a>에서 확인합니다.
                </p>
              </>
            )}
          </form>
        </section>
      )}
    </main>
  );
}

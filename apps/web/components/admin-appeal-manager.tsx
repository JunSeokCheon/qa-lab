"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { BackButton } from "@/components/back-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateTimeKST } from "@/lib/datetime";

type ExamSummary = {
  id: number;
  title: string;
  exam_kind: string;
  target_track_name?: string | null;
};

type AppealRow = {
  submission_id: number;
  exam_id: number;
  exam_title: string;
  user_id: number;
  user_name: string;
  username: string;
  question_id: number;
  question_order: number;
  question_type: string;
  prompt_preview: string;
  grading_status: string | null;
  grading_score: number | null;
  grading_max_score: number | null;
  verdict: "correct" | "incorrect" | "pending" | "review_pending";
  appeal_pending: boolean;
  appeal_count: number;
  latest_appeal_reason: string | null;
  latest_appeal_requested_at: string | null;
  latest_appeal_requested_by_user_id: number | null;
  results_published: boolean;
  results_published_at: string | null;
};

type ApiMessage = {
  message?: string;
  detail?: string;
};

function questionTypeLabel(type: string): string {
  if (type === "multiple_choice") return "객관식";
  if (type === "subjective") return "주관식";
  if (type === "coding") return "코딩";
  return type;
}

function verdictLabel(verdict: AppealRow["verdict"]): string {
  if (verdict === "correct") return "정답";
  if (verdict === "incorrect") return "오답";
  if (verdict === "review_pending") return "검토 필요";
  return "미채점";
}

function verdictBadgeStyle(verdict: AppealRow["verdict"]): string {
  if (verdict === "correct") return "bg-emerald-100 text-emerald-800";
  if (verdict === "incorrect") return "bg-rose-100 text-rose-800";
  if (verdict === "review_pending") return "bg-amber-100 text-amber-800";
  return "bg-muted text-muted-foreground";
}

function gradingLabel(status: string | null): string {
  if (status === "GRADED") return "채점 완료";
  if (status === "FAILED") return "채점 실패";
  if (status === "QUEUED") return "채점 대기";
  if (status === "RUNNING") return "채점 중";
  if (status === "SUBMITTED") return "제출 상태";
  return status ?? "-";
}

function canAutoRegrade(row: AppealRow): boolean {
  if (row.question_type === "multiple_choice") return false;
  return true;
}

export function AdminAppealManager({ initialExams, initialRows }: { initialExams: ExamSummary[]; initialRows: AppealRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [examIdFilter, setExamIdFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "resolved">("pending");
  const [studentKeyword, setStudentKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [runningKey, setRunningKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const buildQuery = useCallback(() => {
    const params = new URLSearchParams();
    params.set("status", statusFilter);
    params.set("limit", "200");
    if (examIdFilter !== "all") params.set("exam_id", examIdFilter);
    if (studentKeyword.trim()) params.set("student_keyword", studentKeyword.trim());
    return params.toString();
  }, [examIdFilter, statusFilter, studentKeyword]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = buildQuery();
      const response = await fetch(`/api/admin/appeals${query ? `?${query}` : ""}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => [])) as AppealRow[] | ApiMessage;
      if (!response.ok) {
        const apiError = payload as ApiMessage;
        setError(apiError.detail ?? apiError.message ?? "정정 신청 목록을 불러오지 못했습니다.");
        setRows([]);
        return;
      }
      setRows(payload as AppealRow[]);
    } catch {
      setError("정정 신청 목록을 불러오지 못했습니다.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const pendingCount = useMemo(() => rows.filter((row) => row.appeal_pending).length, [rows]);

  const runAppealRegrade = async (row: AppealRow) => {
    setRunningKey(`regrade:${row.submission_id}:${row.question_id}`);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/admin/grading/exam-submissions/${row.submission_id}/appeal-regrade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question_id: row.question_id,
          reason: row.latest_appeal_reason,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as ApiMessage;
      if (!response.ok) {
        setError(payload.detail ?? payload.message ?? "재채점 요청에 실패했습니다.");
        return;
      }
      setMessage(payload.message ?? "재채점을 큐에 등록했습니다.");
      await reload();
    } finally {
      setRunningKey(null);
    }
  };

  const resolveAppeal = async (row: AppealRow) => {
    setRunningKey(`resolve:${row.submission_id}:${row.question_id}`);
    setError("");
    setMessage("");
    try {
      const response = await fetch(
        `/api/admin/grading/exam-submissions/${row.submission_id}/answers/${row.question_id}/appeal-resolve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resolved: true }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as ApiMessage;
      if (!response.ok) {
        setError(payload.detail ?? payload.message ?? "정정 신청 처리에 실패했습니다.");
        return;
      }
      setMessage(payload.message ?? "정정 신청을 처리 완료로 변경했습니다.");
      await reload();
    } finally {
      setRunningKey(null);
    }
  };

  const buildDashboardHref = (row: AppealRow): string => {
    const params = new URLSearchParams();
    params.set("examId", String(row.exam_id));
    params.set("student", row.user_name);
    if (row.appeal_pending) params.set("needsReview", "1");
    return `/dashboard?${params.toString()}`;
  };

  return (
    <main className="qa-shell space-y-6">
      <section className="qa-card bg-hero text-hero-foreground">
        <BackButton fallbackHref="/admin" tone="hero" />
        <p className="qa-kicker mt-4 text-hero-foreground/80">관리자</p>
        <h1 className="mt-2 text-3xl font-bold">정정 신청 관리</h1>
        <p className="mt-2 text-sm text-hero-foreground/90">
          수강생 정정 신청을 시험/학생 기준으로 확인하고, 재채점 또는 완료 처리를 빠르게 진행합니다.
        </p>
      </section>

      {error ? <p className="qa-card text-sm text-destructive">{error}</p> : null}
      {message ? <p className="qa-card text-sm text-emerald-700">{message}</p> : null}

      <section className="qa-card space-y-3">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <select
            className="h-11 rounded-xl border border-border/70 bg-background/80 px-3 text-sm"
            value={examIdFilter}
            onChange={(event) => setExamIdFilter(event.target.value)}
          >
            <option value="all">전체 시험</option>
            {initialExams.map((exam) => (
              <option key={exam.id} value={exam.id}>
                {exam.title}
              </option>
            ))}
          </select>

          <select
            className="h-11 rounded-xl border border-border/70 bg-background/80 px-3 text-sm"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as "all" | "pending" | "resolved")}
          >
            <option value="pending">처리중만</option>
            <option value="resolved">처리완료만</option>
            <option value="all">전체</option>
          </select>

          <Input
            className="h-11"
            placeholder="학생 이름/아이디 검색"
            value={studentKeyword}
            onChange={(event) => setStudentKeyword(event.target.value)}
          />

          <Button type="button" variant="outline" onClick={() => void reload()} disabled={loading}>
            {loading ? "불러오는 중..." : "새로고침"}
          </Button>

          <Button type="button" variant="outline" asChild>
            <Link href="/admin/grading">자동 채점 관리로 이동</Link>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          현재 {rows.length}건 | 처리중 {pendingCount}건
        </p>
      </section>

      <section className="qa-card space-y-3">
        <h2 className="text-lg font-semibold">정정 신청 목록</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">조건에 맞는 정정 신청이 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {rows.map((row) => {
              const keyBase = `${row.submission_id}:${row.question_id}`;
              const regradeLoading = runningKey === `regrade:${keyBase}`;
              const resolveLoading = runningKey === `resolve:${keyBase}`;
              return (
                <article key={keyBase} className="rounded-xl border border-border/70 bg-surface p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold">
                      {row.exam_title} · {row.user_name} ({row.username})
                    </p>
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${verdictBadgeStyle(row.verdict)}`}
                      >
                        {verdictLabel(row.verdict)}
                      </span>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          row.appeal_pending ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"
                        }`}
                      >
                        {row.appeal_pending ? "처리중" : "처리완료"}
                      </span>
                    </div>
                  </div>

                  <p className="mt-1 text-xs text-muted-foreground">
                    제출 #{row.submission_id} · {row.question_order}번 ({questionTypeLabel(row.question_type)}) · 채점 상태 {gradingLabel(row.grading_status)}
                  </p>

                  <p className="mt-2 rounded-md bg-surface-muted p-2 text-xs">{row.prompt_preview}</p>

                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    <p className="rounded-md border border-border/70 bg-background/70 p-2 text-xs">
                      <span className="font-medium">신청 시각:</span>{" "}
                      {row.latest_appeal_requested_at ? formatDateTimeKST(row.latest_appeal_requested_at) : "-"}
                    </p>
                    <p className="rounded-md border border-border/70 bg-background/70 p-2 text-xs">
                      <span className="font-medium">신청 횟수:</span> {row.appeal_count}회
                    </p>
                  </div>

                  <p className="mt-2 rounded-md border border-border/70 bg-background/70 p-2 text-xs">
                    <span className="font-medium">신청 사유:</span> {row.latest_appeal_reason?.trim() ? row.latest_appeal_reason : "(사유 미입력)"}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" variant="outline" className="h-8 px-2 text-xs" asChild>
                      <Link href={buildDashboardHref(row)}>대시보드로 확인</Link>
                    </Button>
                    <Button
                      type="button"
                      className="h-8 px-2 text-xs"
                      onClick={() => void runAppealRegrade(row)}
                      disabled={!row.appeal_pending || !canAutoRegrade(row) || resolveLoading || regradeLoading}
                    >
                      {regradeLoading ? "등록 중..." : "재채점 요청"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-8 px-2 text-xs"
                      onClick={() => void resolveAppeal(row)}
                      disabled={!row.appeal_pending || resolveLoading || regradeLoading}
                    >
                      {resolveLoading ? "처리 중..." : "완료 처리"}
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}


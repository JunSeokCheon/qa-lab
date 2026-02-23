"use client";

import { useMemo, useState } from "react";

import { BackButton } from "@/components/back-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ExamSummary = {
  id: number;
  title: string;
  exam_kind: string;
  target_track_name?: string | null;
};

type GradingSubmission = {
  submission_id: number;
  exam_id: number;
  exam_title: string;
  exam_kind: string;
  user_id: number;
  user_name: string;
  username: string;
  status: string;
  submitted_at: string;
  coding_question_count: number;
  coding_graded_count: number;
  coding_failed_count: number;
  coding_pending_count: number;
};

type EnqueueResponse = {
  submission_id: number;
  exam_id: number;
  queued: boolean;
  status: string;
  message: string;
};

function examKindLabel(kind: string): string {
  if (kind === "quiz") return "퀴즈";
  if (kind === "assessment") return "성취도 평가";
  return kind;
}

function statusLabel(status: string): string {
  if (status === "QUEUED") return "대기";
  if (status === "RUNNING") return "채점 중";
  if (status === "GRADED") return "채점 완료";
  if (status === "FAILED") return "채점 실패";
  if (status === "SUBMITTED") return "제출 완료";
  return status;
}

export function AdminAutoGradingManager({
  initialExams,
  initialSubmissions,
}: {
  initialExams: ExamSummary[];
  initialSubmissions: GradingSubmission[];
}) {
  const [rows, setRows] = useState(initialSubmissions);
  const [examIdFilter, setExamIdFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [studentFilter, setStudentFilter] = useState<string>("all");
  const [studentSearchKeyword, setStudentSearchKeyword] = useState("");
  const [codingOnly, setCodingOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [runningIds, setRunningIds] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const studentOptions = useMemo(() => {
    const names = new Set(rows.map((row) => row.user_name));
    return [...names].sort((a, b) => a.localeCompare(b, "ko"));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const keyword = studentSearchKeyword.trim().toLocaleLowerCase("ko");
    return rows.filter((row) => {
      if (studentFilter !== "all" && row.user_name !== studentFilter) return false;
      if (!keyword) return true;
      return (
        row.user_name.toLocaleLowerCase("ko").includes(keyword) ||
        row.username.toLocaleLowerCase("ko").includes(keyword)
      );
    });
  }, [rows, studentFilter, studentSearchKeyword]);

  const queueableRows = useMemo(
    () =>
      filteredRows.filter(
        (row) => row.status === "FAILED" || (row.status === "SUBMITTED" && Number(row.coding_pending_count) > 0)
      ),
    [filteredRows]
  );

  const buildQuery = () => {
    const params = new URLSearchParams();
    if (examIdFilter !== "all") params.set("exam_id", examIdFilter);
    if (statusFilter !== "all") params.set("status", statusFilter);
    params.set("coding_only", String(codingOnly));
    return params.toString();
  };

  const reload = async () => {
    setLoading(true);
    setError("");
    const query = buildQuery();
    const response = await fetch(`/api/admin/grading/exam-submissions${query ? `?${query}` : ""}`, {
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => [])) as
      | GradingSubmission[]
      | { detail?: string; message?: string };
    if (!response.ok) {
      const apiError = payload as { detail?: string; message?: string };
      setError(apiError.detail ?? apiError.message ?? "자동 채점 목록을 불러오지 못했습니다.");
      setLoading(false);
      return;
    }
    setRows(payload as GradingSubmission[]);
    setLoading(false);
  };

  const runOne = async (submissionId: number, force: boolean) => {
    setError("");
    setMessage("");
    setRunningIds((prev) => new Set(prev).add(submissionId));
    try {
      const response = await fetch(`/api/admin/grading/exam-submissions/${submissionId}/enqueue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const payload = (await response.json().catch(() => ({}))) as EnqueueResponse & {
        detail?: string;
        message?: string;
      };
      if (!response.ok) {
        setError(payload.detail ?? payload.message ?? "자동 채점 실행에 실패했습니다.");
        return;
      }
      setMessage(payload.message);
      await reload();
    } finally {
      setRunningIds((prev) => {
        const next = new Set(prev);
        next.delete(submissionId);
        return next;
      });
    }
  };

  const runBulk = async () => {
    if (examIdFilter === "all") {
      setMessage("시험을 선택한 뒤 자동 채점 시작! 버튼으로 승인해 주세요.");
      return;
    }
    if (queueableRows.length === 0) {
      setMessage("현재 실행 가능한 제출이 없습니다.");
      return;
    }
    setError("");
    setMessage("");
    setLoading(true);
    const targetIds = queueableRows.map((row) => row.submission_id);
    setRunningIds(new Set(targetIds));
    try {
      let success = 0;
      for (const submissionId of targetIds) {
        const response = await fetch(`/api/admin/grading/exam-submissions/${submissionId}/enqueue`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force: false }),
        });
        if (response.ok) success += 1;
      }
      await reload();
      setMessage(`자동 채점 승인 완료: ${success}/${targetIds.length}`);
    } finally {
      setRunningIds(new Set());
      setLoading(false);
    }
  };

  return (
    <main className="qa-shell space-y-6">
      <section className="qa-card bg-hero text-hero-foreground">
        <BackButton fallbackHref="/" tone="hero" />
        <p className="qa-kicker mt-4 text-hero-foreground/80">관리자</p>
        <h1 className="mt-2 text-3xl font-bold">자동 채점 관리</h1>
        <p className="mt-2 text-sm text-hero-foreground/90">
          객관식은 즉시 정답 비교로 채점되고, 주관식/코딩은 정답 기준 LLM 채점으로 처리됩니다.
        </p>
        <p className="mt-1 text-xs text-hero-foreground/80">
          주관식/코딩 LLM 자동채점을 시작하려면 아래 자동 채점 시작! 버튼으로 승인해 주세요.
        </p>
      </section>

      {error ? <p className="qa-card text-sm text-destructive">{error}</p> : null}
      {message ? <p className="qa-card text-sm text-emerald-700">{message}</p> : null}

      <section className="qa-card space-y-3">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
          <select
            className="h-11 rounded-xl border border-border/70 bg-background/80 px-3 text-sm"
            value={examIdFilter}
            onChange={(event) => setExamIdFilter(event.target.value)}
          >
            <option value="all">전체 시험</option>
            {initialExams.map((exam) => (
              <option key={exam.id} value={exam.id}>
                #{exam.id} {exam.title}
              </option>
            ))}
          </select>

          <select
            className="h-11 rounded-xl border border-border/70 bg-background/80 px-3 text-sm"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">전체 상태</option>
            <option value="submitted">제출 완료</option>
            <option value="failed">채점 실패</option>
            <option value="queued">채점 대기</option>
            <option value="running">채점 중</option>
            <option value="graded">채점 완료</option>
          </select>

          <select
            className="h-11 rounded-xl border border-border/70 bg-background/80 px-3 text-sm"
            value={studentFilter}
            onChange={(event) => setStudentFilter(event.target.value)}
          >
            <option value="all">전체 학생</option>
            {studentOptions.map((userName) => (
              <option key={userName} value={userName}>
                {userName}
              </option>
            ))}
          </select>

          <Input
            className="h-11"
            placeholder="학생 이름/아이디 검색"
            value={studentSearchKeyword}
            onChange={(event) => setStudentSearchKeyword(event.target.value)}
          />

          <label className="flex items-center gap-2 rounded-xl border border-border/70 px-3 text-sm">
            <input type="checkbox" checked={codingOnly} onChange={(event) => setCodingOnly(event.target.checked)} />
            코딩 문항 제출만 보기
          </label>

          <div className="flex flex-wrap items-center gap-2 xl:col-span-2">
            <Button type="button" variant="outline" onClick={() => void reload()} disabled={loading}>
              {loading ? "불러오는 중..." : "새로고침"}
            </Button>
            <Button type="button" onClick={() => void runBulk()} disabled={loading || queueableRows.length === 0}>
              자동 채점 시작!
            </Button>
          </div>
        </div>
      </section>

      <section className="qa-card space-y-3">
        <h2 className="text-lg font-semibold">자동 채점 대상 목록</h2>
        <p className="text-xs text-muted-foreground">
          전체 {rows.length}건
          {studentFilter !== "all" || studentSearchKeyword.trim().length > 0 ? ` | 필터 적용 ${filteredRows.length}건` : ""}
        </p>
        {filteredRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {codingOnly
              ? "코딩 문항 제출이 아직 없어 자동채점 대상을 표시할 수 없습니다. 상단 '코딩 문항 제출만 보기'를 해제하면 주관식/코딩 전체 자동채점 대상을 확인할 수 있습니다."
              : "조건에 맞는 제출이 없습니다."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border/70">
            <table className="min-w-full text-sm">
              <thead className="bg-surface-muted text-left">
                <tr>
                  <th className="px-3 py-2">제출</th>
                  <th className="px-3 py-2">시험</th>
                  <th className="px-3 py-2">응시자</th>
                  <th className="px-3 py-2">상태</th>
                  <th className="px-3 py-2">LLM 채점</th>
                  <th className="px-3 py-2">제출 시각</th>
                  <th className="px-3 py-2">액션</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const isRunning = runningIds.has(row.submission_id);
                  return (
                    <tr key={row.submission_id} className="border-t border-border/70">
                      <td className="px-3 py-2">#{row.submission_id}</td>
                      <td className="px-3 py-2">
                        #{row.exam_id} {row.exam_title}
                        <div className="text-xs text-muted-foreground">{examKindLabel(row.exam_kind)}</div>
                      </td>
                      <td className="px-3 py-2">
                        {row.user_name}
                        <div className="text-xs text-muted-foreground">{row.username}</div>
                      </td>
                      <td className="px-3 py-2">{statusLabel(row.status)}</td>
                      <td className="px-3 py-2">
                        {row.coding_graded_count}/{row.coding_question_count} 완료
                        <div className="text-xs text-muted-foreground">
                          실패 {row.coding_failed_count}, 대기 {row.coding_pending_count}
                        </div>
                      </td>
                      <td className="px-3 py-2">{new Date(row.submitted_at).toLocaleString()}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            className="h-8 px-2 text-xs"
                            onClick={() => void runOne(row.submission_id, false)}
                            disabled={isRunning}
                          >
                            {isRunning ? "실행 중..." : "채점 시작"}
                          </Button>
                          <Button
                            type="button"
                            className="h-8 px-2 text-xs"
                            onClick={() => void runOne(row.submission_id, true)}
                            disabled={isRunning}
                          >
                            강제 재채점 시작
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

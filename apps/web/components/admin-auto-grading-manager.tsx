"use client";

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
  review_pending_count: number;
  has_review_pending: boolean;
  results_published: boolean;
  results_published_at: string | null;
  results_publish_scope: "none" | "exam" | "submission";
};

type EnqueueResponse = {
  submission_id: number;
  exam_id: number;
  queued: boolean;
  status: string;
  message: string;
};

type ShareResponse = {
  updated_count?: number;
  message?: string;
  detail?: string;
};

type ShareConfirmState =
  | {
      scope: "exam";
      published: boolean;
      examTitle: string;
    }
  | {
      scope: "submission";
      published: boolean;
      examTitle: string;
      submissionId: number;
      userName: string;
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
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [runningIds, setRunningIds] = useState<Set<number>>(new Set());
  const [sharingIds, setSharingIds] = useState<Set<number>>(new Set());
  const [sharingExam, setSharingExam] = useState(false);
  const [shareConfirm, setShareConfirm] = useState<ShareConfirmState | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const studentOptions = useMemo(() => {
    const names = new Set(rows.map((row) => row.user_name));
    return [...names].sort((a, b) => a.localeCompare(b, "ko"));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const keyword = studentSearchKeyword.trim().toLocaleLowerCase("ko");
    return rows.filter((row) => {
      if (examIdFilter !== "all" && String(row.exam_id) !== examIdFilter) return false;
      if (statusFilter !== "all" && row.status.toLowerCase() !== statusFilter.toLowerCase()) return false;
      if (codingOnly && Number(row.coding_question_count) === 0) return false;
      if (needsReviewOnly && !row.has_review_pending) return false;
      if (studentFilter !== "all" && row.user_name !== studentFilter) return false;
      if (!keyword) return true;
      return (
        row.user_name.toLocaleLowerCase("ko").includes(keyword) ||
        row.username.toLocaleLowerCase("ko").includes(keyword)
      );
    });
  }, [codingOnly, examIdFilter, needsReviewOnly, rows, statusFilter, studentFilter, studentSearchKeyword]);

  const queueableRows = useMemo(
    () =>
      filteredRows.filter(
        (row) => row.status === "FAILED" || (row.status === "SUBMITTED" && Number(row.coding_pending_count) > 0)
      ),
    [filteredRows]
  );

  const hasActiveFilters = useMemo(
    () =>
      examIdFilter !== "all" ||
      statusFilter !== "all" ||
      codingOnly ||
      needsReviewOnly ||
      studentFilter !== "all" ||
      studentSearchKeyword.trim().length > 0,
    [codingOnly, examIdFilter, needsReviewOnly, statusFilter, studentFilter, studentSearchKeyword]
  );

  const selectedExamRows = useMemo(
    () => (examIdFilter === "all" ? [] : rows.filter((row) => String(row.exam_id) === examIdFilter)),
    [examIdFilter, rows]
  );

  const selectedExamTitle = useMemo(
    () => initialExams.find((exam) => String(exam.id) === examIdFilter)?.title ?? "선택 시험",
    [examIdFilter, initialExams]
  );

  const examShareDisabledReason = useMemo(() => {
    if (examIdFilter === "all") return "시험을 먼저 선택해 주세요.";
    if (statusFilter !== "all" || codingOnly || needsReviewOnly) {
      return "시험 전체 공유는 전체 상태 + 코딩 문항 제출만 보기 해제 상태에서만 가능합니다.";
    }
    if (selectedExamRows.length === 0) return "공유할 제출이 없습니다.";
    if (selectedExamRows.some((row) => row.status !== "GRADED")) {
      return "채점이 완료되지 않은 제출이 있어 아직 공유할 수 없습니다.";
    }
    if (selectedExamRows.some((row) => row.has_review_pending)) {
      return "검토 필요 항목이 남아 있어 아직 공유할 수 없습니다.";
    }
    return null;
  }, [codingOnly, examIdFilter, needsReviewOnly, selectedExamRows, statusFilter]);

  const canPublishExamResults = examShareDisabledReason === null;
  const isConfirmingShare =
    sharingExam ||
    (shareConfirm?.scope === "submission" ? sharingIds.has(shareConfirm.submissionId) : false);

  const buildQuery = useCallback(() => {
    const params = new URLSearchParams();
    if (examIdFilter !== "all") params.set("exam_id", examIdFilter);
    if (statusFilter !== "all") params.set("status", statusFilter);
    params.set("coding_only", String(codingOnly));
    params.set("needs_review_only", String(needsReviewOnly));
    return params.toString();
  }, [codingOnly, examIdFilter, needsReviewOnly, statusFilter]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
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
        return;
      }
      setRows(payload as GradingSubmission[]);
    } catch {
      setError("자동 채점 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!shareConfirm) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isConfirmingShare) {
        setShareConfirm(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isConfirmingShare, shareConfirm]);

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

  const shareOne = async (submissionId: number, published: boolean) => {
    setError("");
    setMessage("");
    setSharingIds((prev) => new Set(prev).add(submissionId));
    try {
      const response = await fetch("/api/admin/grading/exam-submissions/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submission_ids: [submissionId], published }),
      });
      const payload = (await response.json().catch(() => ({}))) as ShareResponse;
      if (!response.ok) {
        setError(payload.detail ?? payload.message ?? "결과 공유 상태를 변경하지 못했습니다.");
        return;
      }
      setMessage(payload.message ?? (published ? "해당 수강생에게 결과를 공유했습니다." : "해당 수강생 공유를 해제했습니다."));
      await reload();
    } catch {
      setError("결과 공유 요청에 실패했습니다.");
    } finally {
      setSharingIds((prev) => {
        const next = new Set(prev);
        next.delete(submissionId);
        return next;
      });
    }
  };

  const shareExamResults = async (published: boolean) => {
    if (examIdFilter === "all") {
      setMessage("시험을 먼저 선택해 주세요.");
      return;
    }
    setError("");
    setMessage("");
    setSharingExam(true);
    try {
      const response = await fetch(`/api/admin/exams/${examIdFilter}/results-share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ published }),
      });
      const payload = (await response.json().catch(() => ({}))) as ShareResponse;
      if (!response.ok) {
        setError(payload.detail ?? payload.message ?? "시험 전체 결과 공유 상태를 변경하지 못했습니다.");
        return;
      }
      setMessage(published ? "해당 시험 전체 수강생에게 결과를 공유했습니다." : "해당 시험 전체 결과 공유를 해제했습니다.");
      await reload();
    } catch {
      setError("시험 결과 공유 요청에 실패했습니다.");
    } finally {
      setSharingExam(false);
    }
  };

  const openShareSubmissionConfirm = (row: GradingSubmission) => {
    const nextPublished = !row.results_published;
    if (nextPublished && row.status !== "GRADED") {
      setError("채점이 완료된 제출만 공유할 수 있습니다.");
      return;
    }
    if (nextPublished && row.has_review_pending) {
      setError("검토 필요 항목이 남아 있는 제출은 공유할 수 없습니다.");
      return;
    }
    setError("");
    setShareConfirm({
      scope: "submission",
      published: nextPublished,
      examTitle: row.exam_title,
      submissionId: row.submission_id,
      userName: row.user_name,
    });
  };

  const openShareExamConfirm = (published: boolean) => {
    if (published && examShareDisabledReason) {
      setError(examShareDisabledReason);
      return;
    }
    if (examIdFilter === "all") {
      setMessage("시험을 먼저 선택해 주세요.");
      return;
    }
    setError("");
    setShareConfirm({
      scope: "exam",
      published,
      examTitle: selectedExamTitle,
    });
  };

  const confirmShare = async () => {
    if (!shareConfirm) return;
    if (shareConfirm.scope === "submission") {
      await shareOne(shareConfirm.submissionId, shareConfirm.published);
    } else {
      await shareExamResults(shareConfirm.published);
    }
    setShareConfirm(null);
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
                {exam.title}
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

          <label className="flex items-center gap-2 rounded-xl border border-border/70 px-3 text-sm">
            <input
              type="checkbox"
              checked={needsReviewOnly}
              onChange={(event) => setNeedsReviewOnly(event.target.checked)}
            />
            검토 필요만 보기
          </label>

          <div className="flex flex-wrap items-center gap-2 xl:col-span-2">
            <Button type="button" variant="outline" onClick={() => void reload()} disabled={loading}>
              {loading ? "불러오는 중..." : "새로고침"}
            </Button>
            <Button type="button" onClick={() => void runBulk()} disabled={loading || queueableRows.length === 0}>
              자동 채점 시작!
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => openShareExamConfirm(true)}
              disabled={sharingExam || !canPublishExamResults}
              title={examShareDisabledReason ?? undefined}
            >
              {sharingExam ? "처리 중..." : "이 시험 전체 공유"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => openShareExamConfirm(false)}
              disabled={sharingExam || examIdFilter === "all"}
            >
              {sharingExam ? "처리 중..." : "이 시험 전체 공유 해제"}
            </Button>
            {examIdFilter !== "all" && examShareDisabledReason ? (
              <p className="w-full text-xs text-amber-700">{examShareDisabledReason}</p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="qa-card space-y-3">
        <h2 className="text-lg font-semibold">자동 채점 대상 목록</h2>
        <p className="text-xs text-muted-foreground">
          전체 {rows.length}건{hasActiveFilters ? ` | 필터 적용 ${filteredRows.length}건` : ""}
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
                  <th className="px-3 py-2">제출 ID</th>
                  <th className="px-3 py-2">시험</th>
                  <th className="px-3 py-2">응시자</th>
                  <th className="px-3 py-2">상태</th>
                  <th className="px-3 py-2">결과 공유</th>
                  <th className="px-3 py-2">LLM 채점</th>
                  <th className="px-3 py-2">제출 시각</th>
                  <th className="px-3 py-2">액션</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const isRunning = runningIds.has(row.submission_id);
                  const isSharing = sharingIds.has(row.submission_id);
                  const canPublishSubmission = row.status === "GRADED" && !row.has_review_pending;
                  const rowShareDisabled =
                    isSharing ||
                    row.results_publish_scope === "exam" ||
                    (!row.results_published && !canPublishSubmission);
                  return (
                    <tr key={row.submission_id} className="border-t border-border/70">
                      <td className="px-3 py-2">{row.submission_id}</td>
                      <td className="px-3 py-2">
                        {row.exam_title}
                        <div className="text-xs text-muted-foreground">{examKindLabel(row.exam_kind)}</div>
                      </td>
                      <td className="px-3 py-2">
                        {row.user_name}
                        <div className="text-xs text-muted-foreground">{row.username}</div>
                      </td>
                      <td className="px-3 py-2">
                        {statusLabel(row.status)}
                        {row.has_review_pending ? (
                          <div className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                            검토 필요 {row.review_pending_count}건
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        {row.results_published ? (
                          <div className="text-xs">
                            <p className="font-medium text-emerald-700">
                              {row.results_publish_scope === "exam" ? "시험 전체 공유" : "개별 공유"}
                            </p>
                            {row.results_published_at ? (
                              <p className="text-muted-foreground">{formatDateTimeKST(row.results_published_at)}</p>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">미공유</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {row.coding_graded_count}/{row.coding_question_count} 완료
                        <div className="text-xs text-muted-foreground">
                          실패 {row.coding_failed_count}, 대기 {row.coding_pending_count}
                        </div>
                      </td>
                      <td className="px-3 py-2">{formatDateTimeKST(row.submitted_at)}</td>
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
                          <Button
                            type="button"
                            variant="outline"
                            className="h-8 px-2 text-xs"
                            onClick={() => openShareSubmissionConfirm(row)}
                            disabled={rowShareDisabled}
                            title={!row.results_published && !canPublishSubmission ? "채점 완료 + 검토 확정 후 공유 가능합니다." : undefined}
                          >
                            {row.results_publish_scope === "exam"
                              ? "시험 전체 공유 중"
                              : isSharing
                                ? "처리 중..."
                                : !row.results_published && !canPublishSubmission
                                  ? "검토 확정 후 공유 가능"
                                : row.results_published
                                  ? "이 학생 공유 해제"
                                  : "이 학생 공유"}
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
      {shareConfirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-md rounded-2xl border border-border/70 bg-card p-5 shadow-xl">
            <h2 className="text-lg font-semibold">결과 공유 확정</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {shareConfirm.scope === "exam"
                ? shareConfirm.published
                  ? `시험 "${shareConfirm.examTitle}"의 채점 완료 결과를 전체 수강생에게 공유하시겠습니까?`
                  : `시험 "${shareConfirm.examTitle}"의 전체 공유를 해제하시겠습니까?`
                : shareConfirm.published
                  ? `${shareConfirm.userName} 수강생에게 "${shareConfirm.examTitle}" 제출 결과를 공유하시겠습니까?`
                  : `${shareConfirm.userName} 수강생의 제출 결과 공유를 해제하시겠습니까?`}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              확정 후 즉시 학생 화면에 반영됩니다.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShareConfirm(null)} disabled={isConfirmingShare}>
                취소
              </Button>
              <Button type="button" onClick={() => void confirmShare()} disabled={isConfirmingShare}>
                {isConfirmingShare ? "처리 중..." : shareConfirm.published ? "공유 확정" : "해제 확정"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

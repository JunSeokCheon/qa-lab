"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";

type RunPublicResponse = {
  status: string;
  summary: {
    problem_version: number;
    docker_exit_code: number;
    duration_ms: number;
    stdout: string;
    stderr: string;
  };
  public_feedback: {
    passed: number;
    total: number;
    failed_cases: Array<{ name: string; outcome: string; message: string }>;
  };
};

type SubmissionResponse = {
  id: number;
  status: string;
  grade: { score: number; max_score: number } | null;
};

export function ProblemWorkbench({ problemId, problemVersionId }: { problemId: number; problemVersionId: number }) {
  const readyRef = useRef<HTMLParagraphElement | null>(null);
  const [codeText, setCodeText] = useState("def solve(a, b):\n    return a + b\n");
  const [runLoading, setRunLoading] = useState(false);
  const [runError, setRunError] = useState("");
  const [runResult, setRunResult] = useState<RunPublicResponse | null>(null);

  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submissionId, setSubmissionId] = useState<number | null>(null);
  const [statusTimeline, setStatusTimeline] = useState<string[]>([]);
  const [finalScore, setFinalScore] = useState<string>("-");

  const statusText = useMemo(() => statusTimeline.join(" -> "), [statusTimeline]);

  useEffect(() => {
    readyRef.current?.setAttribute("data-ready", "1");
  }, []);

  const onRunPublic = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRunLoading(true);
    setRunError("");
    setRunResult(null);

    const response = await fetch(`/api/problems/${problemId}/run-public`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code_text: codeText }),
    });
    const body = (await response.json().catch(() => ({}))) as RunPublicResponse & { detail?: string; message?: string };
    if (!response.ok) {
      setRunError(body.detail ?? body.message ?? "Public tests 실행 실패");
      setRunLoading(false);
      return;
    }

    setRunResult(body);
    setRunLoading(false);
  };

  const onSubmitCode = async () => {
    setSubmitLoading(true);
    setSubmitError("");
    setSubmissionId(null);
    setStatusTimeline([]);
    setFinalScore("-");

    const response = await fetch("/api/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ problem_version_id: problemVersionId, code_text: codeText }),
    });

    const created = (await response.json().catch(() => ({}))) as SubmissionResponse & { detail?: string; message?: string };
    if (!response.ok || !created.id) {
      setSubmitError(created.detail ?? created.message ?? "제출 실패");
      setSubmitLoading(false);
      return;
    }

    setSubmissionId(created.id);
    setStatusTimeline([created.status]);

    const startedAt = Date.now();
    let currentStatus = created.status;
    while (Date.now() - startedAt < 60_000) {
      if (currentStatus === "GRADED" || currentStatus === "FAILED") {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 1500));
      const pollResponse = await fetch(`/api/submissions/${created.id}`, { cache: "no-store" });
      const polled = (await pollResponse.json().catch(() => ({}))) as SubmissionResponse;
      if (!pollResponse.ok) {
        setSubmitError("제출 상태 조회 실패");
        break;
      }

      if (polled.status !== currentStatus) {
        currentStatus = polled.status;
        setStatusTimeline((prev) => (prev.includes(polled.status) ? prev : [...prev, polled.status]));
      }

      if (polled.status === "GRADED") {
        if (polled.grade) {
          setFinalScore(`${polled.grade.score}/${polled.grade.max_score}`);
        }
        break;
      }
      if (polled.status === "FAILED") {
        break;
      }
    }

    setSubmitLoading(false);
  };

  return (
    <section className="mt-6 rounded-xl border p-4" data-testid="problem-workbench">
      <h2 className="text-xl font-semibold">Problem Workbench</h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        problem_id={problemId}, version_id={problemVersionId}
      </p>
      <p ref={readyRef} className="sr-only" data-ready="0" data-testid="workbench-ready">
        ready
      </p>

      <form onSubmit={onRunPublic} className="mt-4 space-y-3">
        <textarea
          className="min-h-44 w-full rounded border px-3 py-2 font-mono text-sm"
          value={codeText}
          onChange={(e) => setCodeText(e.target.value)}
          data-testid="code-input"
        />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={runLoading} data-testid="run-public-button">
            {runLoading ? "Running..." : "Run public tests"}
          </Button>
          <Button type="button" disabled={submitLoading} onClick={onSubmitCode} data-testid="submit-button">
            {submitLoading ? "Submitting..." : "Submit"}
          </Button>
        </div>
      </form>

      {runError ? <p className="mt-3 text-sm text-red-600">{runError}</p> : null}
      {runResult ? (
        <div className="mt-4 rounded-lg bg-zinc-100 p-3 text-sm dark:bg-zinc-900" data-testid="public-result-panel">
          <p data-testid="public-status">status: {runResult.status}</p>
          <p data-testid="public-summary">
            summary: passed {runResult.public_feedback.passed}/{runResult.public_feedback.total},{" "}
            {runResult.summary.duration_ms}ms
          </p>
        </div>
      ) : null}

      {submitError ? <p className="mt-3 text-sm text-red-600">{submitError}</p> : null}
      <div className="mt-4 rounded-lg bg-zinc-100 p-3 text-sm dark:bg-zinc-900" data-testid="submission-panel">
        <p>submission_id: {submissionId ?? "-"}</p>
        <p data-testid="submission-status-timeline">status timeline: {statusText || "-"}</p>
        <p data-testid="submission-score">score: {finalScore}</p>
      </div>
    </section>
  );
}

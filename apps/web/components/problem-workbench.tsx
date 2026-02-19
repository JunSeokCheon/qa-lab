"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

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
  const codeKey = `qa-lab:code:${problemId}:${problemVersionId}`;

  const [codeText, setCodeText] = useState("def solve(a, b):\n    return a + b\n");
  const [runLoading, setRunLoading] = useState(false);
  const [runError, setRunError] = useState("");
  const [runResult, setRunResult] = useState<RunPublicResponse | null>(null);

  const [submitLoading, setSubmitLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submissionId, setSubmissionId] = useState<number | null>(null);
  const [statusTimeline, setStatusTimeline] = useState<string[]>([]);
  const [finalScore, setFinalScore] = useState<string>("-");

  const canRun = codeText.trim().length > 0;
  const statusText = useMemo(() => statusTimeline.join(" -> "), [statusTimeline]);
  const codeLineCount = useMemo(() => codeText.split("\n").length, [codeText]);
  const codeCharCount = useMemo(() => codeText.length, [codeText]);
  const latestStatus = statusTimeline.at(-1) ?? "-";
  const statusTone =
    latestStatus === "GRADED"
      ? "bg-emerald-100 text-emerald-800"
      : latestStatus === "FAILED"
        ? "bg-rose-100 text-rose-700"
        : latestStatus === "RUNNING"
          ? "bg-amber-100 text-amber-800"
          : "bg-slate-100 text-slate-700";

  useEffect(() => {
    readyRef.current?.setAttribute("data-ready", "1");
    if (typeof window === "undefined") {
      return;
    }
    const saved = window.localStorage.getItem(codeKey);
    if (saved) {
      setCodeText(saved);
    }
  }, [codeKey]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(codeKey, codeText);
  }, [codeKey, codeText]);

  const onRunPublic = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canRun) {
      return;
    }

    setRunLoading(true);
    setRunError("");
    setRunResult(null);

    try {
      const response = await fetch("/api/run-public", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ problem_id: problemId, code_text: codeText }),
      });
      const body = (await response.json().catch(() => ({}))) as RunPublicResponse & { detail?: string; message?: string };
      if (!response.ok) {
        setRunError(body.detail ?? body.message ?? "Public test run failed");
        return;
      }
      setRunResult(body);
    } catch {
      setRunError("Network error while running public tests");
    } finally {
      setRunLoading(false);
    }
  };

  const onSubmitCode = async () => {
    if (!canRun) {
      return;
    }

    setSubmitLoading(true);
    setPolling(false);
    setSubmitError("");
    setSubmissionId(null);
    setStatusTimeline([]);
    setFinalScore("-");

    try {
      const response = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ problem_version_id: problemVersionId, code_text: codeText }),
      });

      const created = (await response.json().catch(() => ({}))) as SubmissionResponse & { detail?: string; message?: string };
      if (!response.ok || !created.id) {
        setSubmitError(created.detail ?? created.message ?? "Submit failed");
        return;
      }

      setSubmissionId(created.id);
      setStatusTimeline([created.status]);
      setPolling(true);

      const startedAt = Date.now();
      let currentStatus = created.status;
      while (Date.now() - startedAt < 60_000) {
        if (currentStatus === "GRADED" || currentStatus === "FAILED") {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 1500));
        const pollResponse = await fetch("/api/submissions/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ submission_id: created.id }),
          cache: "no-store",
        });
        const polled = (await pollResponse.json().catch(() => ({}))) as SubmissionResponse;
        if (!pollResponse.ok) {
          setSubmitError("Failed to refresh submission status");
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

      if (currentStatus !== "GRADED" && currentStatus !== "FAILED") {
        setSubmitError("Grading is taking longer than expected. Try checking My submissions.");
      }
    } catch {
      setSubmitError("Network error while submitting");
    } finally {
      setPolling(false);
      setSubmitLoading(false);
    }
  };

  const onResetCode = () => {
    setCodeText("def solve(a, b):\n    return a + b\n");
  };

  const onEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) {
        void onRunPublic({ preventDefault: () => undefined } as FormEvent<HTMLFormElement>);
      } else {
        void onSubmitCode();
      }
    }
  };

  return (
    <section className="qa-card mt-6" data-testid="problem-workbench">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Problem Workbench</h2>
          <p className="text-sm text-muted-foreground">
            problem_id={problemId}, version_id={problemVersionId}
          </p>
        </div>
        <div className="rounded-xl bg-surface-muted px-3 py-2 text-xs text-muted-foreground">
          <p>Shortcuts</p>
          <p>Ctrl/Cmd + Enter: submit</p>
          <p>Ctrl/Cmd + Shift + Enter: run public tests</p>
        </div>
      </div>

      <p className="mt-2 text-sm text-muted-foreground">lines {codeLineCount} · chars {codeCharCount}</p>
      <p ref={readyRef} className="sr-only" data-ready="0" data-testid="workbench-ready">
        ready
      </p>

      <form onSubmit={onRunPublic} className="mt-4 space-y-3">
        <Textarea
          className="min-h-52"
          value={codeText}
          onChange={(e) => setCodeText(e.target.value)}
          onKeyDown={onEditorKeyDown}
          data-testid="code-input"
        />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={runLoading || !canRun} data-testid="run-public-button">
            {runLoading ? "Running..." : "Run public tests"}
          </Button>
          <Button type="button" disabled={submitLoading || !canRun} onClick={onSubmitCode} data-testid="submit-button">
            {submitLoading ? "Submitting..." : "Submit"}
          </Button>
          <Button type="button" variant="outline" onClick={onResetCode}>
            Reset code
          </Button>
        </div>
      </form>

      {runError ? <p className="mt-3 text-sm text-destructive">{runError}</p> : null}
      {runResult ? (
        <div className="mt-4 space-y-2 rounded-2xl bg-surface-muted p-3 text-sm" data-testid="public-result-panel">
          <p data-testid="public-status">status: {runResult.status}</p>
          <p data-testid="public-summary">
            summary: passed {runResult.public_feedback.passed}/{runResult.public_feedback.total}, {runResult.summary.duration_ms}ms
          </p>
          {runResult.public_feedback.failed_cases.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              {runResult.public_feedback.failed_cases.map((item) => (
                <li key={item.name}>
                  {item.name}: {item.outcome}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {submitError ? <p className="mt-3 text-sm text-destructive">{submitError}</p> : null}
      <div className="mt-4 space-y-2 rounded-2xl bg-surface-muted p-3 text-sm" data-testid="submission-panel">
        <p>submission_id: {submissionId ?? "-"}</p>
        <p className="text-xs">
          latest status: <span className={`rounded px-2 py-1 font-semibold ${statusTone}`}>{latestStatus}</span>
          {polling ? <span className="ml-2 text-muted-foreground">polling...</span> : null}
        </p>
        <p data-testid="submission-status-timeline">status timeline: {statusText || "-"}</p>
        <p data-testid="submission-score">score: {finalScore}</p>
      </div>
    </section>
  );
}

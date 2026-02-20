"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type ProblemType = "coding" | "multiple_choice" | "subjective";

type SubmissionResponse = {
  id: number;
  status: string;
  grade: { score: number; max_score: number } | null;
};

function typeGuide(problemType: ProblemType): string {
  if (problemType === "coding") return "코드를 작성해 제출하면 비동기 채점됩니다.";
  if (problemType === "multiple_choice") return "정답을 선택해 제출하면 즉시 채점됩니다.";
  return "답안을 작성해 제출하면 즉시 채점됩니다.";
}

function typeLabel(problemType: ProblemType): string {
  if (problemType === "coding") return "코드";
  if (problemType === "multiple_choice") return "객관식";
  return "주관식";
}

function statusLabel(status: string): string {
  if (status === "QUEUED") return "대기";
  if (status === "RUNNING") return "채점 중";
  if (status === "GRADED") return "채점 완료";
  if (status === "FAILED") return "채점 실패";
  if (status === "-") return "-";
  return status;
}

export function ProblemWorkbench({
  problemId,
  problemVersionId,
  problemType,
  questionMeta,
}: {
  problemId: number;
  problemVersionId: number;
  problemType: ProblemType;
  questionMeta: { choices?: string[] } | null;
}) {
  const readyRef = useRef<HTMLParagraphElement | null>(null);
  const codeKey = `qa-lab:code:${problemId}:${problemVersionId}`;
  const answerKey = `qa-lab:answer:${problemId}:${problemVersionId}`;

  const [textInput, setTextInput] = useState(problemType === "coding" ? "def solve(a, b):\n    return a + b\n" : "");
  const [selectedChoice, setSelectedChoice] = useState("");
  const [submitLoading, setSubmitLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submissionId, setSubmissionId] = useState<number | null>(null);
  const [statusTimeline, setStatusTimeline] = useState<string[]>([]);
  const [finalScore, setFinalScore] = useState<string>("-");

  const choices = useMemo(() => (problemType === "multiple_choice" ? questionMeta?.choices ?? [] : []), [problemType, questionMeta]);
  const submitPayload = useMemo(() => {
    if (problemType === "multiple_choice") return selectedChoice;
    return textInput;
  }, [problemType, selectedChoice, textInput]);

  const canSubmit = submitPayload.trim().length > 0;
  const statusText = useMemo(() => statusTimeline.map((status) => statusLabel(status)).join(" -> "), [statusTimeline]);
  const codeLineCount = useMemo(() => textInput.split("\n").length, [textInput]);
  const codeCharCount = useMemo(() => textInput.length, [textInput]);
  const latestStatus = statusTimeline.at(-1) ?? "-";
  const latestStatusLabel = statusLabel(latestStatus);
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
    if (problemType === "coding") {
      const saved = window.localStorage.getItem(codeKey);
      if (saved) setTextInput(saved);
      return;
    }
    if (problemType === "subjective") {
      const saved = window.localStorage.getItem(answerKey);
      if (saved) setTextInput(saved);
    }
  }, [answerKey, codeKey, problemType]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (problemType === "coding") {
      window.localStorage.setItem(codeKey, textInput);
      return;
    }
    if (problemType === "subjective") {
      window.localStorage.setItem(answerKey, textInput);
    }
  }, [answerKey, codeKey, problemType, textInput]);

  const onSubmitCode = async () => {
    if (!canSubmit) return;

    setSubmitLoading(true);
    setPolling(false);
    setSubmitError("");
    setSubmissionId(null);
    setStatusTimeline([]);
    setFinalScore("-");

    try {
      const requestBody =
        problemType === "coding"
          ? { problem_version_id: problemVersionId, code_text: textInput }
          : { problem_version_id: problemVersionId, answer_text: submitPayload };

      const response = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const created = (await response.json().catch(() => ({}))) as SubmissionResponse & { detail?: string; message?: string };
      if (!response.ok || !created.id) {
        setSubmitError(created.detail ?? created.message ?? "제출에 실패했습니다.");
        return;
      }

      setSubmissionId(created.id);
      setStatusTimeline([created.status]);

      if (created.status === "GRADED" || created.status === "FAILED") {
        if (created.grade) {
          setFinalScore(`${created.grade.score}/${created.grade.max_score}`);
        }
        return;
      }

      setPolling(true);
      const startedAt = Date.now();
      let currentStatus = created.status;

      while (Date.now() - startedAt < 60_000) {
        if (currentStatus === "GRADED" || currentStatus === "FAILED") break;

        await new Promise((resolve) => setTimeout(resolve, 1500));
        const pollResponse = await fetch("/api/submissions/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ submission_id: created.id }),
          cache: "no-store",
        });
        const polled = (await pollResponse.json().catch(() => ({}))) as SubmissionResponse;
        if (!pollResponse.ok) {
          setSubmitError("제출 상태를 새로고침하지 못했습니다.");
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
        if (polled.status === "FAILED") break;
      }

      if (currentStatus !== "GRADED" && currentStatus !== "FAILED") {
        setSubmitError("채점이 지연되고 있습니다. 잠시 후 내 제출에서 확인해주세요.");
      }
    } catch {
      setSubmitError("네트워크 오류로 제출에 실패했습니다.");
    } finally {
      setPolling(false);
      setSubmitLoading(false);
    }
  };

  const onResetInput = () => {
    if (problemType === "coding") {
      setTextInput("def solve(a, b):\n    return a + b\n");
      return;
    }
    if (problemType === "multiple_choice") {
      setSelectedChoice("");
      return;
    }
    setTextInput("");
  };

  const onEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void onSubmitCode();
    }
  };

  return (
    <section className="qa-card mt-6" data-testid="problem-workbench">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">문제 풀이</h2>
          <p className="text-sm text-muted-foreground">
            문제 ID={problemId}, 버전 ID={problemVersionId}, 유형={typeLabel(problemType)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{typeGuide(problemType)}</p>
        </div>
        <div className="rounded-xl bg-surface-muted px-3 py-2 text-xs text-muted-foreground">
          <p>단축키</p>
          <p>Ctrl/Cmd + Enter: 제출</p>
        </div>
      </div>

      {problemType === "coding" ? (
        <p className="mt-2 text-sm text-muted-foreground">
          줄 수 {codeLineCount} | 글자 수 {codeCharCount}
        </p>
      ) : null}
      <p ref={readyRef} className="sr-only" data-ready="0" data-testid="workbench-ready">
        ready
      </p>

      <div className="mt-4 space-y-3">
        {problemType === "coding" ? (
          <Textarea
            className="min-h-52"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            onKeyDown={onEditorKeyDown}
            data-testid="code-input"
          />
        ) : null}

        {problemType === "multiple_choice" ? (
          <div className="space-y-2 rounded-2xl border border-border/70 bg-surface p-4">
            {choices.length === 0 ? (
              <p className="text-sm text-muted-foreground">선택지가 설정되지 않았습니다.</p>
            ) : (
              choices.map((choice, index) => {
                const value = String(index + 1);
                return (
                  <label key={`${value}-${choice}`} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={`choice-${problemVersionId}`}
                      value={value}
                      checked={selectedChoice === value}
                      onChange={(event) => setSelectedChoice(event.target.value)}
                    />
                    <span>
                      {value}. {choice}
                    </span>
                  </label>
                );
              })
            )}
          </div>
        ) : null}

        {problemType === "subjective" ? (
          <Textarea
            className="min-h-40"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            onKeyDown={onEditorKeyDown}
            placeholder="답안을 입력하세요."
          />
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={submitLoading || !canSubmit} onClick={onSubmitCode} data-testid="submit-button">
            {submitLoading ? "제출 중..." : "제출"}
          </Button>
          <Button type="button" variant="outline" onClick={onResetInput}>
            초기화
          </Button>
        </div>
      </div>

      {submitError ? <p className="mt-3 text-sm text-destructive">{submitError}</p> : null}
      <div className="mt-4 space-y-2 rounded-2xl bg-surface-muted p-3 text-sm" data-testid="submission-panel">
        <p>제출 ID: {submissionId ?? "-"}</p>
        <p className="text-xs">
          현재 상태: <span className={`rounded px-2 py-1 font-semibold ${statusTone}`}>{latestStatusLabel}</span>
          {polling ? <span className="ml-2 text-muted-foreground">조회 중...</span> : null}
        </p>
        <p data-testid="submission-status-timeline">상태 이력: {statusText || "-"}</p>
        <p data-testid="submission-score">점수: {finalScore}</p>
      </div>
    </section>
  );
}

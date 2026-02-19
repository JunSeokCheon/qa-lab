"use client";

import { useState, type FormEvent } from "react";

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

export function PublicTestRunner() {
  const [problemId, setProblemId] = useState("1");
  const [problemVersion, setProblemVersion] = useState("");
  const [codeText, setCodeText] = useState("def solve(a, b):\n    return a + b\n");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<RunPublicResponse | null>(null);

  const onRunPublic = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);

    const payload: { code_text: string; problem_version?: number } = { code_text: codeText };
    const parsedVersion = Number(problemVersion);
    if (problemVersion.trim() && Number.isFinite(parsedVersion)) {
      payload.problem_version = parsedVersion;
    }

    const response = await fetch(`/api/problems/${problemId}/run-public`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const body = (await response.json().catch(() => ({}))) as RunPublicResponse & { detail?: string; message?: string };
    if (!response.ok) {
      setError(body.detail ?? body.message ?? "Public tests 실행에 실패했습니다.");
      setLoading(false);
      return;
    }

    setResult(body);
    setLoading(false);
  };

  return (
    <section className="mt-8 rounded-xl border p-4">
      <h2 className="text-xl font-semibold">Run public tests</h2>
      <form onSubmit={onRunPublic} className="mt-4 space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            className="rounded border px-3 py-2"
            placeholder="Problem ID"
            value={problemId}
            onChange={(e) => setProblemId(e.target.value)}
          />
          <input
            className="rounded border px-3 py-2"
            placeholder="Problem Version (optional)"
            value={problemVersion}
            onChange={(e) => setProblemVersion(e.target.value)}
          />
        </div>
        <textarea
          className="min-h-44 w-full rounded border px-3 py-2 font-mono text-sm"
          value={codeText}
          onChange={(e) => setCodeText(e.target.value)}
        />
        <Button type="submit" disabled={loading}>
          {loading ? "Running..." : "Run public tests"}
        </Button>
      </form>

      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

      {result ? (
        <div className="mt-4 space-y-3 rounded-lg bg-zinc-100 p-3 text-sm dark:bg-zinc-900">
          <p>
            status: <b>{result.status}</b>
          </p>
          <p>
            version: {result.summary.problem_version} | passed: {result.public_feedback.passed}/
            {result.public_feedback.total} | {result.summary.duration_ms}ms
          </p>
          {result.public_feedback.failed_cases.length > 0 ? (
            <div>
              <p className="font-medium">Failed cases</p>
              <ul className="list-disc pl-5">
                {result.public_feedback.failed_cases.map((item) => (
                  <li key={item.name}>
                    {item.name}: {item.outcome}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {result.summary.stderr ? (
            <pre className="max-h-44 overflow-auto rounded border bg-white p-2 text-xs dark:bg-zinc-950">
              {result.summary.stderr}
            </pre>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

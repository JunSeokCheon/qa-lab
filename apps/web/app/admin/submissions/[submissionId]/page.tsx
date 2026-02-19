import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { RegradeButton } from "@/components/regrade-button";
import { FASTAPI_BASE_URL, fetchMeWithToken } from "@/lib/auth";

type AdminSubmissionDetail = {
  id: number;
  user_id: number;
  problem_version_id: number;
  code_text: string;
  status: string;
  created_at: string;
  grade: {
    score: number;
    max_score: number;
    feedback_json: Record<string, unknown>;
  } | null;
  grade_runs: Array<{
    id: number;
    grader_image_tag: string;
    started_at: string;
    finished_at: string;
    score: number | null;
    exit_code: number;
    logs: string | null;
  }>;
};

type Params = {
  params: Promise<{ submissionId: string }>;
};

export default async function AdminSubmissionDetailPage({ params }: Params) {
  const { submissionId } = await params;
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;

  if (!token) {
    redirect("/login");
  }

  const me = await fetchMeWithToken(token);
  if (!me) {
    redirect("/login");
  }

  const response = await fetch(`${FASTAPI_BASE_URL}/admin/submissions/${submissionId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  if (response.status === 401) {
    redirect("/login");
  }
  if (response.status === 403) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold">제출 상세</h1>
        <p className="mt-4">admin 권한이 없어 접근할 수 없습니다.</p>
        <Link href="/admin" className="mt-4 inline-block underline">
          Admin으로 이동
        </Link>
      </main>
    );
  }
  if (response.status === 404) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold">제출 상세</h1>
        <p className="mt-4">해당 제출을 찾을 수 없습니다.</p>
        <Link href="/admin" className="mt-4 inline-block underline">
          Admin으로 이동
        </Link>
      </main>
    );
  }

  const detail = (await response.json()) as AdminSubmissionDetail;

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-semibold">Admin Submission #{detail.id}</h1>
      <p className="mt-2">user_id: {detail.user_id}</p>
      <p>problem_version_id: {detail.problem_version_id}</p>
      <p>status: {detail.status}</p>
      <p>
        current score: {detail.grade ? `${detail.grade.score}/${detail.grade.max_score}` : "-"}
      </p>
      <div className="mt-4">
        <RegradeButton submissionId={detail.id} />
      </div>

      <section className="mt-8">
        <h2 className="text-xl font-semibold">Grade runs</h2>
        {detail.grade_runs.length === 0 ? (
          <p className="mt-3 rounded border p-3">실행 이력이 없습니다.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {detail.grade_runs.map((run) => (
              <article key={run.id} className="rounded-lg border p-4">
                <p className="font-medium">Run #{run.id}</p>
                <p className="text-sm">
                  image: {run.grader_image_tag} | exit_code: {run.exit_code}
                </p>
                <p className="text-sm">
                  started: {new Date(run.started_at).toLocaleString()} | finished:{" "}
                  {new Date(run.finished_at).toLocaleString()}
                </p>
                <p className="text-sm">score: {run.score === null ? "-" : run.score}</p>
                {run.logs ? (
                  <pre className="mt-2 max-h-40 overflow-auto rounded border bg-zinc-50 p-2 text-xs dark:bg-zinc-900">
                    {run.logs}
                  </pre>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

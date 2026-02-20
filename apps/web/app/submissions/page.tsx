import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { BackButton } from "@/components/back-button";
import { FASTAPI_BASE_URL, fetchMeWithToken } from "@/lib/auth";

type MySubmissionItem = {
  id: number;
  problem_version_id: number;
  status: string;
  created_at: string;
  grade: { score: number; max_score: number } | null;
};

export default async function SubmissionsPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;
  if (!token) {
    redirect("/login");
  }

  const me = await fetchMeWithToken(token);
  if (!me) {
    redirect("/login");
  }

  const response = await fetch(`${FASTAPI_BASE_URL}/me/submissions?limit=50`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const submissions = (await response.json().catch(() => [])) as MySubmissionItem[];

  return (
    <main className="qa-shell space-y-6">
      <section className="qa-card">
        <BackButton />
        <p className="qa-kicker">Student</p>
        <h1 className="mt-2 text-3xl font-bold">내 제출 히스토리</h1>
        <p className="mt-2 text-sm text-muted-foreground">{me.email}</p>
      </section>

      <section className="qa-card">
        {submissions.length === 0 ? (
          <p className="text-sm text-muted-foreground">아직 제출 이력이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border/70">
            <table className="min-w-full text-sm">
              <thead className="bg-surface-muted text-left">
                <tr>
                  <th className="px-3 py-2">Submission</th>
                  <th className="px-3 py-2">Problem Version</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Score</th>
                  <th className="px-3 py-2">At</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((item) => (
                  <tr key={item.id} className="border-t border-border/70">
                    <td className="px-3 py-2">#{item.id}</td>
                    <td className="px-3 py-2">v{item.problem_version_id}</td>
                    <td className="px-3 py-2">{item.status}</td>
                    <td className="px-3 py-2">
                      {item.grade ? `${item.grade.score}/${item.grade.max_score}` : "-"}
                    </td>
                    <td className="px-3 py-2">{new Date(item.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Link href="/problems" className="mt-4 inline-block underline">
          문제 목록으로 이동
        </Link>
      </section>
    </main>
  );
}

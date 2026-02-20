import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { BackButton } from "@/components/back-button";
import { FASTAPI_BASE_URL, fetchMeWithToken } from "@/lib/auth";

type ProblemItem = {
  id: number;
  title: string;
  latest_version: { id: number; version: number; difficulty: string; max_score: number } | null;
};

export default async function ProblemsPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;
  if (!token) {
    redirect("/login");
  }

  const me = await fetchMeWithToken(token);
  if (!me) {
    redirect("/login");
  }

  const response = await fetch(`${FASTAPI_BASE_URL}/problems`, { cache: "no-store" });
  const items = (await response.json().catch(() => [])) as ProblemItem[];

  return (
    <main className="qa-shell space-y-6">
      <section className="qa-card">
        <BackButton />
        <p className="qa-kicker">Student</p>
        <h1 className="mt-2 text-3xl font-bold">문제 목록</h1>
        <p className="mt-2 text-sm text-muted-foreground">로그인 계정: {me.email}</p>
      </section>

      <section className="qa-card">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">등록된 문제가 없습니다.</p>
        ) : (
          <div className="space-y-3">
            {items.map((problem) => (
              <article key={problem.id} className="rounded-2xl border border-border/70 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-semibold">{problem.title}</h2>
                    <p className="text-xs text-muted-foreground">
                      Problem #{problem.id}{" "}
                      {problem.latest_version
                        ? `· v${problem.latest_version.version} · ${problem.latest_version.difficulty} · ${problem.latest_version.max_score}점`
                        : "· 버전 없음"}
                    </p>
                  </div>
                  <Link href={`/problems/${problem.id}`} className="underline">
                    문제 풀기
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

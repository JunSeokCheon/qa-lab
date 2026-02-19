import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { fetchMeWithToken, fetchMyProgressWithToken } from "@/lib/auth";

function masteryLevel(mastery: number): string {
  if (mastery >= 85) return "Advanced";
  if (mastery >= 60) return "Intermediate";
  if (mastery >= 30) return "Basic";
  return "Needs Practice";
}

function heatColor(mastery: number): string {
  if (mastery >= 85) return "bg-emerald-600 text-white";
  if (mastery >= 60) return "bg-emerald-400 text-black";
  if (mastery >= 30) return "bg-amber-300 text-black";
  return "bg-rose-300 text-black";
}

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;
  if (!token) {
    redirect("/login");
  }

  const me = await fetchMeWithToken(token);
  if (!me) {
    redirect("/login");
  }

  const progress = await fetchMyProgressWithToken(token);
  if (!progress) {
    return (
      <main className="qa-shell">
        <section className="qa-card">
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="mt-4">진행 정보를 불러오지 못했습니다.</p>
          <Link href="/" className="mt-4 inline-block underline">
            홈으로 이동
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="qa-shell space-y-6">
      <section className="qa-card">
        <p className="qa-kicker">Progress</p>
        <h1 className="mt-2 text-3xl font-bold">Skill Dashboard</h1>
        <p className="mt-2 text-sm text-muted-foreground">{me.email}의 현재 역량 상태입니다.</p>
      </section>

      <section className="qa-card">
        <h2 className="text-xl font-semibold">Skill Heatmap</h2>
        {progress.skills.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-border/70 bg-surface-muted p-4">
            채점된 제출이 아직 없습니다.
          </p>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {progress.skills.map((skill) => (
              <article key={skill.skill_id} className="rounded-2xl border border-border/70 bg-surface p-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium">{skill.skill_name}</h3>
                  <span className={`rounded px-2 py-1 text-xs ${heatColor(skill.mastery)}`}>
                    {skill.mastery.toFixed(1)}%
                  </span>
                </div>
                <p className="mt-2 text-sm">Level: {masteryLevel(skill.mastery)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  earned {skill.earned_points.toFixed(1)} / possible {skill.possible_points.toFixed(1)}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="qa-card">
        <h2 className="text-xl font-semibold">최근 제출 10개</h2>
        <div className="mt-3 overflow-x-auto rounded-2xl border border-border/70">
          <table className="min-w-full text-sm">
            <thead className="bg-surface-muted text-left">
              <tr>
                <th className="px-3 py-2">Submission</th>
                <th className="px-3 py-2">Problem</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Score</th>
              </tr>
            </thead>
            <tbody>
              {progress.recent_submissions.map((item) => (
                <tr key={item.submission_id} className="border-t border-border/70">
                  <td className="px-3 py-2">#{item.submission_id}</td>
                  <td className="px-3 py-2">
                    {item.problem_title} (v{item.problem_version})
                  </td>
                  <td className="px-3 py-2">{item.status}</td>
                  <td className="px-3 py-2">
                    {item.score === null || item.max_score === null ? "-" : `${item.score}/${item.max_score}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

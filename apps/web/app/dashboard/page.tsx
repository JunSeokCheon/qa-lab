import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AdminExamDashboard } from "@/components/admin-exam-dashboard";
import { BackButton } from "@/components/back-button";
import { UserExamResultDashboard } from "@/components/user-exam-result-dashboard";
import {
  FASTAPI_BASE_URL,
  fetchMeWithToken,
  fetchMyExamResultsWithToken,
  fetchMyProgressWithToken,
} from "@/lib/auth";

type ExamSummary = {
  id: number;
  title: string;
  exam_kind: string;
  target_track_name?: string | null;
  question_count: number;
};

type QueryValue = string | string[] | undefined;

type DashboardPageProps = {
  searchParams?: Promise<Record<string, QueryValue>> | Record<string, QueryValue>;
};

function firstValue(value: QueryValue): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function masteryLevel(mastery: number): string {
  if (mastery >= 85) return "강함";
  if (mastery >= 60) return "중간";
  if (mastery >= 30) return "약함";
  return "보강 필요";
}

function heatColor(mastery: number): string {
  if (mastery >= 85) return "bg-emerald-600 text-white";
  if (mastery >= 60) return "bg-emerald-400 text-black";
  if (mastery >= 30) return "bg-amber-300 text-black";
  return "bg-rose-300 text-black";
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;
  if (!token) redirect("/login");

  const me = await fetchMeWithToken(token);
  if (!me) redirect("/login");

  const resolvedParams = await Promise.resolve(searchParams ?? {});
  const rawExamId = firstValue(resolvedParams.examId);
  const rawStudent = firstValue(resolvedParams.student);
  const rawNeedsReview = firstValue(resolvedParams.needsReview);
  const initialExamId =
    rawExamId && /^\d+$/.test(rawExamId) ? Number.parseInt(rawExamId, 10) : undefined;
  const initialStudentName = rawStudent?.trim() ? rawStudent.trim() : undefined;
  const initialNeedsReviewOnly = ["1", "true", "yes", "on", "y"].includes(
    (rawNeedsReview ?? "").toLowerCase()
  );

  if (me.role === "admin") {
    const examsResponse = await fetch(`${FASTAPI_BASE_URL}/admin/exams`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const exams = (await examsResponse.json().catch(() => [])) as ExamSummary[];
    return (
      <AdminExamDashboard
        initialExams={exams}
        initialExamId={initialExamId}
        initialStudentName={initialStudentName}
        initialNeedsReviewOnly={initialNeedsReviewOnly}
      />
    );
  }

  const [progress, examResults] = await Promise.all([
    fetchMyProgressWithToken(token),
    fetchMyExamResultsWithToken(token),
  ]);

  if (!progress) {
    return (
      <main className="qa-shell">
        <section className="qa-card">
          <BackButton />
          <h1 className="mt-4 text-2xl font-semibold">대시보드</h1>
          <p className="mt-4">학습 진행 정보를 불러오지 못했습니다.</p>
          <Link href="/" className="mt-4 inline-block underline">
            홈으로 이동
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="qa-shell space-y-6">
      <section className="qa-card bg-hero text-hero-foreground">
        <BackButton tone="hero" />
        <p className="qa-kicker mt-4 text-hero-foreground/80">학습 진행</p>
        <h1 className="mt-2 text-3xl font-bold">성취도 대시보드</h1>
        <p className="mt-2 text-sm text-hero-foreground/90">{me.username} 님의 현재 성취도입니다.</p>
      </section>

      <UserExamResultDashboard results={examResults ?? []} />

      <section className="qa-card">
        <h2 className="text-xl font-semibold">스킬 히트맵</h2>
        {progress.skills.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-border/70 bg-surface-muted p-4">
            아직 채점된 제출이 없습니다.
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
                <p className="mt-2 text-sm">레벨: {masteryLevel(skill.mastery)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  획득 {skill.earned_points.toFixed(1)} / 가능 {skill.possible_points.toFixed(1)}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

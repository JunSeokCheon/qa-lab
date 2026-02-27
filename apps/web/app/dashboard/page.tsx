import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AdminExamDashboard } from "@/components/admin-exam-dashboard";
import { BackButton } from "@/components/back-button";
import { UserExamResultDashboard } from "@/components/user-exam-result-dashboard";
import {
  FASTAPI_BASE_URL,
  fetchMeWithToken,
  fetchMyExamResultsWithToken,
} from "@/lib/auth";

type ExamSummary = {
  id: number;
  title: string;
  exam_kind: string;
  target_track_name?: string | null;
  question_count: number;
  performance_high_min_correct?: number | null;
  performance_mid_min_correct?: number | null;
};

type QueryValue = string | string[] | undefined;

type DashboardPageProps = {
  searchParams?: Promise<Record<string, QueryValue>> | Record<string, QueryValue>;
};

function firstValue(value: QueryValue): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
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

  const examResults = await fetchMyExamResultsWithToken(token);

  return (
    <main className="qa-shell space-y-6">
      <section className="qa-card bg-hero text-hero-foreground">
        <BackButton tone="hero" />
        <p className="qa-kicker mt-4 text-hero-foreground/80">학습 진행</p>
        <h1 className="mt-2 text-3xl font-bold">성취도 대시보드</h1>
        <p className="mt-2 text-sm text-hero-foreground/90">{me.username} 님의 현재 성취도입니다.</p>
      </section>

      <UserExamResultDashboard results={examResults ?? []} />
    </main>
  );
}

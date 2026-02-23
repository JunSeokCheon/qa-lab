import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { BackButton } from "@/components/back-button";
import { FASTAPI_BASE_URL, fetchMeWithToken } from "@/lib/auth";

type ExamSubmissionItem = {
  id: number;
  exam_id: number;
  exam_title: string;
  exam_kind: string;
  folder_path: string | null;
  status: string;
  submitted_at: string;
};

function examKindLabel(kind: string): string {
  if (kind === "quiz") return "퀴즈";
  if (kind === "assessment") return "성취도 평가";
  return kind;
}

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
  if (me.role === "admin") {
    redirect("/admin/problems");
  }

  const response = await fetch(`${FASTAPI_BASE_URL}/me/exam-submissions?limit=50`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const submissions = (await response.json().catch(() => [])) as ExamSubmissionItem[];

  return (
    <main className="qa-shell space-y-6">
      <section className="qa-card bg-hero text-hero-foreground">
        <BackButton tone="hero" />
        <p className="qa-kicker text-hero-foreground/80">학습</p>
        <h1 className="mt-2 text-3xl font-bold">내 시험 제출 이력</h1>
      </section>

      <section className="qa-card">
        {submissions.length === 0 ? (
          <p className="text-sm text-muted-foreground">아직 제출한 시험이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border/70">
            <table className="min-w-full text-sm">
              <thead className="bg-surface-muted text-left">
                <tr>
                  <th className="px-3 py-2">시험</th>
                  <th className="px-3 py-2">유형</th>
                  <th className="px-3 py-2">카테고리</th>
                  <th className="px-3 py-2">상태</th>
                  <th className="px-3 py-2">제출 시각</th>
                  <th className="px-3 py-2">상세</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((item) => (
                  <tr key={item.id} className="border-t border-border/70">
                    <td className="px-3 py-2">{item.exam_title}</td>
                    <td className="px-3 py-2">{examKindLabel(item.exam_kind)}</td>
                    <td className="px-3 py-2">{item.folder_path ?? "미분류"}</td>
                    <td className="px-3 py-2">{item.status}</td>
                    <td className="px-3 py-2">{new Date(item.submitted_at).toLocaleString()}</td>
                    <td className="px-3 py-2">
                      <Link href={`/problems/${item.exam_id}`} className="font-semibold underline">
                        내 제출 보기
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Link href="/problems" className="mt-4 inline-block underline">
          시험 목록으로 이동
        </Link>
      </section>
    </main>
  );
}

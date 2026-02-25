import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { BackButton } from "@/components/back-button";
import { ExamCategoryBrowser } from "@/components/exam-category-browser";
import { FASTAPI_BASE_URL, fetchMeWithToken } from "@/lib/auth";

type ExamItem = {
  id: number;
  title: string;
  folder_path: string | null;
  exam_kind: string;
  question_count: number;
  submitted: boolean;
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

  const response = await fetch(`${FASTAPI_BASE_URL}/exams`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const exams = (await response.json().catch(() => [])) as ExamItem[];

  return (
    <main className="qa-shell space-y-6">
      <section className="qa-card bg-hero text-hero-foreground">
        <BackButton fallbackHref="/" tone="hero" useFallbackOnly />
        <p className="qa-kicker text-hero-foreground/80">내일배움캠프 데이터분석 트랙</p>
        <h1 className="mt-2 text-3xl font-bold md:text-4xl">시험 목록</h1>
        <p className="mt-2 text-sm text-hero-foreground/90">
          카테고리를 선택해 퀴즈/성취도 평가 시험지를 응시하세요.
        </p>
      </section>

      {exams.length === 0 ? (
        <section className="qa-card">
          <p className="text-sm text-muted-foreground">등록된 시험이 없습니다.</p>
        </section>
      ) : (
        <ExamCategoryBrowser items={exams} />
      )}
    </main>
  );
}

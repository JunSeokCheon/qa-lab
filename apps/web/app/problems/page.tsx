import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { BackButton } from "@/components/back-button";
import { ProblemCategoryBrowser } from "@/components/problem-category-browser";
import { FASTAPI_BASE_URL, fetchMeWithToken } from "@/lib/auth";

type ProblemItem = {
  id: number;
  title: string;
  folder_id: number | null;
  folder_path: string | null;
  latest_version: { id: number; version: number; type: string; difficulty: string; max_score: number } | null;
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
      <section className="qa-card bg-hero text-hero-foreground">
        <BackButton />
        <p className="qa-kicker text-hero-foreground/80">내일배움캠프 데이터분석 트랙</p>
        <h1 className="mt-2 text-3xl font-bold md:text-4xl">카테고리별 문제 목록</h1>
        <p className="mt-2 text-sm text-hero-foreground/90">
          카테고리 버튼을 선택하면 해당 문제만 볼 수 있습니다. ({me.username})
        </p>
      </section>

      {items.length === 0 ? (
        <section className="qa-card">
          <p className="text-sm text-muted-foreground">등록된 문제가 없습니다.</p>
        </section>
      ) : (
        <ProblemCategoryBrowser items={items} />
      )}
    </main>
  );
}

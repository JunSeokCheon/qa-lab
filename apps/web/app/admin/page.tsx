import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { BackButton } from "@/components/back-button";
import { FASTAPI_BASE_URL, fetchMeWithToken } from "@/lib/auth";

export default async function AdminPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;
  if (!token) redirect("/login");

  const me = await fetchMeWithToken(token);
  if (!me) redirect("/login");

  const adminResponse = await fetch(`${FASTAPI_BASE_URL}/admin/health`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (adminResponse.status === 401) redirect("/login");
  if (adminResponse.status === 403) {
    return (
      <main className="qa-shell">
        <section className="qa-card">
          <BackButton />
          <h1 className="mt-4 text-2xl font-semibold">관리자 페이지</h1>
          <p className="mt-4">현재 계정은 관리자 권한이 없습니다. (403)</p>
          <Link href="/" className="mt-4 inline-block underline">
            홈으로 이동
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="qa-shell space-y-4">
      <section className="qa-card bg-hero text-hero-foreground">
        <BackButton tone="hero" />
        <p className="qa-kicker mt-4 text-hero-foreground/80">관리자</p>
        <h1 className="mt-2 text-3xl font-bold">관리자 허브</h1>
        <p className="mt-2 text-sm text-hero-foreground/90">로그인 계정: {me.username}</p>
      </section>

      <section className="qa-card grid gap-2 text-sm md:grid-cols-4">
        <Link href="/admin/problems" className="rounded-xl border border-border/70 bg-surface p-4 underline">
          시험지 관리
        </Link>
        <Link href="/admin/exams" className="rounded-xl border border-border/70 bg-surface p-4 underline">
          시험 목록 관리
        </Link>
        <Link href="/admin/grading" className="rounded-xl border border-border/70 bg-surface p-4 underline">
          자동 채점 관리
        </Link>
        <Link href="/dashboard" className="rounded-xl border border-border/70 bg-surface p-4 underline">
          시험 대시보드
        </Link>
      </section>
    </main>
  );
}

import Link from "next/link";
import { cookies } from "next/headers";

import { Button } from "@/components/ui/button";
import { LogoutButton } from "@/components/logout-button";
import { ProblemOpen } from "@/components/problem-open";
import { fetchMeWithToken } from "@/lib/auth";

export default async function HomePage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;
  const me = token ? await fetchMeWithToken(token) : null;

  return (
    <div className="min-h-screen">
      <main className="qa-shell space-y-6">
        <section className="qa-card bg-hero text-hero-foreground">
          <p className="qa-kicker text-hero-foreground/80">QA Lab</p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight md:text-5xl">Skill Lab</h1>
          <p className="mt-3 max-w-2xl text-sm text-hero-foreground/90 md:text-base">
            코드를 제출하고, 자동 채점 결과와 성취도를 한 곳에서 확인하세요.
          </p>
        </section>

        {me ? (
          <>
            <section className="qa-card">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="qa-kicker">Signed In</p>
                  <p className="mt-1 text-lg font-semibold">{me.email}</p>
                  <p className="text-sm text-muted-foreground">role: {me.role}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href="/problems">
                    <Button variant="outline">문제 목록</Button>
                  </Link>
                  <Link href="/submissions">
                    <Button variant="outline">내 제출</Button>
                  </Link>
                  <Link href="/admin">
                    <Button variant="outline">Admin</Button>
                  </Link>
                  <Link href="/dashboard">
                    <Button variant="outline">Dashboard</Button>
                  </Link>
                  <LogoutButton />
                </div>
              </div>
            </section>
            <ProblemOpen />
          </>
        ) : (
          <section className="qa-card">
            <p className="text-sm text-muted-foreground">로그인되지 않았습니다.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href="/login">
                <Button>로그인</Button>
              </Link>
              <Link href="/signup">
                <Button variant="outline">회원가입</Button>
              </Link>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

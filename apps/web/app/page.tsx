import Link from "next/link";
import { cookies } from "next/headers";

import { Button } from "@/components/ui/button";
import { LogoutButton } from "@/components/logout-button";
import { fetchMeWithToken } from "@/lib/auth";

export default async function HomePage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;
  const me = token ? await fetchMeWithToken(token) : null;
  const roleLabel = me?.role === "admin" ? "관리자" : "학습자";

  return (
    <div className="min-h-screen">
      <main className="qa-shell space-y-6">
        <section className="qa-card bg-hero text-hero-foreground">
          <p className="qa-kicker text-hero-foreground/80">팀스파르타 내일배움캠프</p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight md:text-5xl">트랙 QA 스튜디오</h1>
        </section>

        {me ? (
          <>
            <section className="qa-card">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="qa-kicker">로그인 계정</p>
                  <p className="mt-1 text-lg font-semibold">{me.username}</p>
                  <p className="text-sm text-muted-foreground">이름: {me.name}</p>
                  <p className="text-sm text-muted-foreground">트랙: {me.track_name}</p>
                  <p className="text-sm text-muted-foreground">권한: {roleLabel}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href="/problems">
                    <Button variant="outline">시험 목록</Button>
                  </Link>
                  {me.role !== "admin" ? (
                    <Link href="/submissions">
                      <Button variant="outline">내 제출</Button>
                    </Link>
                  ) : null}
                  {me.role === "admin" ? (
                    <Link href="/admin">
                      <Button variant="outline">관리자</Button>
                    </Link>
                  ) : null}
                  <Link href="/dashboard">
                    <Button variant="outline">대시보드</Button>
                  </Link>
                  <LogoutButton />
                </div>
              </div>
            </section>
          </>
        ) : (
          <section className="qa-card">
            <p className="text-sm text-muted-foreground">로그인이 필요합니다.</p>
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

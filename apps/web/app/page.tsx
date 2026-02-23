import Link from "next/link";
import { cookies } from "next/headers";

import { LogoutButton } from "@/components/logout-button";
import { Button } from "@/components/ui/button";
import { fetchMeWithToken } from "@/lib/auth";

export default async function HomePage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;
  const me = token ? await fetchMeWithToken(token) : null;
  const roleLabel = me?.role === "admin" ? "관리자" : "학습자";
  const spotlightLinks = [
    {
      title: "내일배움캠프",
      description: "AI 시대를 돌파할 취업 솔루션과 교육 트랙을 확인해 보세요.",
      href: "https://nbcamp.spartacodingclub.kr",
    },
    {
      title: "팀스파르타 채용",
      description: "운영/교육팀 채용 및 튜터 모집 소식을 확인할 수 있습니다.",
      href: "https://career.spartaclub.kr/ko/home",
    },
    {
      title: "팀 블로그",
      description: "내배캠/교육 운영 관련 인사이트를 빠르게 확인할 수 있습니다.",
      href: "https://blog.career.spartaclub.kr/",
    },
  ];

  return (
    <div className="min-h-screen">
      <main className="qa-shell space-y-6">
        <section className="qa-card bg-hero text-hero-foreground">
          <p className="qa-kicker text-hero-foreground/80">팀스파르타 내배캠 QA LAB</p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight md:text-5xl">스파르타 QA 시스템</h1>
        </section>

        {me ? (
          <>
            <section className="qa-card">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="qa-kicker">로그인 계정</p>
                  <p className="mt-1 text-sm text-muted-foreground">아이디: {me.username}</p>
                  <p className="text-sm text-muted-foreground">이름: {me.name}</p>
                  {me.role === "admin" ? (
                    <p className="text-sm text-muted-foreground">권한: {roleLabel}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">트랙: {me.track_name ?? "-"}</p>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  {me.role === "admin" ? (
                    <>
                      <Link href="/admin/grading">
                        <Button variant="outline">자동채점 관리</Button>
                      </Link>
                      <Link href="/admin/problems">
                        <Button variant="outline">시험지 관리</Button>
                      </Link>
                      <Link href="/admin/exams">
                        <Button variant="outline">시험 목록</Button>
                      </Link>
                      <Link href="/admin/users">
                        <Button variant="outline">사용자 관리</Button>
                      </Link>
                      <Link href="/dashboard">
                        <Button variant="outline">대시보드</Button>
                      </Link>
                    </>
                  ) : (
                    <>
                      <Link href="/problems">
                        <Button variant="outline">시험 목록</Button>
                      </Link>
                      <Link href="/submissions">
                        <Button variant="outline">내 제출</Button>
                      </Link>
                      <Link href="/dashboard">
                        <Button variant="outline">대시보드</Button>
                      </Link>
                    </>
                  )}
                  <LogoutButton />
                </div>
              </div>
            </section>

            <section className="qa-card">
              <div>
                <p className="qa-kicker">팀스파르타 내배캠</p>
                <h2 className="mt-2 text-2xl font-bold">추천 바로가기</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  내배캠/팀스파르타 공식 채널로 빠르게 이동할 수 있습니다.
                </p>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {spotlightLinks.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-2xl border border-border/70 bg-surface p-4 transition-colors hover:bg-surface-muted"
                  >
                    <p className="text-sm font-semibold">{item.title}</p>
                    <p className="mt-2 text-xs text-muted-foreground">{item.description}</p>
                  </a>
                ))}
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

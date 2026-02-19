import Link from "next/link";
import { cookies } from "next/headers";

import { Button } from "@/components/ui/button";
import { ProblemOpen } from "@/components/problem-open";
import { PublicTestRunner } from "@/components/public-test-runner";
import { fetchMeWithToken } from "@/lib/auth";

export default async function HomePage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;
  const me = token ? await fetchMeWithToken(token) : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 dark:bg-black">
      <main className="flex w-full max-w-2xl flex-col gap-4 rounded-xl bg-white p-10 dark:bg-zinc-950">
        <h1 className="text-3xl font-semibold">Skill Lab</h1>

        {me ? (
          <>
            <p>로그인됨: {me.email}</p>
            <p>role: {me.role}</p>
            <div className="flex gap-3">
              <Link href="/admin" className="underline">
                Admin 페이지 이동
              </Link>
              <Link href="/dashboard" className="underline">
                Dashboard 이동
              </Link>
              <form action="/api/auth/logout" method="post">
                <Button type="submit">Logout</Button>
              </form>
            </div>
            <ProblemOpen />
            <PublicTestRunner />
          </>
        ) : (
          <>
            <p>로그인되지 않았습니다.</p>
            <Link href="/login" className="underline">
              로그인 페이지로 이동
            </Link>
          </>
        )}
      </main>
    </div>
  );
}

import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { FASTAPI_BASE_URL, fetchMeWithToken } from "@/lib/auth";

export default async function AdminPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;

  if (!token) {
    redirect("/login");
  }

  const me = await fetchMeWithToken(token);
  if (!me) {
    redirect("/login");
  }

  const adminResponse = await fetch(`${FASTAPI_BASE_URL}/admin/health`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  if (adminResponse.status === 401) {
    redirect("/login");
  }

  if (adminResponse.status === 403) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-2xl font-semibold">Admin 페이지</h1>
        <p className="mt-4">현재 계정은 admin 권한이 없어 접근할 수 없습니다. (403)</p>
        <Link href="/" className="mt-4 inline-block underline">
          홈으로 이동
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">Admin 페이지</h1>
      <p className="mt-4">로그인 계정: {me.email}</p>
      <p>역할: {me.role}</p>
      <p className="mt-2 text-green-700">Admin API 접근 성공</p>
      <p className="mt-6">
        제출 상세 예시:{" "}
        <Link href="/admin/submissions/1" className="underline">
          /admin/submissions/1
        </Link>
      </p>
    </main>
  );
}

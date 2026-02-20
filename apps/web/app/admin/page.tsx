import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { BackButton } from "@/components/back-button";
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
      <main className="qa-shell">
        <section className="qa-card">
          <BackButton />
          <h1 className="text-2xl font-semibold">Admin</h1>
          <p className="mt-4">Current account does not have admin permissions. (403)</p>
          <Link href="/" className="mt-4 inline-block underline">
            Go home
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="qa-shell">
      <section className="qa-card space-y-3">
        <BackButton />
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p>Signed in as: {me.username}</p>
        <p>Role: {me.role}</p>
        <p className="text-green-700">Admin API access confirmed</p>

        <div className="flex flex-wrap gap-3 pt-2 text-sm">
          <Link href="/admin/problems" className="underline">
            Problem/Bundle Manager
          </Link>
          <Link href="/admin/submissions/1" className="underline">
            Submission detail sample (/admin/submissions/1)
          </Link>
        </div>
      </section>
    </main>
  );
}

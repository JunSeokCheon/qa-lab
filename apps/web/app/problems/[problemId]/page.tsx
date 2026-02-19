import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ProblemWorkbench } from "@/components/problem-workbench";
import { FASTAPI_BASE_URL, fetchMeWithToken } from "@/lib/auth";

type ProblemDetail = {
  id: number;
  title: string;
  latest_version: {
    id: number;
    version: number;
  } | null;
};

type Params = {
  params: Promise<{ problemId: string }>;
};

export default async function ProblemPage({ params }: Params) {
  const { problemId } = await params;
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;
  if (!token) {
    redirect("/login");
  }

  const me = await fetchMeWithToken(token);
  if (!me) {
    redirect("/login");
  }

  const response = await fetch(`${FASTAPI_BASE_URL}/problems/${problemId}`, { cache: "no-store" });
  if (!response.ok) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold">문제</h1>
        <p className="mt-3">문제를 불러오지 못했습니다.</p>
        <Link href="/" className="underline">
          홈으로 이동
        </Link>
      </main>
    );
  }

  const problem = (await response.json()) as ProblemDetail;
  if (!problem.latest_version) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold">{problem.title}</h1>
        <p className="mt-3">아직 버전이 없습니다.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">{problem.title}</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
        Problem #{problem.id}, Version {problem.latest_version.version}
      </p>
      <ProblemWorkbench problemId={problem.id} problemVersionId={problem.latest_version.id} />
    </main>
  );
}

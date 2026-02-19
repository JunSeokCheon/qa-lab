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
    statement_md: string;
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
      <main className="qa-shell">
        <section className="qa-card">
          <h1 className="text-2xl font-semibold">Problem</h1>
          <p className="mt-3">Unable to load the requested problem.</p>
          <Link href="/" className="underline">
            Go back home
          </Link>
        </section>
      </main>
    );
  }

  const problem = (await response.json()) as ProblemDetail;
  if (!problem.latest_version) {
    return (
      <main className="qa-shell">
        <section className="qa-card">
          <h1 className="text-2xl font-semibold">{problem.title}</h1>
          <p className="mt-3">This problem does not have a published version yet.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="qa-shell space-y-6">
      <section className="qa-card">
        <p className="qa-kicker">Problem Workspace</p>
        <h1 className="mt-2 text-3xl font-bold">{problem.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Problem #{problem.id}, Version {problem.latest_version.version}
        </p>
      </section>

      <section className="qa-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Statement</h2>
          <p className="text-xs text-muted-foreground">Tip: run public tests before submitting.</p>
        </div>
        <pre className="mt-3 whitespace-pre-wrap rounded-xl bg-surface-muted p-4 text-sm leading-6 text-foreground">
          {problem.latest_version.statement_md}
        </pre>
      </section>

      <ProblemWorkbench problemId={problem.id} problemVersionId={problem.latest_version.id} />
    </main>
  );
}

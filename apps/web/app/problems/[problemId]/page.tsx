import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { BackButton } from "@/components/back-button";
import { ProblemWorkbench } from "@/components/problem-workbench";
import { FASTAPI_BASE_URL, fetchMeWithToken } from "@/lib/auth";

type ProblemType = "coding" | "multiple_choice" | "subjective";

type ProblemDetail = {
  id: number;
  title: string;
  folder_path: string | null;
  latest_version: {
    id: number;
    version: number;
    type: ProblemType;
    difficulty: string;
    max_score: number;
    statement_md: string;
    question_meta: { choices?: string[] } | null;
  } | null;
};

type Params = {
  params: Promise<{ problemId: string }>;
};

function typeLabel(type: ProblemType): string {
  if (type === "coding") return "코드";
  if (type === "multiple_choice") return "객관식";
  return "주관식";
}

function difficultyLabel(difficulty: string): string {
  if (difficulty === "easy") return "쉬움";
  if (difficulty === "medium") return "보통";
  if (difficulty === "hard") return "어려움";
  return difficulty;
}

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
          <BackButton />
          <h1 className="text-2xl font-semibold">문제</h1>
          <p className="mt-3">요청한 문제를 불러오지 못했습니다.</p>
          <Link href="/" className="underline">
            홈으로 이동
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
          <BackButton />
          <h1 className="text-2xl font-semibold">{problem.title}</h1>
          <p className="mt-3">아직 공개된 버전이 없습니다.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="qa-shell space-y-6">
      <section className="qa-card">
        <BackButton />
        <p className="qa-kicker">문제 워크스페이스</p>
        <h1 className="mt-2 text-3xl font-bold">{problem.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {problem.folder_path ?? "미분류"} | 문제 #{problem.id} | 버전 {problem.latest_version.version}
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-primary/10 px-2 py-1 font-semibold text-primary">
            {typeLabel(problem.latest_version.type)}
          </span>
          <span className="rounded-full bg-surface-muted px-2 py-1">
            {difficultyLabel(problem.latest_version.difficulty)}
          </span>
          <span className="rounded-full bg-surface-muted px-2 py-1">{problem.latest_version.max_score}점</span>
          <span className="rounded-full bg-surface-muted px-2 py-1">학습자: {me.username}</span>
        </div>
      </section>

      <section className="qa-card">
        <h2 className="text-lg font-semibold">문제 설명</h2>
        <pre className="mt-3 whitespace-pre-wrap rounded-xl bg-surface-muted p-4 text-sm leading-6 text-foreground">
          {problem.latest_version.statement_md}
        </pre>
      </section>

      <ProblemWorkbench
        problemId={problem.id}
        problemVersionId={problem.latest_version.id}
        problemType={problem.latest_version.type}
        questionMeta={problem.latest_version.question_meta}
      />
    </main>
  );
}

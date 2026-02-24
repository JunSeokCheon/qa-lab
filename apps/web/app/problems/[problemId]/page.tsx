import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { BackButton } from "@/components/back-button";
import { ExamTaker, type MyExamSubmissionDetail } from "@/components/exam-taker";
import { MarkdownContent } from "@/components/markdown-content";
import { FASTAPI_BASE_URL, fetchMeWithToken } from "@/lib/auth";

type ExamQuestion = {
  id: number;
  order_index: number;
  type: string;
  prompt_md: string;
  required: boolean;
  choices: string[] | null;
  image_resource_id: number | null;
  image_resource_ids?: number[];
};

type ExamDetail = {
  id: number;
  title: string;
  description: string | null;
  folder_path: string | null;
  exam_kind: string;
  duration_minutes: number | null;
  question_count: number;
  submitted: boolean;
  remaining_seconds: number | null;
  questions: ExamQuestion[];
};

type ExamResource = {
  id: number;
  file_name: string;
  content_type: string | null;
  size_bytes: number;
  created_at: string;
};

type Params = {
  params: Promise<{ problemId: string }>;
};

function examKindLabel(kind: string): string {
  if (kind === "quiz") return "퀴즈";
  if (kind === "assessment") return "성취도 평가";
  return kind;
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

  const response = await fetch(`${FASTAPI_BASE_URL}/exams/${problemId}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) {
    return (
      <main className="qa-shell">
        <section className="qa-card">
          <BackButton />
          <h1 className="mt-3 text-2xl font-semibold">시험</h1>
          <p className="mt-3">요청한 시험을 불러오지 못했습니다.</p>
          <Link href="/problems" className="underline">
            시험 목록으로 이동
          </Link>
        </section>
      </main>
    );
  }

  const exam = (await response.json()) as ExamDetail;

  let mySubmission: MyExamSubmissionDetail | null = null;
  if (exam.submitted) {
    const submissionResponse = await fetch(`${FASTAPI_BASE_URL}/exams/${problemId}/my-submission`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (submissionResponse.ok) {
      mySubmission = (await submissionResponse.json()) as MyExamSubmissionDetail;
    }
  }

  const resourcesResponse = await fetch(`${FASTAPI_BASE_URL}/exams/${problemId}/resources`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const resources = resourcesResponse.ok
    ? ((await resourcesResponse.json().catch(() => [])) as ExamResource[])
    : [];

  return (
    <main className="qa-shell space-y-6">
      <section className="qa-card">
        <BackButton />
        <p className="qa-kicker mt-3">시험 응시</p>
        <h1 className="mt-2 text-3xl font-bold">{exam.title}</h1>
        {exam.description ? (
          <MarkdownContent className="mt-2" content={exam.description} />
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-primary/10 px-2 py-1 font-semibold text-primary">
            {examKindLabel(exam.exam_kind)}
          </span>
          <span className="rounded-full bg-surface-muted px-2 py-1">{exam.folder_path ?? "미분류"}</span>
          <span className="rounded-full bg-surface-muted px-2 py-1">{exam.question_count}문항</span>
          <span className="rounded-full bg-surface-muted px-2 py-1">응시자: {me.username}</span>
          {exam.duration_minutes !== null ? (
            <span className="rounded-full bg-surface-muted px-2 py-1">시험 시간: {exam.duration_minutes}분</span>
          ) : null}
        </div>
      </section>

      <section className="qa-card space-y-3">
        <h2 className="text-lg font-semibold">시험 자료</h2>
        {resources.length === 0 ? (
          <p className="text-sm text-muted-foreground">등록된 자료가 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {resources.map((resource) => (
              <article key={resource.id} className="rounded-xl border border-border/70 bg-surface p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{resource.file_name}</p>
                  <a
                    className="text-primary underline"
                    href={`/api/exams/${exam.id}/resources/${resource.id}/download`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    다운로드
                  </a>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{resource.content_type ?? "application/octet-stream"}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      <ExamTaker
        examId={exam.id}
        questions={exam.questions}
        submitted={exam.submitted}
        durationMinutes={exam.duration_minutes}
        initialRemainingSeconds={exam.remaining_seconds}
        initialSubmission={mySubmission}
      />
    </main>
  );
}

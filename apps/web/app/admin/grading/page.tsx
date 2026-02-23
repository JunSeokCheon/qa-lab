import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AdminAutoGradingManager } from "@/components/admin-auto-grading-manager";
import { FASTAPI_BASE_URL, fetchMeWithToken } from "@/lib/auth";

type ExamSummary = {
  id: number;
  title: string;
  exam_kind: string;
  target_track_name?: string | null;
};

type GradingSubmission = {
  submission_id: number;
  exam_id: number;
  exam_title: string;
  exam_kind: string;
  user_id: number;
  user_name: string;
  username: string;
  status: string;
  submitted_at: string;
  coding_question_count: number;
  coding_graded_count: number;
  coding_failed_count: number;
  coding_pending_count: number;
  review_pending_count: number;
  has_review_pending: boolean;
  results_published: boolean;
  results_published_at: string | null;
  results_publish_scope: "none" | "exam" | "submission";
};

export default async function AdminGradingPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;
  if (!token) redirect("/login");

  const me = await fetchMeWithToken(token);
  if (!me || me.role !== "admin") {
    redirect("/admin");
  }

  const [examsResponse, submissionsResponse] = await Promise.all([
    fetch(`${FASTAPI_BASE_URL}/admin/exams`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    }),
    fetch(`${FASTAPI_BASE_URL}/admin/grading/exam-submissions?coding_only=false&limit=200`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    }),
  ]);

  const initialExams = (await examsResponse.json().catch(() => [])) as ExamSummary[];
  const initialSubmissions = (await submissionsResponse.json().catch(() => [])) as GradingSubmission[];

  return <AdminAutoGradingManager initialExams={initialExams} initialSubmissions={initialSubmissions} />;
}

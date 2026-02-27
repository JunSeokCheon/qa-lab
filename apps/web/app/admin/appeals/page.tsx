import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AdminAppealManager } from "@/components/admin-appeal-manager";
import { FASTAPI_BASE_URL, fetchMeWithToken } from "@/lib/auth";

type ExamSummary = {
  id: number;
  title: string;
  exam_kind: string;
  target_track_name?: string | null;
};

type AppealRow = {
  submission_id: number;
  exam_id: number;
  exam_title: string;
  user_id: number;
  user_name: string;
  username: string;
  question_id: number;
  question_order: number;
  question_type: string;
  prompt_preview: string;
  grading_status: string | null;
  grading_score: number | null;
  grading_max_score: number | null;
  verdict: "correct" | "incorrect" | "pending" | "review_pending";
  appeal_pending: boolean;
  appeal_count: number;
  latest_appeal_reason: string | null;
  latest_appeal_requested_at: string | null;
  latest_appeal_requested_by_user_id: number | null;
  results_published: boolean;
  results_published_at: string | null;
};

export default async function AdminAppealsPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;
  if (!token) redirect("/login");

  const me = await fetchMeWithToken(token);
  if (!me || me.role !== "admin") {
    redirect("/admin");
  }

  const [examsResponse, appealsResponse] = await Promise.all([
    fetch(`${FASTAPI_BASE_URL}/admin/exams`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    }),
    fetch(`${FASTAPI_BASE_URL}/admin/appeals?status=pending&limit=200`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    }),
  ]);

  const initialExams = (await examsResponse.json().catch(() => [])) as ExamSummary[];
  const initialRows = (await appealsResponse.json().catch(() => [])) as AppealRow[];

  return <AdminAppealManager initialExams={initialExams} initialRows={initialRows} />;
}


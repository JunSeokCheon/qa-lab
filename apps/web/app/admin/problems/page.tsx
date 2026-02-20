import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AdminExamBuilder } from "@/components/admin-exam-builder";
import { FASTAPI_BASE_URL, fetchMeWithToken } from "@/lib/auth";

type Folder = { id: number; path: string };
type ExamSummary = {
  id: number;
  title: string;
  exam_kind: string;
  question_count: number;
  folder_path: string | null;
  status: string;
};

export default async function AdminProblemsPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;

  if (!token) {
    redirect("/login");
  }

  const me = await fetchMeWithToken(token);
  if (!me || me.role !== "admin") {
    redirect("/admin");
  }

  const folderResponse = await fetch(`${FASTAPI_BASE_URL}/admin/problem-folders`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const initialFolders = (await folderResponse.json().catch(() => [])) as Folder[];

  const examsResponse = await fetch(`${FASTAPI_BASE_URL}/admin/exams`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const initialExams = (await examsResponse.json().catch(() => [])) as ExamSummary[];

  return <AdminExamBuilder initialFolders={initialFolders} initialExams={initialExams} />;
}

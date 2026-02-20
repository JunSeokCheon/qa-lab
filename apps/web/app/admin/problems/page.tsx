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

const DEFAULT_FOLDERS = [
  { name: "파이썬", slug: "python", sort_order: 10 },
  { name: "전처리/시각화", slug: "preprocessing-visualization", sort_order: 20 },
  { name: "통계", slug: "statistics", sort_order: 30 },
  { name: "머신러닝", slug: "machine-learning", sort_order: 40 },
  { name: "종합", slug: "comprehensive", sort_order: 50 },
] as const;

async function fetchFolders(token: string): Promise<Folder[]> {
  const response = await fetch(`${FASTAPI_BASE_URL}/admin/problem-folders`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) {
    return [];
  }
  return (await response.json().catch(() => [])) as Folder[];
}

async function ensureDefaultFolders(token: string): Promise<Folder[]> {
  let folders = await fetchFolders(token);
  if (folders.length > 0) {
    return folders;
  }

  for (const folder of DEFAULT_FOLDERS) {
    await fetch(`${FASTAPI_BASE_URL}/admin/problem-folders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(folder),
      cache: "no-store",
    });
  }

  folders = await fetchFolders(token);
  return folders;
}

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

  const initialFolders = await ensureDefaultFolders(token);

  const examsResponse = await fetch(`${FASTAPI_BASE_URL}/admin/exams`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const initialExams = (await examsResponse.json().catch(() => [])) as ExamSummary[];

  return <AdminExamBuilder initialFolders={initialFolders} initialExams={initialExams} />;
}

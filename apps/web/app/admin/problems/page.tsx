import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AdminProblemsManager } from "@/components/admin-problems-manager";
import { FASTAPI_BASE_URL, fetchMeWithToken } from "@/lib/auth";

type Skill = { id: number; name: string; description?: string | null };
type Folder = { id: number; name: string; slug: string; parent_id: number | null; sort_order: number; path: string };

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

  const response = await fetch(`${FASTAPI_BASE_URL}/admin/skills`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  const initialSkills = (await response.json().catch(() => [])) as Skill[];
  const foldersResponse = await fetch(`${FASTAPI_BASE_URL}/admin/problem-folders`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const initialFolders = (await foldersResponse.json().catch(() => [])) as Folder[];

  return <AdminProblemsManager initialSkills={initialSkills} initialFolders={initialFolders} />;
}

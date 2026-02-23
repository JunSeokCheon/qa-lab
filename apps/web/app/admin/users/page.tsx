import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AdminUserManager } from "@/components/admin-user-manager";
import { FASTAPI_BASE_URL, fetchMeWithToken } from "@/lib/auth";

type AdminUser = {
  id: number;
  username: string;
  name: string;
  track_name: string;
  role: string;
  created_at: string;
};

async function fetchUsers(token: string): Promise<AdminUser[]> {
  const response = await fetch(`${FASTAPI_BASE_URL}/admin/users?limit=500`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) return [];
  return (await response.json().catch(() => [])) as AdminUser[];
}

async function fetchTracks(token: string): Promise<string[]> {
  const response = await fetch(`${FASTAPI_BASE_URL}/admin/users/tracks`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) return [];
  return (await response.json().catch(() => [])) as string[];
}

export default async function AdminUsersPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;
  if (!token) redirect("/login");

  const me = await fetchMeWithToken(token);
  if (!me || me.role !== "admin") {
    redirect("/admin");
  }

  const [initialUsers, initialTracks] = await Promise.all([fetchUsers(token), fetchTracks(token)]);
  return <AdminUserManager initialUsers={initialUsers} initialTracks={initialTracks} />;
}


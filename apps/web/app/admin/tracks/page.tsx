import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AdminTrackManager } from "@/components/admin-track-manager";
import { FASTAPI_BASE_URL, fetchMeWithToken } from "@/lib/auth";

async function fetchTracks(token: string): Promise<string[]> {
  const response = await fetch(`${FASTAPI_BASE_URL}/admin/tracks`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) return [];
  return (await response.json().catch(() => [])) as string[];
}

export default async function AdminTracksPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;
  if (!token) redirect("/login");

  const me = await fetchMeWithToken(token);
  if (!me || me.role !== "admin") {
    redirect("/admin");
  }

  const initialTracks = await fetchTracks(token);
  return <AdminTrackManager initialTracks={initialTracks} />;
}

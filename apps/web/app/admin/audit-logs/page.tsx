import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { BackButton } from "@/components/back-button";
import { FASTAPI_BASE_URL, fetchMeWithToken } from "@/lib/auth";

type AdminAuditLog = {
  id: number;
  actor_user_id: number | null;
  actor_username: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  method: string;
  path: string;
  request_id: string | null;
  client_ip: string | null;
  user_agent: string | null;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
};

async function fetchAdminAuditLogs(token: string): Promise<AdminAuditLog[]> {
  const response = await fetch(`${FASTAPI_BASE_URL}/admin/audit-logs?limit=200`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) return [];
  return (await response.json().catch(() => [])) as AdminAuditLog[];
}

export default async function AdminAuditLogsPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;
  if (!token) redirect("/login");

  const me = await fetchMeWithToken(token);
  if (!me || me.role !== "admin") redirect("/admin");

  const logs = await fetchAdminAuditLogs(token);

  return (
    <main className="qa-shell space-y-6">
      <section className="qa-card bg-hero text-hero-foreground">
        <BackButton fallbackHref="/admin" tone="hero" />
        <p className="qa-kicker mt-4 text-hero-foreground/80">관리자</p>
        <h1 className="mt-2 text-3xl font-bold">감사 로그</h1>
        <p className="mt-2 text-sm text-hero-foreground/90">
          관리자 행동(시험 수정, 채점 변경, 사용자 삭제 등)은 DB의 append-only 감사 로그로 저장됩니다.
        </p>
      </section>

      <section className="qa-card overflow-auto">
        <table className="w-full min-w-[1200px] text-sm">
          <thead>
            <tr className="border-b border-border/70 text-left text-muted-foreground">
              <th className="px-2 py-2">ID</th>
              <th className="px-2 py-2">시각</th>
              <th className="px-2 py-2">관리자</th>
              <th className="px-2 py-2">행동</th>
              <th className="px-2 py-2">대상</th>
              <th className="px-2 py-2">요청</th>
              <th className="px-2 py-2">IP</th>
              <th className="px-2 py-2">메타데이터</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr>
                <td className="px-2 py-4 text-muted-foreground" colSpan={8}>
                  감사 로그가 없습니다.
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id} className="border-b border-border/50 align-top">
                  <td className="px-2 py-2">{log.id}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{new Date(log.created_at).toLocaleString()}</td>
                  <td className="px-2 py-2">
                    {log.actor_username ?? "-"}
                    {log.actor_user_id ? <span className="text-xs text-muted-foreground"> (#{log.actor_user_id})</span> : null}
                  </td>
                  <td className="px-2 py-2 font-medium">{log.action}</td>
                  <td className="px-2 py-2">
                    {log.resource_type}
                    {log.resource_id ? <span className="text-xs text-muted-foreground"> / {log.resource_id}</span> : null}
                  </td>
                  <td className="px-2 py-2">
                    <div>{log.method}</div>
                    <div className="max-w-[260px] truncate text-xs text-muted-foreground">{log.path}</div>
                  </td>
                  <td className="px-2 py-2">{log.client_ip ?? "-"}</td>
                  <td className="px-2 py-2">
                    {log.metadata_json ? (
                      <pre className="max-h-32 max-w-[420px] overflow-auto whitespace-pre-wrap rounded-md bg-background/60 p-2 text-xs">
                        {JSON.stringify(log.metadata_json, null, 2)}
                      </pre>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}

"use client";

import { useCallback, useMemo, useState } from "react";

import { BackButton } from "@/components/back-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type AdminUser = {
  id: number;
  username: string;
  name: string;
  track_name: string;
  role: string;
  created_at: string;
};

type Props = {
  initialUsers: AdminUser[];
  initialTracks: string[];
};

function roleLabel(role: string): string {
  if (role === "admin") return "관리자";
  if (role === "user") return "수강생";
  return role;
}

export function AdminUserManager({ initialUsers, initialTracks }: Props) {
  const [users, setUsers] = useState<AdminUser[]>(initialUsers);
  const [tracks] = useState<string[]>(initialTracks);
  const [selectedTrack, setSelectedTrack] = useState<string>("all");
  const [role, setRole] = useState<"all" | "admin" | "user">("all");
  const [keyword, setKeyword] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (selectedTrack !== "all") params.set("track_name", selectedTrack);
      if (role !== "all") params.set("role", role);
      if (keyword.trim()) params.set("keyword", keyword.trim());
      params.set("limit", "500");

      const response = await fetch(`/api/admin/users?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => [])) as AdminUser[] | { detail?: string; message?: string };
      if (!response.ok) {
        const messagePayload = payload as { detail?: string; message?: string };
        setError(messagePayload.detail ?? messagePayload.message ?? "사용자 목록을 불러오지 못했습니다.");
        return;
      }
      setUsers(payload as AdminUser[]);
    } catch {
      setError("사용자 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [keyword, role, selectedTrack]);

  const summary = useMemo(() => {
    const adminCount = users.filter((user) => user.role === "admin").length;
    const studentCount = users.filter((user) => user.role === "user").length;
    return { total: users.length, adminCount, studentCount };
  }, [users]);

  return (
    <main className="qa-shell space-y-6">
      <section className="qa-card bg-hero text-hero-foreground">
        <BackButton fallbackHref="/admin" tone="hero" />
        <p className="qa-kicker mt-4 text-hero-foreground/80">관리자</p>
        <h1 className="mt-2 text-3xl font-bold">사용자 관리</h1>
        <p className="mt-2 text-sm text-hero-foreground/90">
          비밀번호를 제외한 사용자 정보만 조회됩니다. 트랙/권한/검색 필터를 사용할 수 있습니다.
        </p>
      </section>

      <section className="qa-card space-y-3">
        <div className="grid gap-3 md:grid-cols-4">
          <select
            className="h-11 w-full rounded-xl border border-border/70 bg-background/80 px-3 text-sm"
            value={selectedTrack}
            onChange={(event) => setSelectedTrack(event.target.value)}
          >
            <option value="all">전체 트랙</option>
            {tracks.map((track) => (
              <option key={track} value={track}>
                {track}
              </option>
            ))}
          </select>

          <select
            className="h-11 w-full rounded-xl border border-border/70 bg-background/80 px-3 text-sm"
            value={role}
            onChange={(event) => setRole(event.target.value as "all" | "admin" | "user")}
          >
            <option value="all">전체 권한</option>
            <option value="admin">관리자</option>
            <option value="user">수강생</option>
          </select>

          <Input
            placeholder="아이디/이름/트랙 검색"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void loadUsers();
              }
            }}
          />

          <Button type="button" onClick={() => void loadUsers()} disabled={loading}>
            {loading ? "조회 중..." : "조회"}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          총 {summary.total}명 | 관리자 {summary.adminCount}명 | 수강생 {summary.studentCount}명
        </p>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </section>

      <section className="qa-card overflow-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-border/70 text-left text-muted-foreground">
              <th className="px-2 py-2">ID</th>
              <th className="px-2 py-2">아이디</th>
              <th className="px-2 py-2">이름</th>
              <th className="px-2 py-2">트랙</th>
              <th className="px-2 py-2">권한</th>
              <th className="px-2 py-2">가입일</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td className="px-2 py-4 text-muted-foreground" colSpan={6}>
                  조건에 맞는 사용자가 없습니다.
                </td>
              </tr>
            ) : (
              users.map((user) => (
                <tr key={user.id} className="border-b border-border/50 align-top">
                  <td className="px-2 py-2">{user.id}</td>
                  <td className="px-2 py-2">{user.username}</td>
                  <td className="px-2 py-2">{user.name}</td>
                  <td className="px-2 py-2">{user.track_name}</td>
                  <td className="px-2 py-2">{roleLabel(user.role)}</td>
                  <td className="px-2 py-2">{new Date(user.created_at).toLocaleString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}


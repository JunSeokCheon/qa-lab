"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { BackButton } from "@/components/back-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateTimeKST } from "@/lib/datetime";

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
  currentAdminId: number;
};

function roleLabel(role: string): string {
  if (role === "admin") return "관리자";
  if (role === "user") return "수강생";
  return role;
}

export function AdminUserManager({ initialUsers, initialTracks, currentAdminId }: Props) {
  const [users, setUsers] = useState<AdminUser[]>(initialUsers);
  const [tracks] = useState<string[]>(initialTracks);
  const [selectedTrack, setSelectedTrack] = useState<string>("all");
  const [role, setRole] = useState<"all" | "admin" | "user">("all");
  const [keyword, setKeyword] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<number | null>(null);
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<AdminUser | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!deleteConfirmTarget || deletingUserId !== null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDeleteConfirmTarget(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteConfirmTarget, deletingUserId]);

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

  const handleDeleteUser = useCallback(
    (target: AdminUser) => {
      if (target.role === "admin") {
        setError("관리자 계정은 삭제할 수 없습니다.");
        return;
      }

      if (target.id === currentAdminId) {
        setError("현재 로그인한 관리자 계정은 삭제할 수 없습니다.");
        return;
      }

      setDeleteConfirmTarget(target);
    },
    [currentAdminId]
  );

  const confirmDeleteUser = useCallback(async () => {
    if (!deleteConfirmTarget) return;

    setDeletingUserId(deleteConfirmTarget.id);
    setError("");
    try {
      const response = await fetch(`/api/admin/users/${deleteConfirmTarget.id}`, {
        method: "DELETE",
        cache: "no-store",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { detail?: string; message?: string };
        setError(payload.detail ?? payload.message ?? "사용자 삭제에 실패했습니다.");
        return;
      }
      await loadUsers();
      setDeleteConfirmTarget(null);
    } catch {
      setError("사용자 삭제에 실패했습니다.");
    } finally {
      setDeletingUserId(null);
    }
  }, [deleteConfirmTarget, loadUsers]);

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
          비밀번호를 제외한 사용자 정보를 조회하고, 필요 시 수강생 계정을 삭제할 수 있습니다.
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
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-border/70 text-left text-muted-foreground">
              <th className="px-2 py-2">번호</th>
              <th className="px-2 py-2">아이디</th>
              <th className="px-2 py-2">이름</th>
              <th className="px-2 py-2">트랙</th>
              <th className="px-2 py-2">권한</th>
              <th className="px-2 py-2">가입일</th>
              <th className="px-2 py-2">작업</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td className="px-2 py-4 text-muted-foreground" colSpan={7}>
                  조건에 맞는 사용자가 없습니다.
                </td>
              </tr>
            ) : (
              users.map((user) => {
                const isSelf = user.id === currentAdminId;
                const isAdmin = user.role === "admin";
                const deleting = deletingUserId === user.id;
                return (
                  <tr key={user.id} className="border-b border-border/50 align-top">
                    <td className="px-2 py-2">{user.id}</td>
                    <td className="px-2 py-2">{user.username}</td>
                    <td className="px-2 py-2">{user.name}</td>
                    <td className="px-2 py-2">{user.track_name}</td>
                    <td className="px-2 py-2">{roleLabel(user.role)}</td>
                    <td className="px-2 py-2">{formatDateTimeKST(user.created_at)}</td>
                    <td className="px-2 py-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isSelf || isAdmin || deleting}
                        onClick={() => handleDeleteUser(user)}
                      >
                        {isSelf ? "현재 계정" : isAdmin ? "관리자 계정" : deleting ? "삭제 중..." : "삭제"}
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>

      {deleteConfirmTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]">
          <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-primary/40 bg-white shadow-2xl">
            <div className="bg-gradient-to-r from-primary to-[#d80028] px-5 py-4 text-white">
              <p className="text-xs font-semibold uppercase tracking-[0.14em]">주의</p>
              <h3 className="mt-1 text-lg font-bold">사용자 삭제 확인</h3>
            </div>
            <div className="space-y-3 p-5 text-sm text-foreground">
              <p className="rounded-xl border border-primary/20 bg-secondary/50 p-3">
                <span className="font-semibold">{deleteConfirmTarget.username}</span>
              </p>
              <p>이 사용자 계정을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.</p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border/70 bg-muted/30 px-5 py-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeleteConfirmTarget(null)}
                disabled={deletingUserId !== null}
              >
                취소
              </Button>
              <Button type="button" variant="destructive" onClick={() => void confirmDeleteUser()} disabled={deletingUserId !== null}>
                {deletingUserId !== null ? "삭제 중..." : "영구 삭제"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

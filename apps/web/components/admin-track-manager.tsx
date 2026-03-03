"use client";

import { useMemo, useState } from "react";

import { BackButton } from "@/components/back-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Props = {
  initialTracks: string[];
};

function normalizeTrackNames(rawTracks: string[]): string[] {
  return Array.from(
    new Set(rawTracks.map((track) => String(track).trim()).filter((track) => track.length > 0))
  ).sort((a, b) => a.localeCompare(b, "ko"));
}

export function AdminTrackManager({ initialTracks }: Props) {
  const [tracks, setTracks] = useState<string[]>(normalizeTrackNames(initialTracks));
  const [newTrackName, setNewTrackName] = useState("");
  const [loadingCreate, setLoadingCreate] = useState(false);
  const [loadingDelete, setLoadingDelete] = useState(false);
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const summary = useMemo(() => ({ total: tracks.length }), [tracks.length]);

  const createTrack = async () => {
    const normalized = newTrackName.trim();
    if (!normalized) {
      setError("트랙명을 입력해 주세요.");
      setMessage("");
      return;
    }

    setLoadingCreate(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/tracks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: normalized }),
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as
        | { name?: string }
        | { detail?: string; message?: string };
      if (!response.ok) {
        const err = payload as { detail?: string; message?: string };
        setError(err.detail ?? err.message ?? "트랙 생성에 실패했습니다.");
        return;
      }

      const createdName = String((payload as { name?: string }).name ?? normalized).trim();
      setTracks((prev) => normalizeTrackNames([...prev, createdName]));
      setNewTrackName("");
      setMessage(`트랙 생성 완료: ${createdName}`);
    } catch {
      setError("트랙 생성에 실패했습니다.");
    } finally {
      setLoadingCreate(false);
    }
  };

  const deleteTrack = async () => {
    if (!deleteConfirmTarget) return;
    setLoadingDelete(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/admin/tracks/${encodeURIComponent(deleteConfirmTarget)}`, {
        method: "DELETE",
        cache: "no-store",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { detail?: string; message?: string };
        setError(payload.detail ?? payload.message ?? "트랙 삭제에 실패했습니다.");
        return;
      }
      setTracks((prev) => prev.filter((track) => track !== deleteConfirmTarget));
      setMessage(`트랙 삭제 완료: ${deleteConfirmTarget}`);
      setDeleteConfirmTarget(null);
    } catch {
      setError("트랙 삭제에 실패했습니다.");
    } finally {
      setLoadingDelete(false);
    }
  };

  return (
    <main className="qa-shell space-y-6">
      <section className="qa-card bg-hero text-hero-foreground">
        <BackButton fallbackHref="/admin" tone="hero" />
        <p className="qa-kicker mt-4 text-hero-foreground/80">관리자</p>
        <h1 className="mt-2 text-3xl font-bold">트랙 관리</h1>
        <p className="mt-2 text-sm text-hero-foreground/90">
          트랙을 생성/삭제할 수 있습니다. 트랙 삭제 시 사용자 정보는 삭제되지 않습니다.
        </p>
      </section>

      <section className="qa-card space-y-3">
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
          <Input
            placeholder="새 트랙명 입력"
            value={newTrackName}
            onChange={(event) => setNewTrackName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              void createTrack();
            }}
          />
          <Button type="button" onClick={() => void createTrack()} disabled={loadingCreate}>
            {loadingCreate ? "생성 중..." : "트랙 생성"}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">현재 트랙 수: {summary.total}</p>
        {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </section>

      <section className="qa-card overflow-auto">
        <table className="w-full min-w-[700px] text-sm">
          <thead>
            <tr className="border-b border-border/70 text-left text-muted-foreground">
              <th className="px-2 py-2">트랙명</th>
              <th className="px-2 py-2">작업</th>
            </tr>
          </thead>
          <tbody>
            {tracks.length === 0 ? (
              <tr>
                <td className="px-2 py-4 text-muted-foreground" colSpan={2}>
                  등록된 트랙이 없습니다.
                </td>
              </tr>
            ) : (
              tracks.map((track) => (
                <tr key={track} className="border-b border-border/50 align-top">
                  <td className="px-2 py-2">{track}</td>
                  <td className="px-2 py-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={loadingDelete}
                      onClick={() => setDeleteConfirmTarget(track)}
                    >
                      삭제
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {deleteConfirmTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]">
          <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-primary/40 bg-white shadow-2xl">
            <div className="bg-gradient-to-r from-primary to-[#d80028] px-5 py-4 text-white">
              <p className="text-xs font-semibold uppercase tracking-[0.14em]">주의</p>
              <h3 className="mt-1 text-lg font-bold">트랙 삭제 확인</h3>
            </div>
            <div className="space-y-3 p-5 text-sm text-foreground">
              <p className="rounded-xl border border-primary/20 bg-secondary/50 p-3">
                <span className="font-semibold">{deleteConfirmTarget}</span>
              </p>
              <p>정말로 삭제하시겠습니까?</p>
              <p className="text-xs text-muted-foreground">트랙 소속 사용자 정보는 삭제되지 않습니다.</p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border/70 bg-muted/30 px-5 py-4">
              <Button type="button" variant="outline" onClick={() => setDeleteConfirmTarget(null)} disabled={loadingDelete}>
                취소
              </Button>
              <Button type="button" variant="destructive" onClick={() => void deleteTrack()} disabled={loadingDelete}>
                {loadingDelete ? "삭제 중..." : "삭제"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

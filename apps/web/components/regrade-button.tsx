"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

export function RegradeButton({ submissionId }: { submissionId: number }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const onRegrade = async () => {
    setLoading(true);
    setMessage("");
    const response = await fetch(`/api/admin/submissions/${submissionId}/regrade`, {
      method: "POST",
    });
    const payload = (await response.json().catch(() => ({}))) as { message?: string; detail?: string };
    if (!response.ok) {
      setMessage(payload.detail ?? payload.message ?? "재채점 요청 실패");
      setLoading(false);
      return;
    }

    setMessage(payload.message ?? "재채점이 큐에 등록되었습니다.");
    setLoading(false);
    router.refresh();
  };

  return (
    <div className="flex items-center gap-3">
      <Button type="button" onClick={onRegrade} disabled={loading}>
        {loading ? "Queueing..." : "Regrade"}
      </Button>
      {message ? <p className="text-sm">{message}</p> : null}
    </div>
  );
}

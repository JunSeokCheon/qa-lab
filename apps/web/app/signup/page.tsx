"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const toErrorMessage = (payload: unknown): string => {
    if (!payload || typeof payload !== "object") return "회원가입에 실패했습니다.";
    const data = payload as { detail?: unknown; message?: unknown };

    if (typeof data.message === "string" && data.message.trim()) return data.message;
    if (typeof data.detail === "string" && data.detail.trim()) return data.detail;

    if (Array.isArray(data.detail)) {
      const first = data.detail[0] as { msg?: unknown } | undefined;
      if (first && typeof first.msg === "string" && first.msg.trim()) return first.msg;
      return "입력값을 다시 확인해주세요.";
    }

    return "회원가입에 실패했습니다.";
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("비밀번호는 8자 이상이어야 합니다.");
      return;
    }
    if (password !== confirm) {
      setError("비밀번호 확인이 일치하지 않습니다.");
      return;
    }

    setLoading(true);
    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(toErrorMessage(payload));
      setLoading(false);
      return;
    }

    await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    router.push("/");
    router.refresh();
  };

  return (
    <div className="min-h-screen">
      <main className="qa-shell flex min-h-screen items-center justify-center py-12">
        <section className="qa-card w-full max-w-md">
          <p className="qa-kicker">New Account</p>
          <h1 className="mb-6 mt-2 text-3xl font-bold">회원가입</h1>
          <form onSubmit={onSubmit} className="space-y-4">
            <Input placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Input type="password" placeholder="password (8+)" value={password} onChange={(e) => setPassword(e.target.value)} />
            <Input type="password" placeholder="confirm password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button className="w-full" disabled={loading}>
              {loading ? "가입 중..." : "회원가입"}
            </Button>
            <p className="text-xs text-muted-foreground">
              이미 계정이 있나요?{" "}
              <Link href="/login" className="underline">로그인</Link>
            </p>
          </form>
        </section>
      </main>
    </div>
  );
}

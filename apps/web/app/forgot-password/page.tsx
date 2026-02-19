"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ForgotResponse = {
  message?: string;
  reset_token?: string | null;
};

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setToken("");

    const response = await fetch("/api/auth/password/forgot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const payload = (await response.json().catch(() => ({}))) as ForgotResponse;

    setMessage(payload.message ?? (response.ok ? "요청이 접수되었습니다." : "요청에 실패했습니다."));
    if (payload.reset_token) {
      setToken(payload.reset_token);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen">
      <main className="qa-shell flex min-h-screen items-center justify-center py-12">
        <section className="qa-card w-full max-w-md space-y-4">
          <p className="qa-kicker">Password Recovery</p>
          <h1 className="text-3xl font-bold">비밀번호 재설정</h1>
          <form onSubmit={onSubmit} className="space-y-3">
            <Input placeholder="가입 이메일" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Button className="w-full" disabled={loading}>
              {loading ? "요청 중..." : "재설정 토큰 요청"}
            </Button>
          </form>
          {message ? <p className="text-sm">{message}</p> : null}
          {token ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs">
              <p className="font-semibold">개발모드 재설정 토큰</p>
              <p className="mt-1 break-all">{token}</p>
              <Link href={`/reset-password?token=${token}`} className="mt-2 inline-block underline">
                이 토큰으로 비밀번호 변경하기
              </Link>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            로그인으로 돌아가기:{" "}
            <Link href="/login" className="underline">
              /login
            </Link>
          </p>
        </section>
      </main>
    </div>
  );
}

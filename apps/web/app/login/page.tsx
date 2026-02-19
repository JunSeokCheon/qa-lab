"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("user@example.com");
  const [password, setPassword] = useState("user1234");
  const [error, setError] = useState("");
  const [failedCount, setFailedCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError("");

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { message?: string };
      setError(payload.message ?? "로그인에 실패했습니다.");
      setFailedCount((prev) => prev + 1);
      setLoading(false);
      return;
    }

    router.push("/");
    router.refresh();
  };

  return (
    <div className="min-h-screen">
      <main className="qa-shell flex min-h-screen items-center justify-center py-12">
        <section className="qa-card w-full max-w-md">
          <p className="qa-kicker">Welcome Back</p>
          <h1 className="mb-6 mt-2 text-3xl font-bold">Login</h1>
          <form onSubmit={onSubmit} className="space-y-4">
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" />
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" />
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            {failedCount > 0 ? <p className="text-xs text-muted-foreground">로그인 실패 횟수: {failedCount}</p> : null}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "로그인 중..." : "로그인"}
            </Button>
            <div className="flex items-center justify-between text-xs">
              <Link className="underline" href="/signup">
                회원가입
              </Link>
              <Link className="underline" href="/forgot-password">
                비밀번호 재설정
              </Link>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}
